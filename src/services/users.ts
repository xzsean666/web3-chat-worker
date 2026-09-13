// SPDX-License-Identifier: MIT
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { getAddress, isAddress } from "viem";

export interface UserAvatarUploadResult {
  key: string;
  avatar_url: string;
  size: number;
  mime_type: string;
}

export class UserService {
  /**
   * Upload and overwrite user's single avatar in R2.
   */
  public static async uploadAvatar(
    bucket: R2Bucket,
    address: string,
    data: Uint8Array,
    mimeType: string
  ): Promise<UserAvatarUploadResult> {
    const normalized = getAddress(address).toLowerCase();
    const key = `avatars/${normalized}`;

    await bucket.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        userAddress: normalized,
        uploadedAt: Date.now().toString(),
      },
    });

    return {
      key,
      avatar_url: `/users/${normalized}/avatar`,
      size: data.byteLength,
      mime_type: mimeType,
    };
  }

  /**
   * Retrieve user's avatar from R2.
   */
  public static async getAvatar(
    bucket: R2Bucket,
    address: string
  ): Promise<{ object: any; mimeType: string } | null> {
    if (!isAddress(address)) {
      return null;
    }
    const normalized = getAddress(address).toLowerCase();
    const key = `avatars/${normalized}`;

    const object = await bucket.get(key);
    if (!object) {
      return null;
    }

    const mimeType =
      (object.httpMetadata as any)?.contentType || "image/png";

    return { object, mimeType };
  }

  /**
   * Ensure user_metadata table exists in D1.
   */
  public static async ensureMetadataTable(db: D1Database): Promise<void> {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS user_metadata (
          user_id TEXT PRIMARY KEY,
          metadata TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL
        )`
      )
      .run();
  }

  /**
   * Get user metadata from D1.
   */
  public static async getUserMetadata(
    db: D1Database,
    userId: string
  ): Promise<Record<string, any>> {
    await this.ensureMetadataTable(db);
    const row = await db
      .prepare(`SELECT metadata FROM user_metadata WHERE user_id = ? LIMIT 1`)
      .bind(userId.toLowerCase())
      .first<{ metadata: string }>();

    if (!row || !row.metadata) {
      return {};
    }

    try {
      return JSON.parse(row.metadata);
    } catch {
      return {};
    }
  }

  /**
   * Set or update user metadata in D1.
   */
  public static async setUserMetadata(
    db: D1Database,
    userId: string,
    metadata: Record<string, any>
  ): Promise<Record<string, any>> {
    await this.ensureMetadataTable(db);
    const now = Math.floor(Date.now() / 1000);
    const serialized = JSON.stringify(metadata || {});
    if (serialized.length > 16384) {
      throw new Error("Metadata exceeds maximum allowed size (16KB)");
    }

    await db
      .prepare(
        `INSERT INTO user_metadata (user_id, metadata, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`
      )
      .bind(userId.toLowerCase(), serialized, now)
      .run();

    return metadata;
  }
}
