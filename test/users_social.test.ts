import { describe, it, expect, beforeEach, vi } from "vitest";
import { app } from "../src/index";
import { createMockD1Database } from "./helpers/db";
import { createMockR2Bucket } from "./helpers/r2";
import { createTestWallet } from "./helpers/wallet";
import { hashToken } from "../src/services/auth";
import { ContractService } from "../src/services/contract";
import type { Env } from "../src/types";

describe("User Avatar Storage (R2), Metadata & Contract Social Queries (/users, /social)", () => {
  let env: Env;
  const alice = createTestWallet();
  const bob = createTestWallet();
  let aliceToken: string;
  let bobToken: string;

  beforeEach(async () => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: "0x1111111111111111111111111111111111111111",
      RPC_URLS: "http://127.0.0.1:8545",
      RPC_CACHE_TTL_SECONDS: "60",
    };

    aliceToken = "alice-user-token";
    bobToken = "bob-user-token";
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
  });

  describe("User Avatar Storage (R2) & Streaming", () => {
    it("uploads avatar via multipart/form-data and overwrites existing avatar", async () => {
      const boundary = "----WebKitFormBoundaryTest";
      const fileBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
      const file = new File([fileBytes], "avatar.png", { type: "image/png" });

      const formData = new FormData();
      formData.append("file", file);

      const res = await app.fetch(
        new Request("http://localhost/users/me/avatar", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aliceToken}`,
          },
          body: formData,
        }),
        env
      );

      expect(res.status).toBe(201);
      const json = (await res.json()) as any;
      expect(json.avatar_url).toBe(
        `/users/${alice.address.toLowerCase()}/avatar`
      );
      expect(json.mime_type).toBe("image/png");

      // Verify avatar can be streamed back
      const streamRes = await app.fetch(
        new Request(`http://localhost${json.avatar_url}`),
        env
      );
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toBe("image/png");
      const streamedBytes = new Uint8Array(await streamRes.arrayBuffer());
      expect(streamedBytes.length).toBe(fileBytes.length);
    });

    it("uploads avatar via JSON base64", async () => {
      const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const res = await app.fetch(
        new Request("http://localhost/users/me/avatar", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bobToken}`,
          },
          body: JSON.stringify({
            avatar_base64: base64Data,
            mime_type: "image/png",
          }),
        }),
        env
      );

      expect(res.status).toBe(201);
      const json = (await res.json()) as any;
      expect(json.avatar_url).toBe(`/users/${bob.address.toLowerCase()}/avatar`);

      const streamRes = await app.fetch(
        new Request(`http://localhost${json.avatar_url}`),
        env
      );
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toBe("image/png");
    });

    it("returns 404 when querying an avatar that does not exist", async () => {
      const res = await app.fetch(
        new Request(`http://localhost/users/0x0000000000000000000000000000000000000001/avatar`),
        env
      );
      expect(res.status).toBe(404);
    });
  });

  describe("User Client Metadata (D1)", () => {
    it("saves and retrieves client metadata in D1", async () => {
      // Initially empty
      const getRes1 = await app.fetch(
        new Request("http://localhost/users/me/metadata", {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );
      expect(getRes1.status).toBe(200);
      const getJson1 = (await getRes1.json()) as any;
      expect(getJson1.metadata).toEqual({});

      // Update metadata
      const putRes = await app.fetch(
        new Request("http://localhost/users/me/metadata", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ theme: "dark", notifications: true }),
        }),
        env
      );
      expect(putRes.status).toBe(200);
      const putJson = (await putRes.json()) as any;
      expect(putJson.metadata).toEqual({ theme: "dark", notifications: true });

      // Fetch again
      const getRes2 = await app.fetch(
        new Request("http://localhost/users/me/metadata", {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );
      const getJson2 = (await getRes2.json()) as any;
      expect(getJson2.metadata).toEqual({ theme: "dark", notifications: true });
    });
  });

  describe("User Public Profile & Social Queries", () => {
    it("returns user public profile combining on-chain overview and avatar info", async () => {
      vi.spyOn(ContractService.prototype, "getUserOverview").mockResolvedValueOnce({
        userAddress: alice.address as `0x${string}`,
        cloneAddress: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        status: 1 as any,
        metadataVersion: 2,
        metadata: { nickname: "Alice" },
        stateVersion: 1,
        state: {},
        friendCount: 5n,
        groupCount: 3n,
      });

      const res = await app.fetch(
        new Request(`http://localhost/users/${alice.address}`),
        env
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.user.address.toLowerCase()).toBe(alice.address.toLowerCase());
      expect(json.user.friendCount).toBe("5");
      expect(json.user.metadata.nickname).toBe("Alice");
    });

    it("queries user friends and friend check via ContractService", async () => {
      vi.spyOn(ContractService.prototype, "getUserFriends").mockResolvedValueOnce([
        bob.address,
      ]);
      vi.spyOn(ContractService.prototype, "isFriend").mockResolvedValueOnce(true);

      const friendsRes = await app.fetch(
        new Request("http://localhost/social/friends", {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );
      expect(friendsRes.status).toBe(200);
      const friendsJson = (await friendsRes.json()) as any;
      expect(friendsJson.friends).toContain(bob.address);

      const checkRes = await app.fetch(
        new Request(`http://localhost/social/friends/${bob.address}`, {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );
      expect(checkRes.status).toBe(200);
      const checkJson = (await checkRes.json()) as any;
      expect(checkJson.is_friend).toBe(true);
    });

    it("checks blacklist status via ContractService", async () => {
      vi.spyOn(ContractService.prototype, "isBlocked").mockResolvedValueOnce(true);

      const checkRes = await app.fetch(
        new Request(`http://localhost/social/blacklist/${bob.address}`, {
          headers: { Authorization: `Bearer ${aliceToken}` },
        }),
        env
      );
      expect(checkRes.status).toBe(200);
      const checkJson = (await checkRes.json()) as any;
      expect(checkJson.is_blocked).toBe(true);
    });
  });
});
