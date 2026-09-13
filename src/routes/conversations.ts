// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import { isAddress, getAddress } from "viem";
import type { AppEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { ContractService } from "../services/contract";
import { ConversationService, serializeBigInt } from "../services/conversation";

export const conversationsRouter = new Hono<AppEnv>();

conversationsRouter.use("*", authMiddleware);

/**
 * GET /conversations
 * Discovers user's on-chain groups and active direct conversations.
 */
conversationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const contractService = new ContractService(c.env);
  const normUser = getAddress(user.wallet_address).toLowerCase();

  // 1. Fetch user's on-chain groups from smart contract (cached)
  let groupIds: bigint[] = [];
  try {
    groupIds = await contractService.getUserGroups(normUser);
  } catch {
    // Fallback if contract read fails or user has no groups
  }

  // 2. Fetch distinct direct conversation IDs from D1 messages
  const dmQuery = await c.env.DB
    .prepare(
      `SELECT DISTINCT conversation_id FROM messages
       WHERE conversation_id LIKE 'dm:%'
         AND (conversation_id LIKE ? OR conversation_id LIKE ?)`
    )
    .bind(`dm:${normUser}:%`, `%:${normUser}`)
    .all<{ conversation_id: string }>();

  const dmIds = (dmQuery.results || []).map((r) => r.conversation_id);

  // 3. Resolve details for all groups
  const groupDetailsPromises = groupIds.map(async (gid) => {
    try {
      const convId = ConversationService.buildGroupConversationId(gid);
      return await ConversationService.getConversationDetails(convId, normUser, contractService);
    } catch {
      return null;
    }
  });

  // 4. Resolve details for all direct conversations
  const dmDetailsPromises = dmIds.map(async (dmId) => {
    try {
      return await ConversationService.getConversationDetails(dmId, normUser, contractService);
    } catch {
      return null;
    }
  });

  const [groupResults, dmResults] = await Promise.all([
    Promise.all(groupDetailsPromises),
    Promise.all(dmDetailsPromises),
  ]);

  const conversations = [...groupResults, ...dmResults].filter(Boolean);

  return c.json(serializeBigInt({ conversations }));
});

/**
 * POST /conversations/direct
 * Initiates or returns canonical direct conversation ID for a peer.
 */
conversationsRouter.post("/direct", async (c) => {
  const user = c.get("user");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { target_address } = body || {};
  if (!target_address || !isAddress(target_address)) {
    return c.json({ error: "Invalid or missing target_address" }, 400);
  }

  const normUser = getAddress(user.wallet_address).toLowerCase();
  const normTarget = getAddress(target_address).toLowerCase();

  const conversationId = ConversationService.buildDirectConversationId(normUser, normTarget);
  const contractService = new ContractService(c.env);

  const postCheck = await contractService.canPostDirectMessage(normUser, normTarget);

  return c.json({
    conversation_id: conversationId,
    target_address: normTarget,
    can_post: postCheck.allowed,
    block_reason: postCheck.reason,
  });
});

/**
 * GET /conversations/:id
 * Retrieves details and permission status for a specific conversation.
 */
conversationsRouter.get("/:id", async (c) => {
  const conversationId = c.req.param("id");
  const user = c.get("user");
  const contractService = new ContractService(c.env);

  try {
    const access = await ConversationService.verifyAccess(
      conversationId,
      user.wallet_address,
      contractService
    );

    if (!access.allowed) {
      return c.json(
        serializeBigInt({
          error: "Access denied to this conversation",
          reason: access.reason,
          conversation: access.details,
        }),
        403
      );
    }

    return c.json(serializeBigInt({ conversation: access.details }));
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to resolve conversation" }, 400);
  }
});
