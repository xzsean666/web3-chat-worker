// SPDX-License-Identifier: MIT
import {
  type Address,
  type Chain,
  type PublicClient,
  getAddress,
} from "viem";
import { foundry, mainnet } from "viem/chains";
import {
  ChatSDK,
  type ChatGroupOverview,
  type ChatUserOverview,
  GroupStatus,
  MemberStatus,
  Role,
  type RpcPoolConfig,
} from "@web3-chat/sdk";
import type { Env } from "../types";

export interface GroupMemberStatus {
  isMember: boolean;
  role: Role;
  status: MemberStatus;
  isMuted: boolean;
  isBanned: boolean;
  muteUntil: bigint;
  banUntil: bigint;
}

export interface PostEligibility {
  allowed: boolean;
  reason?: string;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ContractServiceOptions {
  factoryAddress?: string;
  rpcUrls?: string | string[];
  chainId?: number | string;
  cacheTtlSeconds?: number | string;
  publicClient?: PublicClient;
  sdk?: ChatSDK;
}

export class ContractService {
  private static globalCache = new Map<string, CacheEntry<any>>();
  private static globalSdkMap = new Map<string, ChatSDK>();

  public readonly sdk: ChatSDK;
  public readonly cacheTtlMs: number;
  private cache: Map<string, CacheEntry<any>>;

  constructor(optionsOrEnv: ContractServiceOptions | Env) {
    const opts = parseServiceOptions(optionsOrEnv);
    this.cacheTtlMs = (opts.cacheTtlSeconds ?? 60) * 1000;

    if (opts.sdk) {
      this.sdk = opts.sdk;
      this.cache = new Map<string, CacheEntry<any>>();
    } else {
      this.cache = ContractService.globalCache;

      const chain = resolveChain(opts.chainId);
      const factoryAddress = (opts.factoryAddress ||
        "0x0000000000000000000000000000000000000000") as Address;

      if (opts.publicClient) {
        this.sdk = new ChatSDK({
          factoryAddress,
          chain,
          publicClient: opts.publicClient,
        });
      } else {
        const rpcPool = buildRpcPoolConfig(opts.rpcUrls);
        const sdkKey = `${factoryAddress.toLowerCase()}:${chain.id}:${rpcPool.rpcUrls?.join(",")}`;
        let cachedSdk = ContractService.globalSdkMap.get(sdkKey);
        if (!cachedSdk) {
          cachedSdk = new ChatSDK({
            factoryAddress,
            chain,
            rpcPool,
          });
          ContractService.globalSdkMap.set(sdkKey, cachedSdk);
        }
        this.sdk = cachedSdk;
      }
    }
  }

  // --- Cache Helpers ---

