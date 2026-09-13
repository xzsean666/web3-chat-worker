import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContractService } from '../src/services/contract';
import { GroupStatus, MemberStatus, Role, type ChatSDK } from '@web3-chat/sdk';
import { createTestWallet } from './helpers/wallet';

describe('ContractService & TTL Caching Layer', () => {
  const wallet1 = createTestWallet();
  const wallet2 = createTestWallet();
  const user1 = wallet1.address;
  const user2 = wallet2.address;
  const factoryAddress = '0x1111111111111111111111111111111111111111';

  let mockSdk: Partial<ChatSDK>;
  let service: ContractService;

  beforeEach(() => {
    mockSdk = {
      factoryAddress: factoryAddress as any,
      getUserGroups: vi.fn().mockResolvedValue([1n, 2n]),
      getCurrentUser: vi.fn().mockResolvedValue({
        userAddress: user1,
        cloneAddress: '0x2222222222222222222222222222222222222222',
        status: 0,
        metadataVersion: 1,
        metadata: { name: 'Alice' },
        stateVersion: 1,
        state: {},
        friendCount: 5n,
        groupCount: 2n,
      }),
      getGroupOverview: vi.fn().mockResolvedValue({
        groupId: 1n,
        groupAddress: '0x3333333333333333333333333333333333333333',
        owner: user1,
        pendingOwner: '0x0000000000000000000000000000000000000000',
        status: GroupStatus.ACTIVE,
        joinMode: 0,
        maxMembers: 100n,
        memberCount: 2n,
        metadataVersion: 1,
        metadata: { title: 'Web3 Builders' },
      }),
      group: vi.fn().mockResolvedValue({
        getMember: vi.fn().mockResolvedValue({
          status: MemberStatus.MEMBER,
          role: Role.MEMBER,
          joinedAt: 1000n,
          muteUntil: 0n,
          banUntil: 0n,
        }),
      }),
      user: vi.fn().mockResolvedValue({
        isBlocked: vi.fn().mockResolvedValue(false),
      }),
    };

    service = new ContractService({
      sdk: mockSdk as ChatSDK,
      cacheTtlSeconds: 1, // 1 second for easy testing
    });
  });

  describe('Initialization & Configuration', () => {
    it('initializes from options with custom TTL and SDK', () => {
      expect(service.cacheTtlMs).toBe(1000);
      expect(service.sdk).toBe(mockSdk);
    });

    it('initializes from Env object and parses comma-separated RPC URLs', () => {
      const envService = new ContractService({
        DB: {} as any,
        VOICE_BUCKET: {} as any,
        FACTORY_ADDRESS: factoryAddress,
        RPC_URLS: 'http://rpc1.local:8545, http://rpc2.local:8545',
        RPC_CACHE_TTL_SECONDS: '45',
      });
      expect(envService.cacheTtlMs).toBe(45000);
      expect(envService.sdk.factoryAddress).toBe(factoryAddress);
    });
  });

  describe('Cache Operations', () => {
    it('stores, retrieves and expires cached entries', async () => {
      service.setCached('test_key', 'test_value', 50); // 50ms
      expect(service.getCached('test_key')).toBe('test_value');

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 70));
      expect(service.getCached('test_key')).toBeUndefined();
    });

    it('invalidates cache for specific user or group', () => {
      service.setCached(`user_groups:${user1.toLowerCase()}`, [1n]);
      service.setCached(`group_overview:1`, { id: 1n });

      service.invalidateUser(user1);
      expect(service.getCached(`user_groups:${user1.toLowerCase()}`)).toBeUndefined();
      expect(service.getCached(`group_overview:1`)).toBeDefined();

      service.invalidateGroup(1n);
      expect(service.getCached(`group_overview:1`)).toBeUndefined();
    });
  });

  describe('Cached Contract Reads', () => {
    it('caches getUserGroups query result', async () => {
      const groups1 = await service.getUserGroups(user1);
      const groups2 = await service.getUserGroups(user1);

      expect(groups1).toEqual([1n, 2n]);
      expect(groups2).toEqual([1n, 2n]);
      // Only called once due to caching
      expect(mockSdk.getUserGroups).toHaveBeenCalledTimes(1);
    });

    it('caches getGroupMemberStatus and calculates mute/ban flags', async () => {
      const status1 = await service.getGroupMemberStatus(1n, user1);
      expect(status1.isMember).toBe(true);
      expect(status1.isMuted).toBe(false);
      expect(status1.isBanned).toBe(false);

      const status2 = await service.getGroupMemberStatus(1n, user1);
      expect(status2).toEqual(status1);
      expect(mockSdk.group).toHaveBeenCalledTimes(1);
    });

    it('caches isBlocked query', async () => {
      const blocked1 = await service.isBlocked(user1, user2);
      const blocked2 = await service.isBlocked(user1, user2);

      expect(blocked1).toBe(false);
      expect(blocked2).toBe(false);
      expect(mockSdk.user).toHaveBeenCalledTimes(1);
    });

    it('caches group and user overviews', async () => {
      const groupOverview = await service.getGroupOverview(1n);
      expect(groupOverview.groupId).toBe(1n);
      expect(mockSdk.getGroupOverview).toHaveBeenCalledTimes(1);

      const groupOverviewCached = await service.getGroupOverview(1n);
      expect(groupOverviewCached).toEqual(groupOverview);
      expect(mockSdk.getGroupOverview).toHaveBeenCalledTimes(1);

      const userOverview = await service.getUserOverview(user1);
      expect(userOverview.userAddress).toBe(user1);
      expect(mockSdk.getCurrentUser).toHaveBeenCalledTimes(1);

      await service.getUserOverview(user1);
      expect(mockSdk.getCurrentUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('Posting Permission Checks', () => {
    it('allows direct message if recipient has not blocked sender', async () => {
      const result = await service.canPostDirectMessage(user1, user2);
      expect(result.allowed).toBe(true);
    });

    it('blocks direct message if recipient blocked sender', async () => {
      (mockSdk.user as any).mockResolvedValueOnce({
        isBlocked: vi.fn().mockResolvedValue(true),
      });

      const result = await service.canPostDirectMessage(user1, user2);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('BLOCKED_BY_RECIPIENT');
    });

    it('allows group message when user is an active member', async () => {
      const result = await service.canPostToGroup(1n, user1);
      expect(result.allowed).toBe(true);
    });

    it('rejects group message when group is not active', async () => {
      (mockSdk.getGroupOverview as any).mockResolvedValueOnce({
        groupId: 1n,
        status: GroupStatus.PAUSED,
      });

      const result = await service.canPostToGroup(1n, user1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('GROUP_INACTIVE');
    });

    it('rejects group message when user is not a member', async () => {
      (mockSdk.group as any).mockResolvedValueOnce({
        getMember: vi.fn().mockResolvedValue({
          status: MemberStatus.NONE,
          role: Role.MEMBER,
          muteUntil: 0n,
          banUntil: 0n,
        }),
      });

      const result = await service.canPostToGroup(1n, user1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('NOT_GROUP_MEMBER');
    });

    it('rejects group message when user is muted', async () => {
      const futureTime = BigInt(Math.floor(Date.now() / 1000) + 3600);
      (mockSdk.group as any).mockResolvedValueOnce({
        getMember: vi.fn().mockResolvedValue({
          status: MemberStatus.MEMBER,
          role: Role.MEMBER,
          muteUntil: futureTime,
          banUntil: 0n,
        }),
      });

      const result = await service.canPostToGroup(1n, user1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_MUTED_IN_GROUP');
    });

    it('rejects group message when user is banned', async () => {
      (mockSdk.group as any).mockResolvedValueOnce({
        getMember: vi.fn().mockResolvedValue({
          status: MemberStatus.BANNED,
          role: Role.MEMBER,
          muteUntil: 0n,
          banUntil: 0n,
        }),
      });

      const result = await service.canPostToGroup(1n, user1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_BANNED_IN_GROUP');
    });
  });
});
