// SPDX-License-Identifier: MIT
import { isAddress, getAddress } from "viem";
import type { ContractService, GroupMemberStatus } from "./contract";
import { GroupStatus, Role } from "@web3-chat/sdk";

export type ConversationType = "dm" | "group";

export interface ParsedConversation {
  id: string;
  type: ConversationType;
  groupId?: bigint;
  peerAddress?: string;
  participants?: [string, string];
}

export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") {
    return obj.toString() as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt) as unknown as T;
  }
  if (typeof obj === "object") {
    const res: any = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = serializeBigInt(v);
    }
    return res;
  }
  return obj;
}

export interface ConversationDetails {
  id: string;
  type: ConversationType;
  groupId?: string;
  peerAddress?: string;
  name?: string;
  metadata?: Record<string, any>;
  memberStatus?: any;
  canPost: boolean;
  blockReason?: string;
}

export class ConversationService {
  /**
   * Deterministic direct conversation ID: dm:minAddress:maxAddress
   */
  public static buildDirectConversationId(addr1: string, addr2: string): string {
    if (!isAddress(addr1) || !isAddress(addr2)) {
      throw new Error("Invalid address for direct conversation");
    }
    const a = getAddress(addr1).toLowerCase();
    const b = getAddress(addr2).toLowerCase();
    const [min, max] = a < b ? [a, b] : [b, a];
    return `dm:${min}:${max}`;
  }

  /**
   * Canonical group conversation ID: group:groupId
   */
  public static buildGroupConversationId(groupId: bigint | string | number): string {
    const raw = typeof groupId === "string" && groupId.startsWith("group:")
      ? groupId.substring(6)
      : groupId.toString();
    return `group:${raw}`;
  }

  /**
   * Parses conversation ID into structured object.
   */
  public static parseConversationId(
    conversationId: string,
    currentUser?: string
  ): ParsedConversation {
    const trimmed = conversationId.trim();

    if (trimmed.startsWith("dm:")) {
      const parts = trimmed.split(":");
      if (parts.length !== 3) {
        throw new Error(`Invalid direct conversation ID format: ${conversationId}`);
      }
      const p1 = parts[1].toLowerCase();
      const p2 = parts[2].toLowerCase();

      let peerAddress: string | undefined = undefined;
      if (currentUser) {
        const normUser = currentUser.toLowerCase();
        peerAddress = normUser === p1 ? p2 : p1;
      }

      return {
        id: trimmed,
        type: "dm",
        participants: [p1, p2],
        peerAddress,
      };
    }

    // Otherwise group conversation
    let rawGroupId = trimmed;
    if (trimmed.startsWith("group:")) {
      rawGroupId = trimmed.substring(6);
    }

    try {
      const gid = BigInt(rawGroupId);
      return {
        id: `group:${gid.toString()}`,
        type: "group",
        groupId: gid,
      };
    } catch {
      throw new Error(`Invalid conversation ID: ${conversationId}`);
    }
  }

  /**
   * Resolves conversation details and checks permissions for current user.
   */
  public static async getConversationDetails(
    conversationId: string,
    currentUser: string,
    contractService: ContractService
  ): Promise<ConversationDetails> {
    const normUser = getAddress(currentUser).toLowerCase();
    const parsed = this.parseConversationId(conversationId, normUser);

    if (parsed.type === "dm") {
      const [p1, p2] = parsed.participants!;
      if (normUser !== p1 && normUser !== p2) {
        return {
          id: parsed.id,
          type: "dm",
          peerAddress: parsed.peerAddress,
          canPost: false,
          blockReason: "NOT_CONVERSATION_PARTICIPANT",
        };
      }

      const peer = parsed.peerAddress!;
      const postEligibility = await contractService.canPostDirectMessage(normUser, peer);

      let peerOverview: any = null;
      try {
        peerOverview = await contractService.getUserOverview(peer);
      } catch {
        // Fallback if not registered
      }

      return {
        id: parsed.id,
        type: "dm",
        peerAddress: peer,
        name: peerOverview?.metadata?.name || peer,
        metadata: peerOverview?.metadata || undefined,
        canPost: postEligibility.allowed,
        blockReason: postEligibility.reason,
      };
    }

    // Group conversation
    const gid = parsed.groupId!;
    let groupOverview: any;
    try {
      groupOverview = await contractService.getGroupOverview(gid);
    } catch {
      return {
        id: parsed.id,
        type: "group",
        groupId: gid.toString(),
        canPost: false,
        blockReason: "GROUP_NOT_FOUND",
      };
    }

    const memberStatus = await contractService.getGroupMemberStatus(gid, normUser);
    const postEligibility = await contractService.canPostToGroup(gid, normUser);

    return serializeBigInt({
      id: parsed.id,
      type: "group",
      groupId: gid.toString(),
      name: groupOverview.metadata?.title || groupOverview.metadata?.name || `Group #${gid.toString()}`,
      metadata: groupOverview.metadata,
      memberStatus,
      canPost: postEligibility.allowed,
      blockReason: postEligibility.reason,
    });
  }

  /**
   * Verifies whether current user is authorized to read/participate in the conversation.
   */
  public static async verifyAccess(
    conversationId: string,
    currentUser: string,
    contractService: ContractService
  ): Promise<{ allowed: boolean; reason?: string; details: ConversationDetails }> {
    const details = await this.getConversationDetails(conversationId, currentUser, contractService);

    if (details.type === "dm") {
      const parsed = this.parseConversationId(conversationId, currentUser);
      const [p1, p2] = parsed.participants!;
      const norm = currentUser.toLowerCase();
      if (norm !== p1 && norm !== p2) {
        return {
          allowed: false,
          reason: "NOT_CONVERSATION_PARTICIPANT",
          details,
        };
      }
      return { allowed: true, details };
    }

    // Group conversation
    if (!details.memberStatus?.isMember) {
      return {
        allowed: false,
        reason: details.memberStatus?.isBanned ? "USER_BANNED_IN_GROUP" : "NOT_GROUP_MEMBER",
        details,
      };
    }

    return { allowed: true, details };
  }
}
