// SPDX-License-Identifier: MIT
import type { Env, MessageReceiptRow, MessageRow } from "../types";
import { ContractService } from "./contract";
import { ConversationService, serializeBigInt } from "./conversation";
import { MessageService, type EnrichedMessage } from "./message";

export interface SyncResult {
  messages: EnrichedMessage[];
  receipts: MessageReceiptRow[];
  groups: string[];
  sync_timestamp: number;
  has_more?: boolean;
}

export class SyncService {
  /**
   * Synchronizes messages and receipts incrementally for a user across all on-chain groups and direct chats.
   */
  public static async sync(
    env: Env,
    userAddress: string,
    since = 0,
    limit = 100
  ): Promise<SyncResult> {
    const normUser = userAddress.toLowerCase();
    const contractService = new ContractService(env);
    const now = Math.floor(Date.now() / 1000);

    // 1. Discover user's current on-chain groups
    let groupIds: bigint[] = [];
    try {
      groupIds = await contractService.getUserGroups(normUser);
    } catch {
      // Fallback if contract read fails
    }

    const groupConversationIds = groupIds.map((gid) =>
      ConversationService.buildGroupConversationId(gid)
    );

    // 2. Build SQL conditions for user's conversations
    // Either a group the user belongs to OR a direct chat involving the user
    let conversationCondition: string;
    const conversationParams: any[] = [];

    const dmClause = `(conversation_id LIKE 'dm:%' AND (conversation_id LIKE ? OR conversation_id LIKE ?))`;
    conversationParams.push(`dm:${normUser}:%`, `%:${normUser}`);

    if (groupConversationIds.length > 0) {
      const placeholders = groupConversationIds.map(() => "?").join(", ");
      conversationCondition = `(conversation_id IN (${placeholders}) OR ${dmClause})`;
      conversationParams.unshift(...groupConversationIds);
    } else {
      conversationCondition = dmClause;
    }

    // 3. Query messages matching update timestamps and not expired/burned
    const messageSql = `
      SELECT * FROM messages
      WHERE ${conversationCondition}
        AND (created_at > ? OR recalled_at > ? OR delivered_at > ? OR read_at > ?)
        AND (expires_at = 0 OR expires_at > ?)
      ORDER BY created_at ASC
      LIMIT ?
    `;

    const queryParams = [
      ...conversationParams,
      since,
      since,
      since,
      since,
      now,
      limit,
    ];

    const messageRows = await env.DB.prepare(messageSql)
      .bind(...queryParams)
      .all<MessageRow>();

    const messages = messageRows.results || [];

    // 4. Enrich messages in batch (eliminates N+1 database queries)
    const enriched = await MessageService.enrichMediaMessages(env, messages);
    const messageIds = messages.map((m) => m.id);

    // 5. Query recent receipts
    let receipts: MessageReceiptRow[] = [];
    if (messageIds.length > 0) {
      const idPlaceholders = messageIds.map(() => "?").join(", ");
      const receiptRows = await env.DB.prepare(
        `SELECT * FROM message_receipts
         WHERE message_id IN (${idPlaceholders}) AND timestamp > ?
         ORDER BY timestamp ASC`
      )
        .bind(...messageIds, since)
        .all<MessageReceiptRow>();
      receipts = receiptRows.results || [];
    }

    let syncTimestamp = now;
    if (messages.length >= limit) {
      let maxTs = since;
      for (const m of messages) {
        const t = Math.max(
          m.created_at,
          m.recalled_at || 0,
          m.delivered_at || 0,
          m.read_at || 0
        );
        if (t > maxTs) maxTs = t;
      }
      syncTimestamp = maxTs;
    }

    return serializeBigInt({
      messages: enriched,
      receipts,
      groups: groupConversationIds,
      sync_timestamp: syncTimestamp,
      has_more: messages.length >= limit,
    });
  }
}
