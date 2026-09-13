import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/index';
import { createMockD1Database } from './helpers/db';
import { createMockR2Bucket } from './helpers/r2';
import { createTestWallet } from './helpers/wallet';
import { ConversationService } from '../src/services/conversation';
import { ContractService } from '../src/services/contract';
import { SweeperService } from '../src/services/sweeper';
import { GroupStatus, MemberStatus, Role } from '@web3-chat/sdk';
import type { Env } from '../src/types';

describe('End-to-End Integration: Lightweight Web3 Chat Worker Node', () => {
  const alice = createTestWallet();
  const bob = createTestWallet();

  const env: Env = {
    DB: createMockD1Database(),
    VOICE_BUCKET: createMockR2Bucket(),
    FACTORY_ADDRESS: '0x1111111111111111111111111111111111111111',
    RPC_URLS: 'http://127.0.0.1:8545',
    RPC_CACHE_TTL_SECONDS: '60',
    MESSAGE_RECALL_WINDOW_SECONDS: '30',
  };

  let aliceToken: string;
  let bobToken: string;
  let dmConversationId: string;
  let textMessageId: string;
  let mediaObjectKey: string;
  let ephemeralMessageId: string;

  it('Stage 1: EVM EIP-191 Challenge-Response Authentication', async () => {
    // 1. Alice requests nonce & signs
    const aliceNonceRes = await app.request(`/auth/nonce?address=${alice.address}`, {}, env);
    expect(aliceNonceRes.status).toBe(200);
    const { nonce: aNonce, message: aMsg } = (await aliceNonceRes.json()) as any;
    const aSig = await alice.signMessage(aMsg);

    const aliceVerifyRes = await app.request(
      '/auth/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: alice.address, signature: aSig, nonce: aNonce }),
      },
      env
    );
    expect(aliceVerifyRes.status).toBe(200);
    const aliceData = (await aliceVerifyRes.json()) as any;
    aliceToken = aliceData.token;
    expect(aliceToken).toBeDefined();

    // 2. Bob requests nonce & signs
    const bobNonceRes = await app.request(`/auth/nonce?address=${bob.address}`, {}, env);
    expect(bobNonceRes.status).toBe(200);
    const { nonce: bNonce, message: bMsg } = (await bobNonceRes.json()) as any;
    const bSig = await bob.signMessage(bMsg);

    const bobVerifyRes = await app.request(
      '/auth/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: bob.address, signature: bSig, nonce: bNonce }),
      },
      env
    );
    expect(bobVerifyRes.status).toBe(200);
    const bobData = (await bobVerifyRes.json()) as any;
    bobToken = bobData.token;
    expect(bobToken).toBeDefined();

    // 3. Alice checks profile at /auth/me
    const meRes = await app.request('/auth/me', { headers: { Authorization: `Bearer ${aliceToken}` } }, env);
    expect(meRes.status).toBe(200);
    const meData = (await meRes.json()) as any;
    expect(meData.user.wallet_address).toBe(alice.address);
  });

  it('Stage 2: Lightweight Conversation Resolution & Discovery', async () => {
    // 1. Alice creates direct conversation with Bob
    const directRes = await app.request(
      '/conversations/direct',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target_address: bob.address }),
      },
      env
    );

    expect(directRes.status).toBe(200);
    const directData = (await directRes.json()) as any;
    dmConversationId = directData.conversation_id;
    expect(dmConversationId).toBe(ConversationService.buildDirectConversationId(alice.address, bob.address));
    expect(directData.can_post).toBe(true);

    // 2. Mock on-chain group discovery for Alice
    const mockGroups = vi.spyOn(ContractService.prototype, 'getUserGroups').mockResolvedValue([1n]);
    const mockOverview = vi.spyOn(ContractService.prototype, 'getGroupOverview').mockResolvedValue({
      groupId: 1n,
      groupAddress: '0x2222222222222222222222222222222222222222',
      owner: alice.address as any,
      pendingOwner: '0x0000000000000000000000000000000000000000',
      status: GroupStatus.ACTIVE,
      joinMode: 0,
      maxMembers: 100n,
      memberCount: 2n,
      metadataVersion: 1,
      metadata: { title: 'Founders Lounge' },
    });
    const mockMember = vi.spyOn(ContractService.prototype, 'getGroupMemberStatus').mockResolvedValue({
      isMember: true,
      role: Role.OWNER,
      status: MemberStatus.MEMBER,
      isMuted: false,
      isBanned: false,
      muteUntil: 0n,
      banUntil: 0n,
    });

    const convListRes = await app.request(
      '/conversations',
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(convListRes.status).toBe(200);
    const listData = (await convListRes.json()) as any;
    expect(listData.conversations.some((c: any) => c.id === 'group:1')).toBe(true);

    mockGroups.mockRestore();
    mockOverview.mockRestore();
    mockMember.mockRestore();
  });

  it('Stage 3: Message Transit & Explicit Delivery / Read ACK', async () => {
    // 1. Alice sends text message (starts in 'pending' status)
    const sendRes = await app.request(
      `/conversations/${dmConversationId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Hey Bob, checking out the lightweight worker node!',
          retention: 'permanent',
        }),
      },
      env
    );

    expect(sendRes.status).toBe(201);
    const sendData = (await sendRes.json()) as any;
    textMessageId = sendData.message.id;
    expect(sendData.message.status).toBe('pending');

    // 2. Bob explicitly ACKs delivery
    const ackRes = await app.request(
      `/messages/${textMessageId}/ack`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bobToken}` },
      },
      env
    );
    expect(ackRes.status).toBe(200);
    const ackData = (await ackRes.json()) as any;
    expect(ackData.message.status).toBe('delivered');

    // 3. Bob explicitly ACKs read
    const readRes = await app.request(
      `/messages/${textMessageId}/read`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bobToken}` },
      },
      env
    );
    expect(readRes.status).toBe(200);
    const readData = (await readRes.json()) as any;
    expect(readData.message.status).toBe('read');
  });

  it('Stage 4: Dual-Storage Media & 30-Second Recall Protocol', async () => {
    // 1. Alice uploads an audio message
    const formData = new FormData();
    const voiceBlob = new File(['mock-audio-payload-bytes'], 'voice.aac', { type: 'audio/aac' });
    formData.append('file', voiceBlob);
    formData.append('type', 'voice');
    formData.append('duration', '3.2');

    const uploadRes = await app.request(
      `/conversations/${dmConversationId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: formData,
      },
      env
    );

    expect(uploadRes.status).toBe(201);
    const uploadData = (await uploadRes.json()) as any;
    const mediaMsgId = uploadData.message.id;
    mediaObjectKey = uploadData.message.content;
    expect(mediaObjectKey.startsWith('voices/')).toBe(true);

    // 2. Bob can stream the media
    const streamRes = await app.request(`/media/${mediaObjectKey}`, {}, env);
    expect(streamRes.status).toBe(200);
    expect(await streamRes.text()).toBe('mock-audio-payload-bytes');

    // 3. Alice recalls the media message within 30 seconds
    const recallRes = await app.request(
      `/messages/${mediaMsgId}/recall`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      },
      env
    );
    expect(recallRes.status).toBe(200);

    // 4. Verify R2 binary was immediately purged
    const r2Check = await env.VOICE_BUCKET.get(mediaObjectKey);
    expect(r2Check).toBeNull();

    // 5. Subsequent media fetch returns 410 (recalled)
    const streamAfterRecall = await app.request(`/media/${mediaObjectKey}`, {}, env);
    expect(streamAfterRecall.status).toBe(410);
  });

  it('Stage 5: Ephemeral Messaging & 30s Burn Window Protocol', async () => {
    // 1. Alice sends an on_read ephemeral message
    const sendRes = await app.request(
      `/conversations/${dmConversationId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Confidential message: burns 30s after reading.',
          retention: 'on_read',
          burn_after_seconds: 30,
        }),
      },
      env
    );

    expect(sendRes.status).toBe(201);
    const sendData = (await sendRes.json()) as any;
    ephemeralMessageId = sendData.message.id;
    expect(sendData.message.retention).toBe('on_read');
    expect(sendData.message.expires_at).toBe(0);

    // 2. Bob reads message -> triggers 30s burn countdown
    const readRes = await app.request(
      `/messages/${ephemeralMessageId}/read`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bobToken}` },
      },
      env
    );

    expect(readRes.status).toBe(200);
    const readData = (await readRes.json()) as any;
    expect(readData.message.expires_at).toBe(readData.message.read_at + 30);

    // 3. Simulate passage of 35 seconds (message has burned)
    const burnedTime = Math.floor(Date.now() / 1000) - 5;
    await env.DB.prepare(`UPDATE messages SET expires_at = ? WHERE id = ?`).bind(burnedTime, ephemeralMessageId).run();

    // 4. Bob syncs -> burned message is excluded
    const syncRes = await app.request(
      `/sync?since=0`,
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    expect(syncData.messages.some((m: any) => m.id === ephemeralMessageId)).toBe(false);

    // 5. Sweeper runs and purges the row from D1
    const sweepReport = await SweeperService.runSweeper(env);
    expect(sweepReport.purged_messages_count).toBeGreaterThanOrEqual(1);
    const dbCheck = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(ephemeralMessageId).first();
    expect(dbCheck).toBeNull();
  });

  it('Stage 6: On-Chain Social Relationship & Blacklist Enforcement', async () => {
    // 1. Simulate Bob blocking Alice on-chain
    const blockSpy = vi.spyOn(ContractService.prototype, 'isBlocked').mockImplementation(
      async (user, target) => {
        // If query is checking whether Bob blocked Alice
        if (user.toLowerCase() === bob.address.toLowerCase() && target.toLowerCase() === alice.address.toLowerCase()) {
          return true;
        }
        return false;
      }
    );

    // 2. Alice attempts to send direct message to Bob
    const blockedRes = await app.request(
      `/conversations/${dmConversationId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Are you there Bob?' }),
      },
      env
    );

    expect(blockedRes.status).toBe(400);
    const errData = (await blockedRes.json()) as any;
    expect(errData.error).toContain('BLOCKED_BY_RECIPIENT');

    blockSpy.mockRestore();
  });

  it('Stage 7: Incremental Timestamp Sync across Groups and Direct Chats', async () => {
    const now = Math.floor(Date.now() / 1000);

    // Sync from 10 seconds ago
    const syncRes = await app.request(
      `/sync?since=${now - 30}`,
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );

    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    expect(syncData.sync_timestamp).toBeGreaterThanOrEqual(now);
    expect(Array.isArray(syncData.messages)).toBe(true);
    expect(Array.isArray(syncData.receipts)).toBe(true);
  });
});
