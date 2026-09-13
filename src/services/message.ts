// SPDX-License-Identifier: MIT
import type {
  Env,
  FileMessageRow,
  ImageMessageRow,
  MessageReceiptRow,
  MessageRow,
  RetentionType,
  VoiceMessageRow,
} from "../types";
import { ConversationService } from "./conversation";
import { ContractService } from "./contract";

export interface SendTextMessageInput {
  conversationId: string;
  senderAddress: string;
  content: string;
  retention?: RetentionType;
  burnAfterSeconds?: number;
  mentions?: string[];
}

export interface SendMediaMessageInput {
  conversationId: string;
  senderAddress: string;
  type: "voice" | "image" | "file";
  fileData: ArrayBuffer | Uint8Array;
  fileName?: string;
  mimeType: string;
  duration?: number;
  width?: number;
  height?: number;
  retention?: RetentionType;
  burnAfterSeconds?: number;
}

export interface EnrichedMessage extends MessageRow {
  media?: VoiceMessageRow | ImageMessageRow | FileMessageRow;
  receipts?: MessageReceiptRow[];
}

export class MessageService {
  /**
   * Sends a text message to a conversation.
   */
  public static async sendTextMessage(
    env: Env,
    input: SendTextMessageInput
  ): Promise<MessageRow> {
    const contractService = new ContractService(env);
    const details = await ConversationService.getConversationDetails(
      input.conversationId,
      input.senderAddress,
      contractService
    );

    if (!details.canPost) {
      throw new Error(`Cannot post message: ${details.blockReason || "PERMISSION_DENIED"}`);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const retention = input.retention || "permanent";
    const burnAfter = retention === "on_read" ? input.burnAfterSeconds || 30 : null;
    const mentions = input.mentions && input.mentions.length > 0
      ? JSON.stringify(input.mentions)
      : null;

    const message: MessageRow = {
      id,
      conversation_id: details.id,
      sender_id: input.senderAddress.toLowerCase(),
      type: "text",
      content: input.content,
      retention,
      status: "pending", // Explicit ACK model: initial status is pending
      expires_at: 0, // Starts at 0 until read if on_read
      delivered_at: null,
      read_at: null,
      created_at: now,
      recalled_at: null,
      burn_after_seconds: burnAfter,
      mentions,
    };

    await env.DB.prepare(
      `INSERT INTO messages (
        id, conversation_id, sender_id, type, content, retention,
        status, expires_at, delivered_at, read_at, created_at,
        recalled_at, burn_after_seconds, mentions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        message.id,
        message.conversation_id,
        message.sender_id,
        message.type,
        message.content,
        message.retention,
        message.status,
        message.expires_at,
        message.delivered_at,
        message.read_at,
        message.created_at,
        message.recalled_at,
        message.burn_after_seconds,
        message.mentions
      )
      .run();

    return message;
  }

  /**
   * Sends a media message (voice, image, file) uploading binary to R2.
   */
  public static async sendMediaMessage(
    env: Env,
    input: SendMediaMessageInput
  ): Promise<EnrichedMessage> {
    const contractService = new ContractService(env);
    const details = await ConversationService.getConversationDetails(
      input.conversationId,
      input.senderAddress,
      contractService
    );

    if (!details.canPost) {
      throw new Error(`Cannot post media message: ${details.blockReason || "PERMISSION_DENIED"}`);
    }

    const messageId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const retention = input.retention || "permanent";
    const burnAfter = retention === "on_read" ? input.burnAfterSeconds || 30 : null;

    // 1. Upload binary to R2
    const ext = input.fileName?.includes(".")
      ? input.fileName.substring(input.fileName.lastIndexOf("."))
      : "";
    const objectKey = `${input.type}s/${messageId}${ext}`;

    await env.VOICE_BUCKET.put(objectKey, input.fileData, {
      httpMetadata: { contentType: input.mimeType },
      customMetadata: {
        messageId,
        senderId: input.senderAddress.toLowerCase(),
        type: input.type,
      },
    });

    // 2. Insert main message row
    const message: MessageRow = {
      id: messageId,
      conversation_id: details.id,
      sender_id: input.senderAddress.toLowerCase(),
      type: input.type,
      content: objectKey,
      retention,
      status: "pending",
      expires_at: 0,
      delivered_at: null,
      read_at: null,
      created_at: now,
      recalled_at: null,
      burn_after_seconds: burnAfter,
      mentions: null,
    };

    await env.DB.prepare(
      `INSERT INTO messages (
        id, conversation_id, sender_id, type, content, retention,
        status, expires_at, delivered_at, read_at, created_at,
        recalled_at, burn_after_seconds, mentions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        message.id,
        message.conversation_id,
        message.sender_id,
        message.type,
        message.content,
        message.retention,
        message.status,
        message.expires_at,
        message.delivered_at,
        message.read_at,
        message.created_at,
        message.recalled_at,
        message.burn_after_seconds,
        message.mentions
      )
      .run();

    // 3. Insert media metadata row
    const mediaId = crypto.randomUUID();
    const size = input.fileData.byteLength;
    let mediaMetadata: any = null;

    if (input.type === "voice") {
      const voiceRow: VoiceMessageRow = {
        id: mediaId,
        message_id: messageId,
        object_key: objectKey,
        duration: input.duration || 0,
        mime_type: input.mimeType,
        size,
        created_at: now,
      };
      await env.DB.prepare(
        `INSERT INTO voice_messages (id, message_id, object_key, duration, mime_type, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(voiceRow.id, voiceRow.message_id, voiceRow.object_key, voiceRow.duration, voiceRow.mime_type, voiceRow.size, voiceRow.created_at)
        .run();
      mediaMetadata = voiceRow;
    } else if (input.type === "image") {
      const imageRow: ImageMessageRow = {
        id: mediaId,
        message_id: messageId,
        object_key: objectKey,
        file_name: input.fileName || null,
        mime_type: input.mimeType,
        size,
        width: input.width || null,
        height: input.height || null,
        created_at: now,
      };
      await env.DB.prepare(
        `INSERT INTO image_messages (id, message_id, object_key, file_name, mime_type, size, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(imageRow.id, imageRow.message_id, imageRow.object_key, imageRow.file_name, imageRow.mime_type, imageRow.size, imageRow.width, imageRow.height, imageRow.created_at)
        .run();
      mediaMetadata = imageRow;
    } else if (input.type === "file") {
      const fileRow: FileMessageRow = {
        id: mediaId,
        message_id: messageId,
        object_key: objectKey,
        file_name: input.fileName || "file",
        mime_type: input.mimeType,
        size,
        created_at: now,
      };
      await env.DB.prepare(
        `INSERT INTO file_messages (id, message_id, object_key, file_name, mime_type, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(fileRow.id, fileRow.message_id, fileRow.object_key, fileRow.file_name, fileRow.mime_type, fileRow.size, fileRow.created_at)
        .run();
      mediaMetadata = fileRow;
    }

    return {
      ...message,
      media: mediaMetadata,
    };
  }

  /**
   * Explicit delivery acknowledgment from client.
   */
  public static async acknowledgeDelivery(
    env: Env,
    messageId: string,
    userId: string
  ): Promise<MessageRow> {
    const now = Math.floor(Date.now() / 1000);
    const normUser = userId.toLowerCase();

    const message = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(messageId).first<MessageRow>();
    if (!message) {
      throw new Error("Message not found");
    }

    // Update status if currently pending
    if (message.status === "pending") {
      await env.DB.prepare(
        `UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?`
      )
        .bind(now, messageId)
        .run();
      message.status = "delivered";
      message.delivered_at = now;
    }

    // Idempotent delivery receipt
    const existingReceipt = await env.DB.prepare(
      `SELECT id FROM message_receipts WHERE message_id = ? AND user_id = ? AND status = 'delivered' LIMIT 1`
    )
      .bind(messageId, normUser)
      .first();

    if (!existingReceipt) {
      await env.DB.prepare(
        `INSERT INTO message_receipts (id, message_id, user_id, status, timestamp)
         VALUES (?, ?, ?, 'delivered', ?)`
      )
        .bind(crypto.randomUUID(), messageId, normUser, now)
        .run();
    }

    return message;
  }

  /**
   * Explicit read acknowledgment from client.
   * - In 1-on-1 DM: Starts burn countdown when counterparty reads.
   * - In Group chat: Client deletes locally on read. Server starts burn countdown only when
   *   ALL non-sender members have read, or fallback expiration TTL is reached.
   */
  public static async markAsRead(
    env: Env,
    messageId: string,
    userId: string
  ): Promise<MessageRow> {
    const now = Math.floor(Date.now() / 1000);
    const normUser = userId.toLowerCase();

    const message = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(messageId).first<MessageRow>();
    if (!message) {
      throw new Error("Message not found");
    }

    const isSender = normUser === message.sender_id.toLowerCase();
    const isGroup = message.conversation_id.startsWith("group:");

    // 1. Idempotent insert of read receipt
    const existingReceipt = await env.DB.prepare(
      `SELECT id FROM message_receipts WHERE message_id = ? AND user_id = ? AND status = 'read' LIMIT 1`
    )
      .bind(messageId, normUser)
      .first();

    if (!existingReceipt) {
      await env.DB.prepare(
        `INSERT INTO message_receipts (id, message_id, user_id, status, timestamp)
         VALUES (?, ?, ?, 'read', ?)`
      )
        .bind(crypto.randomUUID(), messageId, normUser, now)
        .run();
    }

    // 2. Determine expires_at for on_read retention
    let expiresAt = message.expires_at;

    if (message.retention === "on_read" && (message.expires_at === 0 || message.expires_at === null)) {
      if (!isGroup) {
        // Direct conversation (1-on-1):
        // Recipient reading activates the 30s burn countdown window.
        // Sender reading their own message does not trigger burn.
        if (!isSender) {
          const burnWindow = message.burn_after_seconds || 30;
          expiresAt = now + burnWindow;
        }
      } else {
        // Group conversation:
        // Client deletes locally after reading ("靠前端删除自己读的").
        // Global message destruction is activated ONLY when all non-sender members have read
        // OR fallback expiration TTL is reached.
        const contractService = new ContractService(env);
        const parsed = ConversationService.parseConversationId(message.conversation_id);
        let memberCount = 0;
        if (parsed.groupId !== undefined) {
          try {
            const overview = await contractService.getGroupOverview(parsed.groupId);
            memberCount = Number(overview.memberCount);
          } catch {
            // RPC fallback: if contract call fails, preserve message without premature destruction
          }
        }

        const targetReaders = Math.max(1, memberCount - 1);
        const readCountResult = await env.DB.prepare(
          `SELECT COUNT(DISTINCT user_id) as total_readers
           FROM message_receipts
           WHERE message_id = ? AND status = 'read' AND user_id != ?`
        )
          .bind(messageId, message.sender_id.toLowerCase())
          .first<{ total_readers: number }>();

        const distinctReaders = readCountResult?.total_readers || 0;

        if (memberCount > 0 && distinctReaders >= targetReaders) {
          // All non-sender members have read -> start global 30-second burn countdown
          const burnWindow = message.burn_after_seconds || 30;
          expiresAt = now + burnWindow;
        }
      }
    }

    await env.DB.prepare(
      `UPDATE messages
       SET status = 'read',
           read_at = COALESCE(read_at, ?),
           delivered_at = COALESCE(delivered_at, ?),
           expires_at = ?
       WHERE id = ?`
    )
      .bind(now, now, expiresAt, messageId)
      .run();

    message.status = "read";
    message.read_at = message.read_at || now;
    message.delivered_at = message.delivered_at || now;
    message.expires_at = expiresAt;

    return message;
  }

  /**
   * Recalls a message within the 30-second recall window.
   */
  public static async recallMessage(
    env: Env,
    messageId: string,
    userId: string
  ): Promise<MessageRow> {
    const now = Math.floor(Date.now() / 1000);
    const recallWindowSeconds = Number(env.MESSAGE_RECALL_WINDOW_SECONDS) || 30;

    const message = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(messageId).first<MessageRow>();
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.sender_id.toLowerCase() !== userId.toLowerCase()) {
      throw new Error("Unauthorized to recall this message");
    }

    if (message.recalled_at) {
      throw new Error("Message already recalled");
    }

    if (now - message.created_at > recallWindowSeconds) {
      throw new Error(`Recall window of ${recallWindowSeconds}s has expired`);
    }

    // If media, delete binary from R2 and clean up media tables
    if (message.type !== "text" && message.content) {
      await env.VOICE_BUCKET.delete(message.content);
      await env.DB.prepare(`DELETE FROM voice_messages WHERE message_id = ?`).bind(messageId).run();
      await env.DB.prepare(`DELETE FROM image_messages WHERE message_id = ?`).bind(messageId).run();
      await env.DB.prepare(`DELETE FROM file_messages WHERE message_id = ?`).bind(messageId).run();
    }

    await env.DB.prepare(
      `UPDATE messages SET recalled_at = ?, content = ? WHERE id = ?`
    )
      .bind(now, message.type === "text" ? null : message.content, messageId)
      .run();

    message.recalled_at = now;
    message.content = null;

    return message;
  }

  /**
   * Retrieves messages for a conversation, omitting burned/expired messages.
   */
  public static async getConversationMessages(
    env: Env,
    conversationId: string,
    limit = 50,
    before?: number
  ): Promise<EnrichedMessage[]> {
    const now = Math.floor(Date.now() / 1000);
    const fallbackTtl = Number(env.EPHEMERAL_FALLBACK_TTL_SECONDS) || 7 * 86400;
    const fallbackCutoff = now - fallbackTtl;

    let query = `
      SELECT * FROM messages
      WHERE conversation_id = ?
        AND (expires_at = 0 OR expires_at > ?)
        AND NOT (retention = 'on_read' AND expires_at = 0 AND created_at <= ?)
    `;
    const params: any[] = [conversationId, now, fallbackCutoff];

    if (before) {
      query += ` AND created_at < ?`;
      params.push(before);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await env.DB.prepare(query).bind(...params).all<MessageRow>();
    const messages = (rows.results || []).reverse();

    return this.enrichMediaMessages(env, messages);
  }

  /**
   * Batch enriches message rows with media metadata in parallel to eliminate N+1 DB queries.
   */
  public static async enrichMediaMessages(
    env: Env,
    messages: MessageRow[]
  ): Promise<EnrichedMessage[]> {
    const voiceMsgIds: string[] = [];
    const imageMsgIds: string[] = [];
    const fileMsgIds: string[] = [];

    for (const msg of messages) {
      if (!msg.recalled_at) {
        if (msg.type === "voice") voiceMsgIds.push(msg.id);
        else if (msg.type === "image") imageMsgIds.push(msg.id);
        else if (msg.type === "file") fileMsgIds.push(msg.id);
      }
    }

    const [voiceRows, imageRows, fileRows] = await Promise.all([
      voiceMsgIds.length > 0
        ? env.DB.prepare(
            `SELECT * FROM voice_messages WHERE message_id IN (${voiceMsgIds.map(() => "?").join(",")})`
          )
            .bind(...voiceMsgIds)
            .all<VoiceMessageRow>()
        : Promise.resolve({ results: [] }),
      imageMsgIds.length > 0
        ? env.DB.prepare(
            `SELECT * FROM image_messages WHERE message_id IN (${imageMsgIds.map(() => "?").join(",")})`
          )
            .bind(...imageMsgIds)
            .all<ImageMessageRow>()
        : Promise.resolve({ results: [] }),
      fileMsgIds.length > 0
        ? env.DB.prepare(
            `SELECT * FROM file_messages WHERE message_id IN (${fileMsgIds.map(() => "?").join(",")})`
          )
            .bind(...fileMsgIds)
            .all<FileMessageRow>()
        : Promise.resolve({ results: [] }),
    ]);

    const voiceMap = new Map((voiceRows.results || []).map((r) => [r.message_id, r]));
    const imageMap = new Map((imageRows.results || []).map((r) => [r.message_id, r]));
    const fileMap = new Map((fileRows.results || []).map((r) => [r.message_id, r]));

    const enriched: EnrichedMessage[] = [];
    for (const msg of messages) {
      if (msg.recalled_at) {
        enriched.push({ ...msg, content: null });
      } else if (msg.type === "voice") {
        enriched.push({ ...msg, media: voiceMap.get(msg.id) });
      } else if (msg.type === "image") {
        enriched.push({ ...msg, media: imageMap.get(msg.id) });
      } else if (msg.type === "file") {
        enriched.push({ ...msg, media: fileMap.get(msg.id) });
      } else {
        enriched.push(msg);
      }
    }

    return enriched;
  }

  /**
   * Retrieves all delivery and read receipts for a message.
   */
  public static async getMessageReceipts(
    env: Env,
    messageId: string
  ): Promise<{
    message_id: string;
    receipts: MessageReceiptRow[];
    total_delivered: number;
    total_read: number;
  }> {
    const receipts = await env.DB.prepare(
      `SELECT * FROM message_receipts WHERE message_id = ? ORDER BY timestamp ASC`
    )
      .bind(messageId)
      .all<MessageReceiptRow>();

    const rows = receipts.results || [];
    const total_delivered = rows.filter((r) => r.status === "delivered").length;
    const total_read = rows.filter((r) => r.status === "read").length;

    return {
      message_id: messageId,
      receipts: rows,
      total_delivered,
      total_read,
    };
  }

  /**
   * Batch delivery acknowledgment for multiple messages (concurrent processing).
   */
  public static async batchAcknowledgeDelivery(
    env: Env,
    messageIds: string[],
    userId: string
  ): Promise<{ acknowledged: string[]; skipped: string[] }> {
    const results = await Promise.all(
      messageIds.map(async (id) => {
        try {
          await this.acknowledgeDelivery(env, id, userId);
          return { id, success: true };
        } catch {
          return { id, success: false };
        }
      })
    );

    const acknowledged: string[] = [];
    const skipped: string[] = [];
    for (const r of results) {
      if (r.success) acknowledged.push(r.id);
      else skipped.push(r.id);
    }

    return { acknowledged, skipped };
  }

  /**
   * Batch read acknowledgment for multiple messages (concurrent processing).
   */
  public static async batchMarkAsRead(
    env: Env,
    messageIds: string[],
    userId: string
  ): Promise<{ acknowledged: string[]; skipped: string[] }> {
    const results = await Promise.all(
      messageIds.map(async (id) => {
        try {
          await this.markAsRead(env, id, userId);
          return { id, success: true };
        } catch {
          return { id, success: false };
        }
      })
    );

    const acknowledged: string[] = [];
    const skipped: string[] = [];
    for (const r of results) {
      if (r.success) acknowledged.push(r.id);
      else skipped.push(r.id);
    }

    return { acknowledged, skipped };
  }
}
