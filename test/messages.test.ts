import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from '../src/index';
import { createMockD1Database } from './helpers/db';
import { createMockR2Bucket } from './helpers/r2';
import { createTestWallet } from './helpers/wallet';
import { ConversationService } from '../src/services/conversation';
import { hashToken } from '../src/services/auth';
import { ContractService } from '../src/services/contract';
import { SweeperService } from '../src/services/sweeper';
import type { Env } from '../src/types';

describe('Messaging Core, Media Storage & 30s Recall/Burn Protocol', () => {
  let env: Env;
  const alice = createTestWallet();
  const bob = createTestWallet();
  const charlie = createTestWallet();

  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  let dmId: string;

  beforeEach(async () => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: '0x1111111111111111111111111111111111111111',
      RPC_URLS: 'http://127.0.0.1:8545',
      RPC_CACHE_TTL_SECONDS: '60',
      MESSAGE_RECALL_WINDOW_SECONDS: '30',
    };

    aliceToken = 'alice-test-token';
    bobToken = 'bob-test-token';
    charlieToken = 'charlie-test-token';
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    )
      .bind(
        's1',
        alice.address.toLowerCase(),
        await hashToken(aliceToken),
        now + 86400,
        now,
        's2',
        bob.address.toLowerCase(),
        await hashToken(bobToken),
        now + 86400,
        now,
        's3',
        charlie.address.toLowerCase(),
        await hashToken(charlieToken),
        now + 86400,
        now
      )
      .run();

    dmId = ConversationService.buildDirectConversationId(alice.address, bob.address);
  });

  describe('Text Messaging & Explicit ACK / Read Lifecycle', () => {
    it('sends text message with initial pending status (explicit ACK model)', async () => {
      const res = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'Hello Bob! Sovereign chat activated.',
            retention: 'permanent',
          }),
        },
        env
      );

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.message.id).toBeDefined();
      expect(data.message.content).toBe('Hello Bob! Sovereign chat activated.');
      expect(data.message.status).toBe('pending');
      expect(data.message.retention).toBe('permanent');
      expect(data.message.expires_at).toBe(0);
    });

    it('receiver explicitly ACKs delivery, updating status to delivered', async () => {
      // 1. Send message
      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Test ACK message' }),
        },
        env
      );
      const { message } = (await sendRes.json()) as any;

      // 2. Bob ACKs delivery
      const ackRes = await app.request(
        `/messages/${message.id}/ack`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${bobToken}` },
        },
        env
      );

      expect(ackRes.status).toBe(200);
      const ackData = (await ackRes.json()) as any;
      expect(ackData.message.status).toBe('delivered');
      expect(ackData.message.delivered_at).toBeGreaterThan(0);

      // Verify receipt table
      const receipt = await env.DB.prepare(
        `SELECT * FROM message_receipts WHERE message_id = ? AND status = 'delivered'`
      )
        .bind(message.id)
        .first();
      expect(receipt).toBeDefined();
    });

    it('triggers 30s burn window when receiver marks on_read message as read', async () => {
      // 1. Send on_read message
      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'This message will self destruct in 30 seconds',
            retention: 'on_read',
            burn_after_seconds: 30,
          }),
        },
        env
      );
      const { message } = (await sendRes.json()) as any;
      expect(message.retention).toBe('on_read');
      expect(message.expires_at).toBe(0);

      // 2. Bob marks message as read
      const readRes = await app.request(
        `/messages/${message.id}/read`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${bobToken}` },
        },
        env
      );

      expect(readRes.status).toBe(200);
      const readData = (await readRes.json()) as any;
      expect(readData.message.status).toBe('read');
      expect(readData.message.read_at).toBeGreaterThan(0);
      // Burn timer started: expires_at = read_at + 30
      expect(readData.message.expires_at).toBe(readData.message.read_at + 30);
    });

    it('does not start burn timer when sender marks own on_read message as read', async () => {
      // 1. Alice sends on_read message
      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'Secret note to Bob',
            retention: 'on_read',
            burn_after_seconds: 30,
          }),
        },
        env
      );
      const { message } = (await sendRes.json()) as any;
      expect(message.retention).toBe('on_read');
      expect(message.expires_at).toBe(0);

      // 2. Alice marks her own message as read
      const readRes = await app.request(
        `/messages/${message.id}/read`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(readRes.status).toBe(200);
      const readData = (await readRes.json()) as any;
      expect(readData.message.status).toBe('read');
      // Burn countdown must NOT be triggered by sender!
      expect(readData.message.expires_at).toBe(0);

      // 3. Bob (counterparty) marks message as read -> now activates burn timer
      const bobReadRes = await app.request(
        `/messages/${message.id}/read`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${bobToken}` },
        },
        env
      );
      expect(bobReadRes.status).toBe(200);
      const bobReadData = (await bobReadRes.json()) as any;
      expect(bobReadData.message.expires_at).toBe(bobReadData.message.read_at + 30);
    });
  });

  describe('30-Second Recall Protocol', () => {
    it('allows sender to recall message within 30 seconds and clears content', async () => {
      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Accidental message' }),
        },
        env
      );
      const { message } = (await sendRes.json()) as any;

      // Alice recalls within 30s
      const recallRes = await app.request(
        `/messages/${message.id}/recall`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(recallRes.status).toBe(200);
      const recallData = (await recallRes.json()) as any;
      expect(recallData.message.content).toBeNull();
      expect(recallData.message.recalled_at).toBeGreaterThan(0);
    });

    it('rejects recall attempt by a non-sender user', async () => {
      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Alice message' }),
        },
        env
      );
      const { message } = (await sendRes.json()) as any;

      // Bob tries to recall Alice's message
      const recallRes = await app.request(
        `/messages/${message.id}/recall`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${bobToken}` },
        },
        env
      );

      expect(recallRes.status).toBe(403);
      const err = (await recallRes.json()) as any;
      expect(err.error).toContain('Unauthorized');
    });

    it('rejects recall attempt after the 30-second window has passed', async () => {
      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Old message' }),
        },
        env
      );
      const { message } = (await sendRes.json()) as any;

      // Manually advance created_at in D1 to simulate 35 seconds ago
      const oldTime = Math.floor(Date.now() / 1000) - 35;
      await env.DB.prepare(`UPDATE messages SET created_at = ? WHERE id = ?`).bind(oldTime, message.id).run();

      const recallRes = await app.request(
        `/messages/${message.id}/recall`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(recallRes.status).toBe(400);
      const err = (await recallRes.json()) as any;
      expect(err.error).toContain('expired');
    });
  });

  describe('Media Storage (R2) & Synchronized Destruction', () => {
    it('uploads media file to R2, stores metadata, and serves media stream', async () => {
      const formData = new FormData();
      const dummyFile = new File(['voice-audio-bytes-12345'], 'voice_sample.mp3', {
        type: 'audio/mpeg',
      });
      formData.append('file', dummyFile);
      formData.append('type', 'voice');
      formData.append('duration', '4.5');

      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${aliceToken}` },
          body: formData,
        },
        env
      );

      expect(sendRes.status).toBe(201);
      const data = (await sendRes.json()) as any;
      expect(data.message.type).toBe('voice');
      expect(data.message.content.startsWith('voices/')).toBe(true);
      expect(data.message.media).toBeDefined();
      expect(data.message.media.duration).toBe(4.5);

      const objectKey = data.message.content;

      // Verify retrieval from /media/:key
      const mediaRes = await app.request(`/media/${objectKey}`, {}, env);
      expect(mediaRes.status).toBe(200);
      const text = await mediaRes.text();
      expect(text).toBe('voice-audio-bytes-12345');
    });

    it('purges R2 media immediately upon 30s message recall', async () => {
      const formData = new FormData();
      const dummyImage = new File(['image-png-binary-data'], 'photo.png', {
        type: 'image/png',
      });
      formData.append('file', dummyImage);
      formData.append('type', 'image');

      const sendRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${aliceToken}` },
          body: formData,
        },
        env
      );

      const data = (await sendRes.json()) as any;
      const objectKey = data.message.content;

      // Confirm object exists in R2
      const beforeRecall = await env.VOICE_BUCKET.get(objectKey);
      expect(beforeRecall).not.toBeNull();

      // Alice recalls message
      const recallRes = await app.request(
        `/messages/${data.message.id}/recall`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );
      expect(recallRes.status).toBe(200);

      // Confirm object is purged from R2
      const afterRecall = await env.VOICE_BUCKET.get(objectKey);
      expect(afterRecall).toBeNull();

      // Confirm /media/:key returns 410 (recalled)
      const mediaRes = await app.request(`/media/${objectKey}`, {}, env);
      expect(mediaRes.status).toBe(410);
    });
  });

  describe('GET /conversations/:id/messages', () => {
    it('retrieves conversation message history and filters out burned messages', async () => {
      const now = Math.floor(Date.now() / 1000);

      // 1. Regular active message
      await app.request(
        `/conversations/${dmId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'Msg 1 - Active' }),
        },
        env
      );

      // 2. Expired burned message
      await env.DB.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, type, content, retention,
          status, expires_at, delivered_at, read_at, created_at
        ) VALUES (?, ?, ?, 'text', 'Msg 2 - Burned', 'on_read', 'read', ?, ?, ?, ?)`
      )
        .bind('burned-msg', dmId, alice.address, now - 10, now - 50, now - 40, now - 60)
        .run();

      const getRes = await app.request(
        `/conversations/${dmId}/messages`,
        {
          headers: { Authorization: `Bearer ${bobToken}` },
        },
        env
      );

      expect(getRes.status).toBe(200);
      const data = (await getRes.json()) as any;
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].content).toBe('Msg 1 - Active');
    });
  });

  describe('Group Chat on_read Dual-Lifecycle & Fallback Expiration Protocol', () => {
    it('activates burn countdown only after ALL non-sender group members mark as read', async () => {
      // Group #1 has 3 members: Alice (sender), Bob, Charlie
      vi.spyOn(ContractService.prototype, 'getGroupOverview').mockResolvedValue({
        groupId: 1n,
        groupAddress: '0x3333333333333333333333333333333333333333' as `0x${string}`,
        owner: alice.address as `0x${string}`,
        pendingOwner: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        status: 0 as any, // ACTIVE
        joinMode: 0 as any,
        memberCount: 3n,
        maxMembers: 100n,
        metadataVersion: 1,
        metadata: { name: 'Alpha Builders' },
      });

      vi.spyOn(ContractService.prototype, 'canPostToGroup').mockResolvedValue({ allowed: true });
      vi.spyOn(ContractService.prototype, 'getGroupMemberStatus').mockResolvedValue({
        isMember: true,
        role: 0 as any,
        status: 1 as any,
        isMuted: false,
        isBanned: false,
        muteUntil: 0n,
        banUntil: 0n,
      });

      // 1. Alice sends an on_read message to group:1
      const postRes = await app.request(
        '/conversations/group:1/messages',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'Confidential group roadmap',
            retention: 'on_read',
            burn_after_seconds: 30,
          }),
        },
        env
      );
      expect(postRes.status).toBe(201);
      const { message } = (await postRes.json()) as any;
      expect(message.retention).toBe('on_read');
      expect(message.expires_at).toBe(0);

      // 2. Bob reads the message first -> client deletes locally, server records receipt, expires_at stays 0
      const bobReadRes = await app.request(
        `/messages/${message.id}/read`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${bobToken}` },
        },
        env
      );
      expect(bobReadRes.status).toBe(200);
      const bobReadData = (await bobReadRes.json()) as any;
      expect(bobReadData.message.status).toBe('read');
      // Charlie has not read yet! Distinct readers = 1 < (3 - 1 = 2) -> expires_at MUST remain 0
      expect(bobReadData.message.expires_at).toBe(0);

      // Verify receipt stored for Bob
      const receiptsRes = await app.request(
        `/messages/${message.id}/receipts`,
        { headers: { Authorization: `Bearer ${aliceToken}` } },
        env
      );
      expect(receiptsRes.status).toBe(200);
      const receiptsData = (await receiptsRes.json()) as any;
      expect(receiptsData.total_read).toBe(1);

      // 3. Charlie now reads the message -> ALL non-sender members (2/2) have read -> activates burn countdown!
      const charlieReadRes = await app.request(
        `/messages/${message.id}/read`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${charlieToken}` },
        },
        env
      );
      expect(charlieReadRes.status).toBe(200);
      const charlieReadData = (await charlieReadRes.json()) as any;
      // All members have read -> countdown activated!
      expect(charlieReadData.message.expires_at).toBeGreaterThan(0);
      expect(charlieReadData.message.expires_at).toBe(charlieReadData.message.read_at + 30);

      // 4. Sweeper purges expired message after burn window
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare('UPDATE messages SET expires_at = ? WHERE id = ?')
        .bind(now - 1, message.id)
        .run();

      const sweeperResult = await SweeperService.runSweeper(env);
      expect(sweeperResult.purged_messages_count).toBeGreaterThanOrEqual(1);

      const checkDb = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(message.id).first();
      expect(checkDb).toBeNull();
    });

    it('purges unread group on_read messages once fallback TTL is exceeded', async () => {
      const now = Math.floor(Date.now() / 1000);
      const fallbackTtl = 60; // 60 seconds fallback for test
      env.EPHEMERAL_FALLBACK_TTL_SECONDS = fallbackTtl;

      // Group message created 100 seconds ago, never read by anyone (expires_at = 0)
      const oldMsgId = 'old-unopened-group-msg';
      await env.DB.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, type, content, retention,
          status, expires_at, delivered_at, read_at, created_at
        ) VALUES (?, 'group:1', ?, 'text', 'Old secret note', 'on_read', 'pending', 0, NULL, NULL, ?)`
      )
        .bind(oldMsgId, alice.address.toLowerCase(), now - 100)
        .run();

      // Recent group message created 10 seconds ago
      const freshMsgId = 'fresh-unopened-group-msg';
      await env.DB.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, type, content, retention,
          status, expires_at, delivered_at, read_at, created_at
        ) VALUES (?, 'group:1', ?, 'text', 'Fresh secret note', 'on_read', 'pending', 0, NULL, NULL, ?)`
      )
        .bind(freshMsgId, alice.address.toLowerCase(), now - 10)
        .run();

      // Sweeper runs and should purge the old fallback-expired message, but retain fresh message
      const sweeperReport = await SweeperService.runSweeper(env);
      expect(sweeperReport.purged_messages_count).toBeGreaterThanOrEqual(1);

      const oldRow = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(oldMsgId).first();
      expect(oldRow).toBeNull();

      const freshRow = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(freshMsgId).first();
      expect(freshRow).not.toBeNull();
    });
  });
});
