// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { ContractService } from "../services/contract";
import { ConversationService, serializeBigInt } from "../services/conversation";

export const groupsRouter = new Hono<AppEnv>();

groupsRouter.use("/groups/*", authMiddleware);

/**
 * GET /groups/:id
 * Retrieves group overview from smart contract.
 */
groupsRouter.get("/groups/:id", async (c) => {
  const param = c.req.param("id");
  const parsed = ConversationService.parseConversationId(param);

  if (parsed.type !== "group" || parsed.groupId === undefined) {
    return c.json({ error: "Invalid group ID format" }, 400);
  }

  const contractService = new ContractService(c.env);
  try {
    const overview = await contractService.getGroupOverview(parsed.groupId);
    return c.json(
      serializeBigInt({
        group: {
          id: `group:${parsed.groupId.toString()}`,
          groupId: parsed.groupId,
          groupAddress: overview.groupAddress,
          owner: overview.owner,
          name: overview.metadata?.name || null,
          description: overview.metadata?.description || null,
          announcement: overview.metadata?.announcement || null,
          marquee: overview.metadata?.marquee || null,
          status: overview.status,
          joinMode: overview.joinMode,
          memberCount: overview.memberCount,
          maxMembers: overview.maxMembers,
          metadataVersion: overview.metadataVersion,
          metadata: overview.metadata,
        },
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message || "Group not found" }, 404);
  }
});

/**
 * GET /groups/:id/members
 * Retrieves group members list with pagination.
 */
groupsRouter.get("/groups/:id/members", async (c) => {
  const param = c.req.param("id");
  const parsed = ConversationService.parseConversationId(param);

  if (parsed.type !== "group" || parsed.groupId === undefined) {
    return c.json({ error: "Invalid group ID format" }, 400);
  }

  const offsetParam = c.req.query("offset");
  const limitParam = c.req.query("limit");
  const offset = offsetParam ? BigInt(offsetParam) : 0n;
  const limit = limitParam ? BigInt(limitParam) : 50n;

  const contractService = new ContractService(c.env);
  try {
    const members = await contractService.getGroupMembers(
      parsed.groupId,
      offset,
      limit
    );
    return c.json(
      serializeBigInt({
        group_id: `group:${parsed.groupId.toString()}`,
        members,
        offset,
        limit,
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to retrieve members" }, 404);
  }
});

/**
 * GET /groups/:id/muted
 * Retrieves group mute state and caller mute status.
 */
groupsRouter.get("/groups/:id/muted", async (c) => {
  const param = c.req.param("id");
  const user = c.get("user");
  const parsed = ConversationService.parseConversationId(param);

  if (parsed.type !== "group" || parsed.groupId === undefined) {
    return c.json({ error: "Invalid group ID format" }, 400);
  }

  const contractService = new ContractService(c.env);
  try {
    const status = await contractService.getGroupMemberStatus(
      parsed.groupId,
      user.wallet_address
    );

    return c.json(
      serializeBigInt({
        group_id: `group:${parsed.groupId.toString()}`,
        user_address: user.wallet_address,
        is_member: status.isMember,
        role: status.role,
        is_muted: status.isMuted,
        is_banned: status.isBanned,
        mute_until: status.muteUntil,
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to retrieve mute status" }, 400);
  }
});
