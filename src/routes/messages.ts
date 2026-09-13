// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { AppEnv, MessageRow } from "../types";
import { authMiddleware } from "../middleware/auth";
import { MessageService } from "../services/message";
import { ConversationService, serializeBigInt } from "../services/conversation";
import { ContractService } from "../services/contract";

export const messagesRouter = new Hono<AppEnv>();

/**
 * Public/auth media retrieval: GET /media/:key
 */
messagesRouter.get("/media/*", async (c) => {
  const path = c.req.path;
  const key = path.replace(/^\/media\//, "");
  if (!key) {
    return c.json({ error: "Missing media key" }, 400);
  }

  // Check if associated message is recalled or expired
  const message = await c.env.DB.prepare(
    `SELECT * FROM messages WHERE content = ? LIMIT 1`
  )
    .bind(key)
    .first<MessageRow>();

  if (!message) {
    return c.json({ error: "Media not found" }, 404);
  }

  if (message.recalled_at) {
    return c.json({ error: "Media was recalled" }, 410);
  }

  const now = Math.floor(Date.now() / 1000);
  if (message.expires_at > 0 && message.expires_at <= now) {
    return c.json({ error: "Media expired and burned" }, 410);
  }

  const object = await c.env.VOICE_BUCKET.get(key);
  if (!object) {
    return c.json({ error: "Media object not found in storage" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=3600");

  return new Response(object.body as any, { headers });
});

// All subsequent message routes require authentication
messagesRouter.use("/conversations/*", authMiddleware);
messagesRouter.use("/messages", authMiddleware);
messagesRouter.use("/messages/*", authMiddleware);

const MAX_MESSAGE_CONTENT_LENGTH = 32 * 1024; // 32 KB
const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * GET /conversations/:id/messages
 * Retrieves active messages in conversation (filtering out burned messages).
 */
messagesRouter.get("/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const user = c.get("user");
  const contractService = new ContractService(c.env);

  const access = await ConversationService.verifyAccess(
    conversationId,
    user.wallet_address,
    contractService
  );

  if (!access.allowed) {
    return c.json(
      serializeBigInt({
        error: "Access denied to conversation messages",
        reason: access.reason,
      }),
      403
    );
  }

  const limitParam = c.req.query("limit");
  const beforeParam = c.req.query("before");
  const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10) || 50, 100)) : 50;
  const before = beforeParam ? parseInt(beforeParam, 10) : undefined;

  const messages = await MessageService.getConversationMessages(
    c.env,
    access.details.id,
    limit,
    before
  );

  return c.json(serializeBigInt({ messages }));
});

/**
 * POST /conversations/:id/messages
 * Sends a text or media message to a conversation.
 */
messagesRouter.post("/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const user = c.get("user");
  const contentType = c.req.header("Content-Type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      const { content, retention, burn_after_seconds, mentions } = body || {};

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return c.json({ error: "Message content cannot be empty" }, 400);
      }
      if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
        return c.json({ error: "Message content exceeds maximum allowed size (32KB)" }, 400);
      }

      const message = await MessageService.sendTextMessage(c.env, {
        conversationId,
        senderAddress: user.wallet_address,
        content: content.trim(),
        retention,
        burnAfterSeconds: burn_after_seconds,
        mentions,
      });

      return c.json(serializeBigInt({ message }), 201);
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = formData.get("file") as File | null;
      const type = (formData.get("type") as "voice" | "image" | "file") || "file";
      const retention = (formData.get("retention") as any) || "permanent";
      const burnAfterSeconds = formData.get("burn_after_seconds")
        ? parseInt(formData.get("burn_after_seconds") as string, 10)
        : 30;
      const duration = formData.get("duration")
        ? parseFloat(formData.get("duration") as string)
        : undefined;
      const width = formData.get("width")
        ? parseInt(formData.get("width") as string, 10)
        : undefined;
      const height = formData.get("height")
        ? parseInt(formData.get("height") as string, 10)
        : undefined;

      if (!file) {
        return c.json({ error: "Missing media file in form-data" }, 400);
      }
      if (file.size > MAX_MEDIA_FILE_SIZE) {
        return c.json({ error: "Media file exceeds maximum allowed size (50MB)" }, 400);
      }

      const fileBuffer = await file.arrayBuffer();
      const message = await MessageService.sendMediaMessage(c.env, {
        conversationId,
        senderAddress: user.wallet_address,
        type,
        fileData: fileBuffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        duration,
        width,
        height,
        retention,
        burnAfterSeconds,
      });

      return c.json(serializeBigInt({ message }), 201);
    } else {
      return c.json({ error: "Unsupported Content-Type" }, 415);
    }
  } catch (err: any) {
    if (err.message?.startsWith("Cannot post message:")) {
      const reason = err.message.replace("Cannot post message:", "").trim();
      return c.json({ error: err.message, reason }, 400);
    }
    return c.json({ error: err.message || "Failed to send message" }, 400);
  }
});

/**
 * POST /messages
 * Sends a text or media message with conversation_id specified in the payload.
 */
