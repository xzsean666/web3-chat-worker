// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { SyncService } from "../services/sync";
import { serializeBigInt } from "../services/conversation";

export const syncRouter = new Hono<AppEnv>();

syncRouter.use("*", authMiddleware);

/**
 * GET /sync?since=<timestamp>&limit=<number>
 * Incremental timestamp sync across all groups and direct conversations.
 */
syncRouter.get("/", async (c) => {
  const user = c.get("user");
  const sinceParam = c.req.query("since");
  const limitParam = c.req.query("limit");

  const since = sinceParam ? parseInt(sinceParam, 10) : 0;
  const limit = limitParam ? parseInt(limitParam, 10) : 100;

  try {
    const result = await SyncService.sync(
      c.env,
      user.wallet_address,
      since,
      limit
    );
    return c.json(serializeBigInt(result));
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to perform sync" }, 400);
  }
});
