import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/index";
import { createMockD1Database } from "./helpers/db";
import { createMockR2Bucket } from "./helpers/r2";
import { createTestWallet } from "./helpers/wallet";
import { hashToken } from "../src/services/auth";
import { ConversationService } from "../src/services/conversation";
import type { Env, MessageRow } from "../src/types";

describe("Message Receipts API & Batch Delivery/Read ACK (/messages/ack, /messages/read, /messages/:id/receipts)", () => {
  let env: Env;
  const alice = createTestWallet();
  const bob = createTestWallet();
  let aliceToken: string;
  let bobToken: string;
  let conversationId: string;

  beforeEach(async () => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: "0x1111111111111111111111111111111111111111",
      RPC_URLS: "http://127.0.0.1:8545",
      RPC_CACHE_TTL_SECONDS: "60",
    };

    aliceToken = "alice-receipts-token";
    bobToken = "bob-receipts-token";
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    )
      .bind(
        "alice-session",
        alice.address.toLowerCase(),
        await hashToken(aliceToken),
        now + 86400,
        now,
        "bob-session",
        bob.address.toLowerCase(),
        await hashToken(bobToken),
        now + 86400,
        now
      )
      .run();

    conversationId = ConversationService.buildDirectConversationId(
      alice.address,
      bob.address
    );
  });

  it("handles batch delivery ACK for multiple messages", async () => {
    // Alice sends 3 messages
    const sendMsg = async (content: string) => {
      const res = await app.fetch(
        new Request(`http://localhost/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ content }),
        }),
        env
      );
      const json = (await res.json()) as any;
      return json.message.id as string;
    };

    const msgId1 = await sendMsg("Message 1");
    const msgId2 = await sendMsg("Message 2");
    const msgId3 = await sendMsg("Message 3");

    // Bob batch ACKs msgId1 and msgId2
    const batchAckRes = await app.fetch(
      new Request("http://localhost/messages/ack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          message_ids: [msgId1, msgId2, "non-existent-id"],
        }),
      }),
      env
    );

    expect(batchAckRes.status).toBe(200);
    const batchAckJson = (await batchAckRes.json()) as any;
    expect(batchAckJson.acknowledged).toContain(msgId1);
    expect(batchAckJson.acknowledged).toContain(msgId2);
    expect(batchAckJson.skipped).toContain("non-existent-id");

    // Verify msg1 and msg2 status in D1 is delivered
    const row1 = await env.DB.prepare(`SELECT status FROM messages WHERE id = ?`).bind(msgId1).first<MessageRow>();
    const row2 = await env.DB.prepare(`SELECT status FROM messages WHERE id = ?`).bind(msgId2).first<MessageRow>();
    const row3 = await env.DB.prepare(`SELECT status FROM messages WHERE id = ?`).bind(msgId3).first<MessageRow>();

    expect(row1?.status).toBe("delivered");
    expect(row2?.status).toBe("delivered");
    expect(row3?.status).toBe("pending");
  }, 15000);

  it("handles batch read ACK and activates burn window for on_read messages", async () => {
    // Alice sends 1 permanent and 1 on_read message
    const sendMsg = async (content: string, retention: string) => {
      const res = await app.fetch(
        new Request(`http://localhost/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ content, retention, burn_after_seconds: 30 }),
        }),
        env
      );
      const json = (await res.json()) as any;
      return json.message.id as string;
    };

    const permMsgId = await sendMsg("Permanent message", "permanent");
    const onReadMsgId = await sendMsg("Ephemeral message", "on_read");

    // Bob batch reads both
    const batchReadRes = await app.fetch(
      new Request("http://localhost/messages/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          message_ids: [permMsgId, onReadMsgId],
        }),
      }),
      env
    );

    expect(batchReadRes.status).toBe(200);
    const batchReadJson = (await batchReadRes.json()) as any;
    expect(batchReadJson.acknowledged).toHaveLength(2);

    // Verify statuses
    const permRow = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(permMsgId).first<MessageRow>();
    const onReadRow = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(onReadMsgId).first<MessageRow>();

    expect(permRow?.status).toBe("read");
    expect(permRow?.expires_at).toBe(0);

    expect(onReadRow?.status).toBe("read");
    expect(onReadRow?.expires_at).toBeGreaterThan(0);
  }, 15000);

  it("queries message receipts with delivery and read counts", async () => {
    // Alice sends message
    const sendRes = await app.fetch(
      new Request(`http://localhost/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ content: "Receipt test" }),
      }),
      env
    );
    const msgId = ((await sendRes.json()) as any).message.id;

    // Bob delivery ACK
    await app.fetch(
      new Request(`http://localhost/messages/${msgId}/ack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bobToken}` },
      }),
      env
    );

    // Bob read ACK
    await app.fetch(
      new Request(`http://localhost/messages/${msgId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bobToken}` },
      }),
      env
    );

    // Query receipts
    const receiptsRes = await app.fetch(
      new Request(`http://localhost/messages/${msgId}/receipts`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      }),
      env
    );

    expect(receiptsRes.status).toBe(200);
    const receiptsJson = (await receiptsRes.json()) as any;
    expect(receiptsJson.message_id).toBe(msgId);
    expect(receiptsJson.total_delivered).toBe(1);
    expect(receiptsJson.total_read).toBe(1);
    expect(receiptsJson.receipts).toHaveLength(2);
    expect(receiptsJson.receipts[0].user_id).toBe(bob.address.toLowerCase());
  }, 15000);
});
