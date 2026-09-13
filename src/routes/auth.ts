// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { AuthService } from "../services/auth";
import { ContractService } from "../services/contract";
import { authMiddleware } from "../middleware/auth";

export const authRouter = new Hono<AppEnv>();

/**
 * GET /auth/nonce?address=0x...
 * Issues a challenge nonce and message for EIP-191 signing.
 */
authRouter.get("/nonce", async (c) => {
  const address = c.req.query("address");
  if (!address) {
    return c.json({ error: "Missing required query parameter: address" }, 400);
  }

  try {
    const result = await AuthService.createNonce(c.env.DB, address);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to create nonce" }, 400);
  }
});

/**
 * POST /auth/verify
 * Body: { address: string, signature: string, nonce: string }
 * Verifies EIP-191 signature and issues session Bearer token.
 */
authRouter.post("/verify", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { address, signature, nonce } = body || {};
  if (!address || !signature || !nonce) {
    return c.json({ error: "Missing address, signature, or nonce" }, 400);
  }

  try {
    const contractService = new ContractService(c.env);
    const result = await AuthService.verifySignature(
      c.env.DB,
      contractService,
      address,
      signature,
      nonce
    );
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || "Authentication failed" }, 401);
  }
});

/**
 * GET /auth/me
 * Returns current authenticated user and their on-chain overview.
 */
authRouter.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  const contractService = new ContractService(c.env);

  let onChainOverview: any = null;
  try {
    onChainOverview = await contractService.getUserOverview(user.wallet_address);
  } catch {
    // Graceful fallback if clone is not yet created
  }

  return c.json({
    user: {
      ...user,
      contract_address: onChainOverview?.cloneAddress || user.contract_address || null,
      metadata: onChainOverview?.metadata || user.metadata || null,
    },
    onChain: onChainOverview,
  });
});

/**
 * POST /auth/logout
 * Destroys current active session.
 */
authRouter.post("/logout", authMiddleware, async (c) => {
  const token = c.get("token");
  await AuthService.destroySession(c.env.DB, token);
  return c.json({ success: true, message: "Logged out successfully" });
});