  public getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  public setCached<T>(key: string, value: T, ttlMs = this.cacheTtlMs): void {
    if (this.cache.size > 10000) {
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (now > v.expiresAt) {
          this.cache.delete(k);
        }
      }
      if (this.cache.size > 9000) {
        let count = 0;
        for (const k of this.cache.keys()) {
          this.cache.delete(k);
          if (++count >= 1000) break;
        }
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public deleteCached(key: string): void {
    this.cache.delete(key);
  }

  public clearCache(): void {
    this.cache.clear();
    ContractService.globalCache.clear();
  }

  public invalidateUser(userAddress: string): void {
    const norm = userAddress.toLowerCase();
    for (const key of this.cache.keys()) {
      if (key.includes(norm)) {
        this.cache.delete(key);
      }
    }
  }

  public invalidateGroup(groupId: bigint | string | number): void {
    const gid = groupId.toString();
    for (const key of this.cache.keys()) {
      if (key.includes(`group:${gid}`) || key.includes(`group_member:${gid}:`) || key.includes(`group_overview:${gid}`)) {
        this.cache.delete(key);
      }
    }
  }

  // --- On-Chain Queries with TTL Caching ---

  public async getUserGroups(userAddress: string): Promise<bigint[]> {
    const normalized = getAddress(userAddress);
    const cacheKey = `user_groups:${normalized.toLowerCase()}`;
    const cached = this.getCached<bigint[]>(cacheKey);
    if (cached) return cached;

    const groups = await this.sdk.getUserGroups(normalized);
    this.setCached(cacheKey, groups);
    return groups;
  }

  public async getGroupMemberStatus(
    groupId: bigint,
    userAddress: string
  ): Promise<GroupMemberStatus> {
    const normalized = getAddress(userAddress);
    const cacheKey = `group_member:${groupId.toString()}:${normalized.toLowerCase()}`;
    const cached = this.getCached<GroupMemberStatus>(cacheKey);
    if (cached) return cached;

    const groupClient = await this.sdk.group(groupId);
    const rolePromise =
      typeof groupClient?.getMemberRole === "function"
        ? groupClient.getMemberRole(normalized).catch(() => undefined)
        : Promise.resolve(undefined);

    const [member, role] = await Promise.all([
      groupClient.getMember(normalized),
      rolePromise,
    ]);

    const now = BigInt(Math.floor(Date.now() / 1000));
    const isMuted = member.muteUntil > 0n && member.muteUntil > now;
    const isBanned =
      member.status === MemberStatus.BANNED ||
      (member.banUntil > 0n && member.banUntil > now);
    const isMember = member.status === MemberStatus.MEMBER && !isBanned;

    const result: GroupMemberStatus = {
      isMember,
      role: role !== undefined ? role : member.role,
      status: member.status,
      isMuted,
      isBanned,
      muteUntil: member.muteUntil,
      banUntil: member.banUntil,
    };

    this.setCached(cacheKey, result);
    return result;
  }

  public async isBlocked(
    userAddress: string,
    targetAddress: string
  ): Promise<boolean> {
    const normUser = getAddress(userAddress);
    const normTarget = getAddress(targetAddress);
    const cacheKey = `is_blocked:${normUser.toLowerCase()}:${normTarget.toLowerCase()}`;
    const cached = this.getCached<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const userClient = await this.sdk.user(normUser);
      const blocked = await userClient.isBlocked(normTarget);
      this.setCached(cacheKey, blocked);
      return blocked;
    } catch {
      // If user contract is not registered yet or fails, assume not blocked
      this.setCached(cacheKey, false);
      return false;
    }
  }

  public async getGroupOverview(groupId: bigint): Promise<ChatGroupOverview> {
    const cacheKey = `group_overview:${groupId.toString()}`;
    const cached = this.getCached<ChatGroupOverview>(cacheKey);
    if (cached) return cached;

    const overview = await this.sdk.getGroupOverview(groupId);
    this.setCached(cacheKey, overview);
    return overview;
  }

  public async getGroupMembers(
    groupId: bigint,
    offset = 0n,
    limit = 50n
  ): Promise<string[]> {
    const cacheKey = `group_members:${groupId.toString()}:${offset.toString()}:${limit.toString()}`;
    const cached = this.getCached<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const groupClient = await this.sdk.group(groupId);
      const members = await groupClient.getMembers(offset, limit);
      const strMembers = members.map((m) => m.toString());
      this.setCached(cacheKey, strMembers);
      return strMembers;
    } catch {
      this.setCached(cacheKey, []);
      return [];
    }
  }

  public async getUserOverview(userAddress: string): Promise<ChatUserOverview> {
    const normalized = getAddress(userAddress);
    const cacheKey = `user_overview:${normalized.toLowerCase()}`;
    const cached = this.getCached<ChatUserOverview>(cacheKey);
    if (cached) return cached;

    const overview = await this.sdk.getCurrentUser(normalized);
    this.setCached(cacheKey, overview);
    return overview;
  }

  public async getUserFriends(
    userAddress: string,
    offset = 0n,
    limit = 50n
  ): Promise<string[]> {
    const normalized = getAddress(userAddress);
    const cacheKey = `user_friends:${normalized.toLowerCase()}:${offset.toString()}:${limit.toString()}`;
    const cached = this.getCached<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const userClient = await this.sdk.user(normalized);
      const friends = await userClient.getFriends(offset, limit);
      const strFriends = friends.map((f) => f.toString());
      this.setCached(cacheKey, strFriends);
      return strFriends;
    } catch {
      this.setCached(cacheKey, []);
      return [];
    }
  }

