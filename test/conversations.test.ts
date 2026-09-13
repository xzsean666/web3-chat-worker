import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from '../src/index';
import { createMockD1Database } from './helpers/db';
import { createMockR2Bucket } from './helpers/r2';
import { createTestWallet } from './helpers/wallet';
import { ConversationService } from '../src/services/conversation';
import { hashToken } from '../src/services/auth';
import { ContractService } from '../src/services/contract';
import { GroupStatus, MemberStatus, Role } from '@web3-chat/sdk';
import type { Env } from '../src/types';

describe('Lightweight Group & Conversation Access Management (/conversations)', () => {
  let env: Env;
  const alice = createTestWallet();
  const bob = createTestWallet();
  const charlie = createTestWallet();

  let aliceToken: string;
  let bobToken: string;

  beforeEach(async () => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: '0x1111111111111111111111111111111111111111',
      RPC_URLS: 'http://127.0.0.1:8545',
      RPC_CACHE_TTL_SECONDS: '60',
    };

    aliceToken = 'alice-auth-token';
    bobToken = 'bob-auth-token';
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    )
      .bind(
        'alice-session',
        alice.address.toLowerCase(),
        await hashToken(aliceToken),
        now + 86400,
        now,
        'bob-session',
        bob.address.toLowerCase(),
        await hashToken(bobToken),
        now + 86400,
        now
      )
      .run();
  });

  describe('ConversationService Canonical Logic', () => {
    it('generates deterministic direct conversation IDs regardless of parameter order', () => {
      const id1 = ConversationService.buildDirectConversationId(alice.address, bob.address);
      const id2 = ConversationService.buildDirectConversationId(bob.address, alice.address);
      expect(id1).toBe(id2);
      expect(id1.startsWith('dm:')).toBe(true);
    });

    it('generates canonical group conversation IDs', () => {
      expect(ConversationService.buildGroupConversationId(42n)).toBe('group:42');
      expect(ConversationService.buildGroupConversationId('group:42')).toBe('group:42');
    });

    it('parses direct and group conversation IDs', () => {
      const dmId = ConversationService.buildDirectConversationId(alice.address, bob.address);
      const parsedDm = ConversationService.parseConversationId(dmId, alice.address);
      expect(parsedDm.type).toBe('dm');
      expect(parsedDm.peerAddress).toBe(bob.address.toLowerCase());

      const parsedGroup = ConversationService.parseConversationId('group:99', alice.address);
      expect(parsedGroup.type).toBe('group');
      expect(parsedGroup.groupId).toBe(99n);
    });
  });

  describe('POST /conversations/direct', () => {
    it('initiates direct conversation and returns canonical ID', async () => {
      const res = await app.request(
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

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.conversation_id).toBe(
        ConversationService.buildDirectConversationId(alice.address, bob.address)
      );
      expect(data.target_address).toBe(bob.address.toLowerCase());
      expect(data.can_post).toBe(true);
    });
  });

  describe('GET /conversations/:id Access Control', () => {
    it('allows participants to access direct conversation', async () => {
      const dmId = ConversationService.buildDirectConversationId(alice.address, bob.address);
      const res = await app.request(
        `/conversations/${dmId}`,
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.conversation.id).toBe(dmId);
      expect(data.conversation.type).toBe('dm');
      expect(data.conversation.peerAddress).toBe(bob.address.toLowerCase());
      expect(data.conversation.canPost).toBe(true);
    });

    it('forbids third party from accessing direct conversation', async () => {
      // Direct conversation between Bob and Charlie
      const dmId = ConversationService.buildDirectConversationId(bob.address, charlie.address);

      // Alice tries to access it
      const res = await app.request(
        `/conversations/${dmId}`,
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.reason).toBe('NOT_CONVERSATION_PARTICIPANT');
    });

    it('enforces group access based on on-chain membership', async () => {
      const mockContract = vi.spyOn(ContractService.prototype, 'getGroupOverview').mockResolvedValue({
        groupId: 10n,
        groupAddress: '0x3333333333333333333333333333333333333333',
        owner: alice.address as any,
        pendingOwner: '0x0000000000000000000000000000000000000000',
        status: GroupStatus.ACTIVE,
        joinMode: 0,
        maxMembers: 100n,
        memberCount: 5n,
        metadataVersion: 1,
        metadata: { title: 'Alpha Community' },
      });

      const mockMember = vi.spyOn(ContractService.prototype, 'getGroupMemberStatus').mockResolvedValue({
        isMember: true,
        role: Role.MEMBER,
        status: MemberStatus.MEMBER,
        isMuted: false,
        isBanned: false,
        muteUntil: 0n,
        banUntil: 0n,
      });

      const res = await app.request(
        '/conversations/group:10',
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.conversation.type).toBe('group');
      expect(data.conversation.name).toBe('Alpha Community');
      expect(data.conversation.canPost).toBe(true);

      mockContract.mockRestore();
      mockMember.mockRestore();
    });

    it('rejects group access for non-members', async () => {
      vi.spyOn(ContractService.prototype, 'getGroupOverview').mockResolvedValueOnce({
        groupId: 10n,
        groupAddress: '0x3333333333333333333333333333333333333333',
        owner: '0x0000000000000000000000000000000000000000',
        pendingOwner: '0x0000000000000000000000000000000000000000',
        status: GroupStatus.ACTIVE,
        joinMode: 0,
        maxMembers: 100n,
        memberCount: 5n,
        metadataVersion: 1,
        metadata: {},
      });

      vi.spyOn(ContractService.prototype, 'getGroupMemberStatus').mockResolvedValueOnce({
        isMember: false,
        role: Role.MEMBER,
        status: MemberStatus.NONE,
        isMuted: false,
        isBanned: false,
        muteUntil: 0n,
        banUntil: 0n,
      });

      const res = await app.request(
        '/conversations/group:10',
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.reason).toBe('NOT_GROUP_MEMBER');
    });
  });

  describe('GET /conversations Discovery', () => {
    it('discovers user on-chain groups and D1 direct conversations', async () => {
      // 1. Insert a direct message into D1 involving Alice
      const dmId = ConversationService.buildDirectConversationId(alice.address, bob.address);
      await env.DB.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, type, content, retention, status, expires_at, created_at)
         VALUES (?, ?, ?, 'text', 'Hi Bob', 'permanent', 'delivered', 0, ?)`
      )
        .bind(crypto.randomUUID(), dmId, alice.address, Math.floor(Date.now() / 1000))
        .run();

      // 2. Mock on-chain user groups
      vi.spyOn(ContractService.prototype, 'getUserGroups').mockResolvedValueOnce([1n]);
      vi.spyOn(ContractService.prototype, 'getGroupOverview').mockResolvedValueOnce({
        groupId: 1n,
        groupAddress: '0x3333333333333333333333333333333333333333',
        owner: alice.address as any,
        pendingOwner: '0x0000000000000000000000000000000000000000',
        status: GroupStatus.ACTIVE,
        joinMode: 0,
        maxMembers: 100n,
        memberCount: 1n,
        metadataVersion: 1,
        metadata: { title: 'Alice VIP' },
      });

      vi.spyOn(ContractService.prototype, 'getGroupMemberStatus').mockResolvedValueOnce({
        isMember: true,
        role: Role.OWNER,
        status: MemberStatus.MEMBER,
        isMuted: false,
        isBanned: false,
        muteUntil: 0n,
        banUntil: 0n,
      });

      const res = await app.request(
        '/conversations',
        {
          headers: { Authorization: `Bearer ${aliceToken}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.conversations).toHaveLength(2);

      const groupConv = data.conversations.find((c: any) => c.type === 'group');
      const dmConv = data.conversations.find((c: any) => c.type === 'dm');

      expect(groupConv).toBeDefined();
      expect(groupConv.name).toBe('Alice VIP');

      expect(dmConv).toBeDefined();
      expect(dmConv.id).toBe(dmId);
    });
  });
});
