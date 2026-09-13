// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import type { AppEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { UserService } from "../services/users";
import { ContractService } from "../services/contract";
import { serializeBigInt } from "../services/conversation";

export const usersRouter = new Hono<AppEnv>();

// Public endpoint: Stream user avatar image
usersRouter.get("/users/:address/avatar", async (c) => {
  const address = c.req.param("address");
  const result = await UserService.getAvatar(c.env.VOICE_BUCKET, address);

  if (!result) {
    return c.json({ error: "Avatar not found" }, 404);
  }

  const headers = new Headers();
  result.object.writeHttpMetadata(headers);
  headers.set("Content-Type", result.mimeType);
  headers.set("Cache-Control", "public, max-age=3600");
  if (result.object.httpEtag) {
    headers.set("ETag", result.object.httpEtag);
  }

  return new Response(result.object.body as any, { status: 200, headers });
});

// Authenticated user avatar & metadata routes
usersRouter.use("/users/me/*", authMiddleware);
usersRouter.use("/users/me", authMiddleware);

usersRouter.post("/users/me/avatar", async (c) => {
  const user = c.get("user");
  const contentType = c.req.header("Content-Type") || "";

  let avatarBytes: Uint8Array;
  let mimeType = "image/png";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = (formData.get("file") ||
        formData.get("avatar") ||
        formData.get("image")) as File | null;

      if (!file) {
        return c.json({ error: "Missing avatar file in form-data" }, 400);
      }

      mimeType = file.type || "image/png";
      const buffer = await file.arrayBuffer();
      avatarBytes = new Uint8Array(buffer);
    } else if (contentType.includes("application/json")) {
      const body = await c.req.json();
      const base64 =
        body.avatar_base64 || body.file_base64 || body.image_base64;
      if (!base64 || typeof base64 !== "string") {
        return c.json({ error: "Missing avatar_base64 in JSON payload" }, 400);
      }
      mimeType = body.mime_type || "image/png";
      const binary = atob(base64);
      avatarBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        avatarBytes[i] = binary.charCodeAt(i);
      }
    } else if (
      contentType.startsWith("image/") ||
      contentType.includes("application/octet-stream")
    ) {
      mimeType = contentType.startsWith("image/") ? contentType : "image/png";
      const buffer = await c.req.arrayBuffer();
      avatarBytes = new Uint8Array(buffer);
    } else {
      return c.json({ error: "Unsupported Content-Type" }, 415);
    }

    const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
    if (avatarBytes.byteLength > MAX_AVATAR_SIZE) {
      return c.json({ error: "Avatar size exceeds 5MB limit" }, 400);
    }

    const result = await UserService.uploadAvatar(
      c.env.VOICE_BUCKET,
      user.wallet_address,
      avatarBytes,
      mimeType
    );

    return c.json(result, 201);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to upload avatar" }, 400);
  }
});

usersRouter.get("/users/me/metadata", async (c) => {
  const user = c.get("user");
  const metadata = await UserService.getUserMetadata(
    c.env.DB,
    user.wallet_address
  );
  return c.json({ metadata });
});

const handleSetMetadata = async (c: any) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const metadata = await UserService.setUserMetadata(
    c.env.DB,
    user.wallet_address,
    body
  );
  return c.json({ metadata });
};

usersRouter.put("/users/me/metadata", handleSetMetadata);
usersRouter.patch("/users/me/metadata", handleSetMetadata);

// Public endpoint: Get user public profile overview
usersRouter.get("/users/:address", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) {
    return c.json({ error: "Invalid Ethereum address" }, 400);
  }

  const normalized = getAddress(address);
  const contractService = new ContractService(c.env);

  try {
    const overview = await contractService.getUserOverview(normalized);
    const hasAvatar = await UserService.getAvatar(c.env.VOICE_BUCKET, normalized);
    const onChainAvatar = overview.metadata?.avatar || overview.metadata?.avatar_url || null;

    return c.json(
      serializeBigInt({
        user: {
          address: normalized,
          avatar_url: onChainAvatar || (hasAvatar ? `/users/${normalized.toLowerCase()}/avatar` : null),
          status: overview.status,
          metadata: overview.metadata,
          metadataVersion: overview.metadataVersion,
          friendCount: overview.friendCount,
          groupCount: overview.groupCount,
        },
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to fetch user profile" }, 404);
  }
});
