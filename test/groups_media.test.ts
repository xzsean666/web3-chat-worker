import { describe, it, expect, beforeEach, vi } from "vitest";
import { app } from "../src/index";
import { createMockD1Database } from "./helpers/db";
import { createMockR2Bucket } from "./helpers/r2";
import { createTestWallet } from "./helpers/wallet";
import { hashToken } from "../src/services/auth";
import { ContractService } from "../src/services/contract";
import { ConversationService } from "../src/services/conversation";
import { Role, MemberStatus } from "@web3-chat/sdk";
import type { Env } from "../src/types";

describe("Group State Query & Dedicated Media API Routes (/groups, /voice, /images, /files)", () => {
  let env: Env;
  const alice = createTestWallet();
  const bob = createTestWallet();
  let aliceToken: string;
  let conversationId: string;

  beforeEach(async () => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: "0x1111111111111111111111111111111111111111",
      RPC_URLS: "http://127.0.0.1:8545",
      RPC_CACHE_TTL_SECONDS: "60",
    };

    aliceToken = "alice-groups-token";
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        "alice-session",
        alice.address.toLowerCase(),
        await hashToken(aliceToken),
        now + 86400,
        now
      )
      .run();

    conversationId = ConversationService.buildDirectConversationId(
      alice.address,
      bob.address
    );
  });

  describe("Group State Queries (/groups)", () => {
    it("returns group overview from contract", async () => {
      vi.spyOn(ContractService.prototype, "getGroupOverview").mockResolvedValueOnce({
        groupId: 10n,
        groupAddress: "0x3333333333333333333333333333333333333333" as `0x${string}`,
        owner: alice.address as `0x${string}`,
        pendingOwner: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        status: 1 as any,
        joinMode: 0 as any,
        memberCount: 5n,
        maxMembers: 100n,
        metadataVersion: 1,
        metadata: {
          name: "Test Group",
          description: "A test group",
          announcement: "Hello world",
          marquee: { enabled: true, text: "Marquee text", speed: 50 },
        },
      });

      const res = await app.fetch(
        new Request("http://localhost/groups/10", {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.group.id).toBe("group:10");
      expect(json.group.name).toBe("Test Group");
      expect(json.group.memberCount).toBe("5");
      expect(json.group.marquee.text).toBe("Marquee text");
    });

    it("returns group members from contract", async () => {
      vi.spyOn(ContractService.prototype, "getGroupMembers").mockResolvedValueOnce([
        alice.address,
        bob.address,
      ]);

      const res = await app.fetch(
        new Request("http://localhost/groups/10/members?offset=0&limit=10", {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.group_id).toBe("group:10");
      expect(json.members).toHaveLength(2);
      expect(json.members).toContain(alice.address);
    });

    it("returns member mute status in group", async () => {
      vi.spyOn(ContractService.prototype, "getGroupMemberStatus").mockResolvedValueOnce({
        isMember: true,
        role: Role.MEMBER,
        status: MemberStatus.MEMBER,
        isMuted: false,
        isBanned: false,
        muteUntil: 0n,
        banUntil: 0n,
      });

      const res = await app.fetch(
        new Request("http://localhost/groups/10/muted", {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.is_member).toBe(true);
      expect(json.is_muted).toBe(false);
    });
  });

  describe("Dedicated Media Endpoints (/voice, /images, /files)", () => {
    it("uploads and streams voice message", async () => {
      const audioBytes = new Uint8Array([79, 103, 103, 83]); // OggS magic bytes
      const file = new File([audioBytes], "voice.ogg", { type: "audio/ogg" });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversation_id", conversationId);
      formData.append("duration", "3.5");

      const uploadRes = await app.fetch(
        new Request("http://localhost/voice/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${aliceToken}` },
          body: formData,
        }),
        env
      );

      expect(uploadRes.status).toBe(201);
      const uploadJson = (await uploadRes.json()) as any;
      const msgId = uploadJson.message.id;
      expect(uploadJson.message.type).toBe("voice");
      expect(uploadJson.message.status).toBe("pending");

      // Stream audio back
      const streamRes = await app.fetch(
        new Request(`http://localhost/voice/${msgId}`),
        env
      );
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toBe("audio/ogg");
      const streamedBytes = new Uint8Array(await streamRes.arrayBuffer());
      expect(streamedBytes.length).toBe(audioBytes.length);
    });

    it("uploads and streams image message", async () => {
      const imgBytes = new Uint8Array([137, 80, 78, 71]);
      const file = new File([imgBytes], "screenshot.png", { type: "image/png" });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversation_id", conversationId);
      formData.append("width", "800");
      formData.append("height", "600");

      const uploadRes = await app.fetch(
        new Request("http://localhost/images/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${aliceToken}` },
          body: formData,
        }),
        env
      );

      expect(uploadRes.status).toBe(201);
      const uploadJson = (await uploadRes.json()) as any;
      const msgId = uploadJson.message.id;
      expect(uploadJson.message.type).toBe("image");

      const streamRes = await app.fetch(
        new Request(`http://localhost/images/${msgId}`),
        env
      );
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toBe("image/png");
    });

    it("uploads and streams file message with Content-Disposition", async () => {
      const docBytes = new TextEncoder().encode("Hello document");
      const file = new File([docBytes], "specs.pdf", { type: "application/pdf" });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversation_id", conversationId);

      const uploadRes = await app.fetch(
        new Request("http://localhost/files/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${aliceToken}` },
          body: formData,
        }),
        env
      );

      expect(uploadRes.status).toBe(201);
      const uploadJson = (await uploadRes.json()) as any;
      const msgId = uploadJson.message.id;
      expect(uploadJson.message.type).toBe("file");

      const streamRes = await app.fetch(
        new Request(`http://localhost/files/${msgId}`),
        env
      );
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toBe("application/pdf");
      expect(streamRes.headers.get("content-disposition")).toContain("specs.pdf");
    });

    it("returns 410 when attempting to stream a recalled media message", async () => {
      const docBytes = new TextEncoder().encode("Secret document");
      const file = new File([docBytes], "secret.txt", { type: "text/plain" });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversation_id", conversationId);

      const uploadRes = await app.fetch(
        new Request("http://localhost/files/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${aliceToken}` },
          body: formData,
        }),
        env
      );
      const uploadJson = (await uploadRes.json()) as any;
      const msgId = uploadJson.message.id;

      // Recall the message
      const recallRes = await app.fetch(
        new Request(`http://localhost/messages/${msgId}/recall`, {
          method: "POST",
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );
      expect(recallRes.status).toBe(200);

      // Attempting to stream now returns 410
      const streamRes = await app.fetch(
        new Request(`http://localhost/files/${msgId}`),
        env
      );
      expect(streamRes.status).toBe(410);
    });
  });
});
