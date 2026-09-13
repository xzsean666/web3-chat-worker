import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv, MessageRow } from "../types";
import { authMiddleware } from "../middleware/auth";
import { MessageService } from "../services/message";
import { serializeBigInt } from "../services/conversation";

export const mediaRouter = new Hono<AppEnv>();

// --- Upload Endpoints (Require Auth) ---
mediaRouter.use("/voice/upload", authMiddleware);
mediaRouter.use("/images/upload", authMiddleware);
mediaRouter.use("/files/upload", authMiddleware);

mediaRouter.post("/voice/upload", async (c) => {
  const user = c.get("user");
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversation_id") as string;
    const duration = formData.get("duration")
      ? parseFloat(formData.get("duration") as string)
      : 1.0;
    const retention = (formData.get("retention") as any) || "permanent";
    const burnAfterSeconds = formData.get("burn_after_seconds")
      ? parseInt(formData.get("burn_after_seconds") as string, 10)
      : 30;

    if (!file || !conversationId) {
      return c.json({ error: "Missing file or conversation_id" }, 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const message = await MessageService.sendMediaMessage(c.env, {
      conversationId,
      senderAddress: user.wallet_address,
      type: "voice",
      fileData: fileBuffer,
      fileName: file.name || "voice.ogg",
      mimeType: file.type || "audio/ogg",
      duration,
      retention,
      burnAfterSeconds,
    });

    return c.json(serializeBigInt({ message }), 201);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to upload voice" }, 400);
  }
});

mediaRouter.post("/images/upload", async (c) => {
  const user = c.get("user");
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversation_id") as string;
    const width = formData.get("width")
      ? parseInt(formData.get("width") as string, 10)
      : undefined;
    const height = formData.get("height")
      ? parseInt(formData.get("height") as string, 10)
      : undefined;
    const retention = (formData.get("retention") as any) || "permanent";
    const burnAfterSeconds = formData.get("burn_after_seconds")
      ? parseInt(formData.get("burn_after_seconds") as string, 10)
      : 30;

    if (!file || !conversationId) {
      return c.json({ error: "Missing file or conversation_id" }, 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const message = await MessageService.sendMediaMessage(c.env, {
      conversationId,
      senderAddress: user.wallet_address,
      type: "image",
      fileData: fileBuffer,
      fileName: file.name || "image.png",
      mimeType: file.type || "image/png",
      width,
      height,
      retention,
      burnAfterSeconds,
    });

    return c.json(serializeBigInt({ message }), 201);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to upload image" }, 400);
  }
});

mediaRouter.post("/files/upload", async (c) => {
  const user = c.get("user");
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversation_id") as string;
    const retention = (formData.get("retention") as any) || "permanent";
    const burnAfterSeconds = formData.get("burn_after_seconds")
      ? parseInt(formData.get("burn_after_seconds") as string, 10)
      : 30;

    if (!file || !conversationId) {
      return c.json({ error: "Missing file or conversation_id" }, 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const message = await MessageService.sendMediaMessage(c.env, {
      conversationId,
      senderAddress: user.wallet_address,
      type: "file",
      fileData: fileBuffer,
      fileName: file.name || "document",
      mimeType: file.type || "application/octet-stream",
      retention,
      burnAfterSeconds,
    });

    return c.json(serializeBigInt({ message }), 201);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to upload file" }, 400);
  }
});

mediaRouter.get("/voice/:id", async (c) => {
  const messageId = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT m.recalled_at, m.expires_at, m.retention, m.created_at, v.object_key, v.mime_type
     FROM messages m
     LEFT JOIN voice_messages v ON v.message_id = m.id
     WHERE m.id = ? LIMIT 1`
  )
    .bind(messageId)
    .first<{
      recalled_at: number | null;
      expires_at: number;
      retention: string;
      created_at: number;
      object_key: string | null;
      mime_type: string | null;
    }>();

  if (!row) {
    return c.json({ error: "Message not found" }, 404);
  }
  if (row.recalled_at) {
    return c.json({ error: "Message was recalled" }, 410);
  }
  const now = Math.floor(Date.now() / 1000);
  const fallbackTtl = Number(c.env.EPHEMERAL_FALLBACK_TTL_SECONDS) || 7 * 86400;
  const isFallbackExpired = row.retention === "on_read" && row.expires_at === 0 && row.created_at <= (now - fallbackTtl);
  if ((row.expires_at > 0 && row.expires_at <= now) || isFallbackExpired) {
    return c.json({ error: "Message expired and burned" }, 410);
  }
  if (!row.object_key) {
    return c.json({ error: "Voice binary was purged from transit relay" }, 410);
  }

  const object = await c.env.VOICE_BUCKET.get(row.object_key);
  if (!object) {
    return c.json({ error: "Voice binary was purged from transit relay" }, 410);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", row.mime_type || "audio/ogg");
  headers.set("Cache-Control", "private, max-age=3600");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body as any, { status: 200, headers });
});

mediaRouter.get("/images/:id", async (c) => {
  const messageId = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT m.recalled_at, m.expires_at, m.retention, m.created_at, i.object_key, i.mime_type
     FROM messages m
     LEFT JOIN image_messages i ON i.message_id = m.id
     WHERE m.id = ? LIMIT 1`
  )
    .bind(messageId)
    .first<{
      recalled_at: number | null;
      expires_at: number;
      retention: string;
      created_at: number;
      object_key: string | null;
      mime_type: string | null;
    }>();

  if (!row) {
    return c.json({ error: "Message not found" }, 404);
  }
  if (row.recalled_at) {
    return c.json({ error: "Message was recalled" }, 410);
  }
  const now = Math.floor(Date.now() / 1000);
  const fallbackTtl = Number(c.env.EPHEMERAL_FALLBACK_TTL_SECONDS) || 7 * 86400;
  const isFallbackExpired = row.retention === "on_read" && row.expires_at === 0 && row.created_at <= (now - fallbackTtl);
  if ((row.expires_at > 0 && row.expires_at <= now) || isFallbackExpired) {
    return c.json({ error: "Message expired and burned" }, 410);
  }
  if (!row.object_key) {
    return c.json({ error: "Image binary was purged from transit relay" }, 410);
  }

  const object = await c.env.VOICE_BUCKET.get(row.object_key);
  if (!object) {
    return c.json({ error: "Image binary was purged from transit relay" }, 410);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", row.mime_type || "image/png");
  headers.set("Cache-Control", "private, max-age=3600");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body as any, { status: 200, headers });
});

mediaRouter.get("/files/:id", async (c) => {
  const messageId = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT m.recalled_at, m.expires_at, m.retention, m.created_at, f.object_key, f.file_name, f.mime_type
     FROM messages m
     LEFT JOIN file_messages f ON f.message_id = m.id
     WHERE m.id = ? LIMIT 1`
  )
    .bind(messageId)
    .first<{
      recalled_at: number | null;
      expires_at: number;
      retention: string;
      created_at: number;
      object_key: string | null;
      file_name: string | null;
      mime_type: string | null;
    }>();

  if (!row) {
    return c.json({ error: "Message not found" }, 404);
  }
  if (row.recalled_at) {
    return c.json({ error: "Message was recalled" }, 410);
  }
  const now = Math.floor(Date.now() / 1000);
  const fallbackTtl = Number(c.env.EPHEMERAL_FALLBACK_TTL_SECONDS) || 7 * 86400;
  const isFallbackExpired = row.retention === "on_read" && row.expires_at === 0 && row.created_at <= (now - fallbackTtl);
  if ((row.expires_at > 0 && row.expires_at <= now) || isFallbackExpired) {
    return c.json({ error: "Message expired and burned" }, 410);
  }
  if (!row.object_key) {
    return c.json({ error: "File binary was purged from transit relay" }, 410);
  }

  const object = await c.env.VOICE_BUCKET.get(row.object_key);
  if (!object) {
    return c.json({ error: "File binary was purged from transit relay" }, 410);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", row.mime_type || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(row.file_name || "file")}"`
  );
  headers.set("Cache-Control", "private, max-age=3600");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body as any, { status: 200, headers });
});
