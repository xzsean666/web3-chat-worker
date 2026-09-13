// SPDX-License-Identifier: MIT
import type { MiddlewareHandler } from "hono";
import type { AppEnv, AuthUser } from "../types";
import { AuthService } from "../services/auth";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return c.json({ error: "Unauthorized: Empty token" }, 401);
  }

  const session = await AuthService.validateToken(c.env.DB, token);
  if (!session) {
    return c.json({ error: "Unauthorized: Session invalid or expired" }, 401);
  }

  const user: AuthUser = {
    id: session.user_id,
    wallet_address: session.user_id,
  };

  c.set("user", user);
  c.set("session", session);
  c.set("token", token);

  return next();
};
