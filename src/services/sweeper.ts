// SPDX-License-Identifier: MIT
import type { Env, MessageRow } from "../types";

export interface SweeperReport {
  purged_messages_count: number;
  purged_media_count: number;
  purged_nonces_count: number;
  purged_sessions_count: number;
  timestamp: number;
}

export class SweeperService {
  /**
   * Sweeps and purges expired ephemeral messages (dual-storage R2 & D1), expired nonces, and expired sessions.
   */
  public static async runSweeper(env: Env): Promise<SweeperReport> {
    const now = Math.floor(Date.now() / 1000);
    const fallbackTtl = Number(env.EPHEMERAL_FALLBACK_TTL_SECONDS) || 7 * 86400;
    const fallbackCutoff = now - fallbackTtl;

    // 1. Find expired messages:
    // - Active countdown finished: expires_at > 0 AND expires_at <= now
    // - Fallback TTL reached for unread/incompletely-read ephemeral messages: retention = 'on_read' AND expires_at = 0 AND created_at <= fallbackCutoff
    const expiredMessages = await env.DB.prepare(
      `SELECT * FROM messages
       WHERE (expires_at > 0 AND expires_at <= ?)
          OR (retention = 'on_read' AND expires_at = 0 AND created_at <= ?)`
    )
      .bind(now, fallbackCutoff)
      .all<MessageRow>();

    const expiredList = expiredMessages.results || [];
    let mediaPurgeCount = 0;

    const deleteStmts: any[] = [];
    for (const msg of expiredList) {
      // If media, delete binary from R2 and clean metadata
      if (msg.type !== "text" && msg.content) {
        try {
          await env.VOICE_BUCKET.delete(msg.content);
          mediaPurgeCount++;
        } catch {
          // Ignore if already deleted
        }
        deleteStmts.push(
          env.DB.prepare(`DELETE FROM voice_messages WHERE message_id = ?`).bind(msg.id),
          env.DB.prepare(`DELETE FROM image_messages WHERE message_id = ?`).bind(msg.id),
          env.DB.prepare(`DELETE FROM file_messages WHERE message_id = ?`).bind(msg.id)
        );
      }

      // Delete receipts & message
      deleteStmts.push(
        env.DB.prepare(`DELETE FROM message_receipts WHERE message_id = ?`).bind(msg.id),
        env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(msg.id)
      );
    }

    if (deleteStmts.length > 0) {
      await env.DB.batch(deleteStmts);
    }

    // 2. In-Transit Media Relay Purge (中继消费即焚 - 接收方拉取/已读后释放 R2 存储)
    // Media files are in-transit buffers. Once delivered/read and the grace window has passed
    // (read_at > 0 AND read_at <= mediaReadCutoff), OR unread media fallback TTL passed (created_at <= fallbackCutoff):
    // The heavy binary in R2 is purged, and media metadata is cleared to guarantee zero cloud storage retention.
    const mediaGraceSeconds = Number(env.MEDIA_TRANSIT_GRACE_SECONDS) || 30;
    const mediaReadCutoff = now - mediaGraceSeconds;

    const consumedMediaMessages = await env.DB.prepare(
      `SELECT * FROM messages
       WHERE type IN ('voice', 'image', 'file')
         AND content IS NOT NULL
         AND (
           (read_at > 0 AND read_at <= ?)
           OR (created_at <= ?)
         )`
    )
      .bind(mediaReadCutoff, fallbackCutoff)
      .all<MessageRow>();

    const consumedList = consumedMediaMessages.results || [];
    const mediaStmts: any[] = [];

    for (const msg of consumedList) {
      // Don't re-process if already swept in expiredList
      if (expiredList.some((e) => e.id === msg.id)) continue;

      if (msg.content) {
        try {
          await env.VOICE_BUCKET.delete(msg.content);
          mediaPurgeCount++;
        } catch {
          // Ignore if already deleted
        }
      }
      mediaStmts.push(
        env.DB.prepare(`UPDATE messages SET content = NULL WHERE id = ?`).bind(msg.id),
        env.DB.prepare(`DELETE FROM voice_messages WHERE message_id = ?`).bind(msg.id),
        env.DB.prepare(`DELETE FROM image_messages WHERE message_id = ?`).bind(msg.id),
        env.DB.prepare(`DELETE FROM file_messages WHERE message_id = ?`).bind(msg.id)
      );
    }

    if (mediaStmts.length > 0) {
      await env.DB.batch(mediaStmts);
    }

    // 2. Purge expired nonces
    const nonceResult = await env.DB.prepare(
      `DELETE FROM nonces WHERE expires_at <= ?`
    )
      .bind(now)
      .run();

    // 3. Purge expired sessions
    const sessionResult = await env.DB.prepare(
      `DELETE FROM sessions WHERE expires_at <= ?`
    )
      .bind(now)
      .run();

    return {
      purged_messages_count: expiredList.length,
      purged_media_count: mediaPurgeCount,
      purged_nonces_count: nonceResult.meta?.changes ?? 0,
      purged_sessions_count: sessionResult.meta?.changes ?? 0,
      timestamp: now,
    };
  }
}
