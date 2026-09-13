import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, { app } from '../src/index';
import { createMockD1Database } from './helpers/db';
import { createMockR2Bucket } from './helpers/r2';
import { createTestWallet } from './helpers/wallet';
import { ConversationService } from '../src/services/conversation';
import { hashToken } from '../src/services/auth';
import { ContractService } from '../src/services/contract';
import { SweeperService } from '../src/services/sweeper';
import type { Env } from '../src/types';

describe('Incremental Timestamp Sync Engine & Sweeper (/sync)', () => {
  let env: Env;
  const alice = createTestWallet();
  const bob = createTestWallet();
  let aliceToken: string;
  let dmId: string;

  beforeEach(async () => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: '0x1111111111111111111111111111111111111111',
      RPC_URLS: 'http://127.0.0.1:8545',
      RPC_CACHE_TTL_SECONDS: '60',
    };

    aliceToken = 'alice-sync-token';
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind('s1', alice.address.toLowerCase(), await hashToken(aliceToken), now + 86400, now)
      .run();

    dmId = ConversationService.buildDirectConversationId(alice.address, bob.address);
  });

  describe('GET /sync Incremental Timestamp Sync', () => {
    it('synchronizes messages across direct chats and on-chain groups', async () => {
      const now = Math.floor(Date.now() / 1000);

      // 1. Mock on-chain groups for Alice
      vi.spyOn(ContractService.prototype, 'getUserGroups').mockResolvedValueOnce([10n]);

      // 2. Insert messages:
      // - One older direct message (created 100s ago)
      // - One newer direct message (created 10s ago)
      // - One newer group message (created 5s ago)
      await env.DB.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, type, content, retention,
          status, expires_at, created_at
        ) VALUES
          (?, ?, ?, 'text', 'Old DM', 'permanent', 'delivered', 0, ?),
          (?, ?, ?, 'text', 'New DM', 'permanent', 'delivered', 0, ?),
          (?, 'group:10', ?, 'text', 'Group Announcement', 'permanent', 'delivered', 0, ?)`
      )
        .bind(
          'msg-old', dmId, bob.address, now - 100,
          'msg-new', dmId, bob.address, now - 10,
          'msg-group', bob.address, now - 5
        )
        .run();

      // Insert delivery receipt for msg-new
      await env.DB.prepare(
        `INSERT INTO message_receipts (id, message_id, user_id, status, timestamp)
         VALUES (?, ?, ?, 'delivered', ?)`
      )
        .bind(crypto.randomUUID(), 'msg-new', alice.address, now - 9)
        .run();

      // Sync with since = now - 50 (should only receive msg-new and msg-group, not msg-old)
      const syncRes = await app.request(
        `/sync?since=${now - 50}`,
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(syncRes.status).toBe(200);
      const data = (await syncRes.json()) as any;
      expect(data.messages).toHaveLength(2);
      expect(data.messages.map((m: any) => m.id)).toEqual(['msg-new', 'msg-group']);
      expect(data.receipts).toHaveLength(1);
      expect(data.receipts[0].message_id).toBe('msg-new');
      expect(data.groups).toContain('group:10');
      expect(data.sync_timestamp).toBeGreaterThanOrEqual(now);
    });

    it('filters out burned/expired ephemeral messages from sync results', async () => {
      const now = Math.floor(Date.now() / 1000);

      await env.DB.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, type, content, retention,
          status, expires_at, created_at
        ) VALUES
          (?, ?, ?, 'text', 'Alive Msg', 'permanent', 'delivered', 0, ?),
          (?, ?, ?, 'text', 'Burned Ephemeral Msg', 'on_read', 'read', ?, ?)`
      )
        .bind(
          'msg-alive', dmId, bob.address, now - 5,
          'msg-burned', dmId, bob.address, now - 1, now - 50
        )
        .run();

      const syncRes = await app.request(
        `/sync?since=${now - 100}`,
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(syncRes.status).toBe(200);
      const data = (await syncRes.json()) as any;
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].id).toBe('msg-alive');
    });
  });

  describe('SweeperService & Scheduled Cleaner', () => {
    it('purges burned messages and cleans up R2 media objects and DB rows', async () => {
      const now = Math.floor(Date.now() / 1000);

      // 1. Put media file in R2
      const mediaKey = 'images/burned-image.jpg';
      await env.VOICE_BUCKET.put(mediaKey, new Uint8Array([1, 2, 3]));

      // 2. Insert expired message and metadata
      await env.DB.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, type, content, retention,
          status, expires_at, created_at
        ) VALUES (?, ?, ?, 'image', ?, 'on_read', 'read', ?, ?)`
      )
        .bind('msg-expired-media', dmId, alice.address, mediaKey, now - 10, now - 40)
        .run();

      await env.DB.prepare(
        `INSERT INTO image_messages (id, message_id, object_key, file_name, mime_type, size, created_at)
         VALUES (?, ?, ?, 'burned.jpg', 'image/jpeg', 3, ?)`
      )
        .bind(crypto.randomUUID(), 'msg-expired-media', mediaKey, now - 40)
        .run();

      // 3. Insert expired nonce and session
      await env.DB.prepare(
        `INSERT INTO nonces (id, wallet_address, nonce, expires_at, created_at)
         VALUES (?, ?, 'expired-nonce', ?, ?)`
      )
        .bind(crypto.randomUUID(), alice.address, now - 100, now - 400)
        .run();

      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, 'expired-hash', ?, ?)`
      )
        .bind(crypto.randomUUID(), alice.address, now - 50, now - 100)
        .run();

      // Confirm media exists in R2 before sweeper
      expect(await env.VOICE_BUCKET.get(mediaKey)).not.toBeNull();

      // 4. Run sweeper
      const report = await SweeperService.runSweeper(env);
      expect(report.purged_messages_count).toBeGreaterThanOrEqual(1);
      expect(report.purged_media_count).toBeGreaterThanOrEqual(1);
      expect(report.purged_nonces_count).toBeGreaterThanOrEqual(1);
      expect(report.purged_sessions_count).toBeGreaterThanOrEqual(1);

      // Confirm media purged from R2
      expect(await env.VOICE_BUCKET.get(mediaKey)).toBeNull();

      // Confirm DB records deleted
      const msgCheck = await env.DB.prepare(`SELECT * FROM messages WHERE id = 'msg-expired-media'`).first();
      expect(msgCheck).toBeNull();
      const metaCheck = await env.DB.prepare(`SELECT * FROM image_messages WHERE message_id = 'msg-expired-media'`).first();
      expect(metaCheck).toBeNull();
    });

    it('runs scheduled handler without errors', async () => {
      await expect(
        worker.scheduled({} as ScheduledController, env, {} as ExecutionContext)
      ).resolves.not.toThrow();
    });
  });
});
