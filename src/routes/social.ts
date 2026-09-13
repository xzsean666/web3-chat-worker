// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import type { AppEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { ContractService } from "../services/contract";
import { serializeBigInt } from "../services/conversation";

export const socialRouter = new Hono<AppEnv>();

socialRouter.use("/social/*", authMiddleware);

/**
 * GET /social/friends
 * Returns current user's on-chain friends list.
 */
socialRouter.get("/social/friends", async (c) => {
  const user = c.get("user");
  const contractService = new ContractService(c.env);

  const offsetParam = c.req.query("offset");
  const limitParam = c.req.query("limit");
  const offset = offsetParam ? BigInt(offsetParam) : 0n;
  const limit = limitParam ? BigInt(limitParam) : 50n;

  const friends = await contractService.getUserFriends(
    user.wallet_address,
    offset,
    limit
  );

  return c.json(serializeBigInt({ friends }));
});

/**
 * GET /social/friends/:address
 * Checks if target address is a friend of the current user.
 */
socialRouter.get("/social/friends/:address", async (c) => {
  const user = c.get("user");
  const target = c.req.param("address");

  if (!isAddress(target)) {
    return c.json({ error: "Invalid target Ethereum address" }, 400);
  }

  const contractService = new ContractService(c.env);
  const isFriend = await contractService.isFriend(
    user.wallet_address,
    getAddress(target)
  );

  return c.json({ target: getAddress(target), is_friend: isFriend });
});

/**
 * GET /social/blacklist/:address
 * Checks if target address is blocked by current user.
 */
socialRouter.get("/social/blacklist/:address", async (c) => {
  const user = c.get("user");
  const target = c.req.param("address");

  if (!isAddress(target)) {
    return c.json({ error: "Invalid target Ethereum address" }, 400);
  }

  const contractService = new ContractService(c.env);
  const isBlocked = await contractService.isBlocked(
    user.wallet_address,
    getAddress(target)
  );

  return c.json({ target: getAddress(target), is_blocked: isBlocked });
});