messagesRouter.post("/messages", async (c) => {
  const user = c.get("user");
  const contentType = c.req.header("Content-Type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      const {
        conversation_id,
        content,
        retention,
        burn_after_seconds,
        mentions,
      } = body || {};

      if (!conversation_id || typeof conversation_id !== "string") {
        return c.json({ error: "Missing conversation_id" }, 400);
      }
      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return c.json({ error: "Message content cannot be empty" }, 400);
      }
      if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
        return c.json({ error: "Message content exceeds maximum allowed size (32KB)" }, 400);
      }

      const message = await MessageService.sendTextMessage(c.env, {
        conversationId: conversation_id,
        senderAddress: user.wallet_address,
        content: content.trim(),
        retention,
        burnAfterSeconds: burn_after_seconds,
        mentions,
      });

      return c.json(serializeBigInt({ message }), 201);
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const conversationId = formData.get("conversation_id") as string | null;
      if (!conversationId) {
        return c.json({ error: "Missing conversation_id in form-data" }, 400);
      }
      const file = formData.get("file") as File | null;
      const type = (formData.get("type") as "voice" | "image" | "file") || "file";
      const retention = (formData.get("retention") as any) || "permanent";
      const burnAfterSeconds = formData.get("burn_after_seconds")
        ? parseInt(formData.get("burn_after_seconds") as string, 10)
        : 30;
      const duration = formData.get("duration")
        ? parseFloat(formData.get("duration") as string)
        : undefined;
      const width = formData.get("width")
        ? parseInt(formData.get("width") as string, 10)
        : undefined;
      const height = formData.get("height")
        ? parseInt(formData.get("height") as string, 10)
        : undefined;

      if (!file) {
        return c.json({ error: "Missing media file in form-data" }, 400);
      }
      if (file.size > MAX_MEDIA_FILE_SIZE) {
        return c.json({ error: "Media file exceeds maximum allowed size (50MB)" }, 400);
      }

      const fileBuffer = await file.arrayBuffer();
      const message = await MessageService.sendMediaMessage(c.env, {
        conversationId,
        senderAddress: user.wallet_address,
        type,
        fileData: fileBuffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        duration,
        width,
        height,
        retention,
        burnAfterSeconds,
      });

      return c.json(serializeBigInt({ message }), 201);
    } else {
      return c.json({ error: "Unsupported Content-Type" }, 415);
    }
  } catch (err: any) {
    if (err.message?.startsWith("Cannot post message:")) {
      const reason = err.message.replace("Cannot post message:", "").trim();
      return c.json({ error: err.message, reason }, 400);
    }
    return c.json({ error: err.message || "Failed to send message" }, 400);
  }
});

/**
 * POST /messages/ack
 * Batch delivery ACK for multiple messages.
 */
messagesRouter.post("/messages/ack", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json().catch(() => ({}));
    const messageIds = body.message_ids || [];
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return c.json({ error: "message_ids array is required" }, 400);
    }

    const result = await MessageService.batchAcknowledgeDelivery(
      c.env,
      messageIds,
      user.wallet_address
    );
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to batch acknowledge" }, 400);
  }
});

/**
 * POST /messages/read
 * Batch read ACK for multiple messages.
 */
messagesRouter.post("/messages/read", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json().catch(() => ({}));
    const messageIds = body.message_ids || [];
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return c.json({ error: "message_ids array is required" }, 400);
    }

    const result = await MessageService.batchMarkAsRead(
      c.env,
      messageIds,
      user.wallet_address
    );
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to batch mark as read" }, 400);
  }
});

/**
 * GET /messages/:id/receipts
 * Retrieves all delivery/read receipts for a message.
 */
messagesRouter.get("/messages/:id/receipts", async (c) => {
  const messageId = c.req.param("id");
  try {
    const receipts = await MessageService.getMessageReceipts(c.env, messageId);
    return c.json(serializeBigInt(receipts));
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to get receipts" }, 400);
  }
});

/**
 * POST /messages/:id/ack
 * Explicit delivery ACK by receiver.
 */
messagesRouter.post("/messages/:id/ack", async (c) => {
  const messageId = c.req.param("id");
  const user = c.get("user");

  try {
    const message = await MessageService.acknowledgeDelivery(
      c.env,
      messageId,
      user.wallet_address
    );
    return c.json(serializeBigInt({ message }));
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to acknowledge message" }, 400);
  }
});

/**
 * POST /messages/:id/read
 * Explicit read ACK by receiver (triggers 30s burn countdown if on_read).
 */
messagesRouter.post("/messages/:id/read", async (c) => {
  const messageId = c.req.param("id");
  const user = c.get("user");

  try {
    const message = await MessageService.markAsRead(
      c.env,
      messageId,
      user.wallet_address
    );
    return c.json(serializeBigInt({ message }));
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to mark message as read" }, 400);
  }
});

/**
 * POST /messages/:id/recall
 * Sender recalls message within 30 seconds.
 */
messagesRouter.post("/messages/:id/recall", async (c) => {
  const messageId = c.req.param("id");
  const user = c.get("user");

  try {
    const message = await MessageService.recallMessage(
      c.env,
      messageId,
      user.wallet_address
    );
    return c.json(serializeBigInt({ message }));
  } catch (err: any) {
    const status = err.message?.includes("Unauthorized") ? 403 : 400;
    return c.json({ error: err.message || "Failed to recall message" }, status);
  }
});