  public async isFriend(
    userAddress: string,
    targetAddress: string
  ): Promise<boolean> {
    const normUser = getAddress(userAddress);
    const normTarget = getAddress(targetAddress);
    const cacheKey = `is_friend:${normUser.toLowerCase()}:${normTarget.toLowerCase()}`;
    const cached = this.getCached<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const userClient = await this.sdk.user(normUser);
      const isFr = await userClient.isFriend(normTarget);
      this.setCached(cacheKey, isFr);
      return isFr;
    } catch {
      this.setCached(cacheKey, false);
      return false;
    }
  }

  // --- Permission & Eligibility Checks ---

  public async canPostDirectMessage(
    senderAddress: string,
    recipientAddress: string
  ): Promise<PostEligibility> {
    const sender = getAddress(senderAddress);
    const recipient = getAddress(recipientAddress);

    if (sender.toLowerCase() === recipient.toLowerCase()) {
      return { allowed: true };
    }

    const blocked = await this.isBlocked(recipient, sender);
    if (blocked) {
      return {
        allowed: false,
        reason: "BLOCKED_BY_RECIPIENT",
      };
    }

    return { allowed: true };
  }

  public async canPostToGroup(
    groupId: bigint,
    userAddress: string
  ): Promise<PostEligibility> {
    const normUser = getAddress(userAddress);

    let overview: ChatGroupOverview;
    try {
      overview = await this.getGroupOverview(groupId);
    } catch {
      return {
        allowed: false,
        reason: "GROUP_NOT_FOUND",
      };
    }

    if (overview.status !== GroupStatus.ACTIVE) {
      return {
        allowed: false,
        reason: "GROUP_INACTIVE",
      };
    }

    const memberStatus = await this.getGroupMemberStatus(groupId, normUser);
    if (memberStatus.isBanned) {
      return {
        allowed: false,
        reason: "USER_BANNED_IN_GROUP",
      };
    }

    if (!memberStatus.isMember) {
      return {
        allowed: false,
        reason: "NOT_GROUP_MEMBER",
      };
    }

    if (memberStatus.isMuted) {
      return {
        allowed: false,
        reason: "USER_MUTED_IN_GROUP",
      };
    }

    return { allowed: true };
  }
}

// --- Helpers ---

function parseServiceOptions(input: ContractServiceOptions | Env): {
  factoryAddress?: string;
  rpcUrls?: string | string[];
  chainId?: number | string;
  cacheTtlSeconds?: number;
  publicClient?: PublicClient;
  sdk?: ChatSDK;
} {
  const isEnv = (x: any): x is Env => "DB" in x && "VOICE_BUCKET" in x;
  if (isEnv(input)) {
    return {
      factoryAddress: input.FACTORY_ADDRESS,
      rpcUrls: input.RPC_URLS,
      chainId: input.CHAIN_ID,
      cacheTtlSeconds: input.RPC_CACHE_TTL_SECONDS
        ? Number(input.RPC_CACHE_TTL_SECONDS)
        : 60,
    };
  }

  return {
    ...input,
    cacheTtlSeconds: input.cacheTtlSeconds
      ? Number(input.cacheTtlSeconds)
      : 60,
  };
}

function resolveChain(chainId?: number | string): Chain {
  const id = chainId ? Number(chainId) : 31337;
  if (id === 1) return mainnet;
  if (id === 31337) return foundry;
  return {
    ...foundry,
    id,
    name: `CustomChain-${id}`,
  };
}

function buildRpcPoolConfig(rpcUrls?: string | string[]): RpcPoolConfig {
  if (Array.isArray(rpcUrls) && rpcUrls.length > 0) {
    return { rpcUrls };
  }

  if (typeof rpcUrls === "string" && rpcUrls.trim().length > 0) {
    const urls = rpcUrls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      return { rpcUrls: urls };
    }
  }

  return {
    rpcUrls: ["http://127.0.0.1:8545"],
  };
}
