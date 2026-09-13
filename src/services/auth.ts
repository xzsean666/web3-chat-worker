// SPDX-License-Identifier: MIT
import { isAddress, getAddress, verifyMessage } from "viem";
import type { AuthUser, NonceRow, SessionRow } from "../types";
import type { ContractService } from "./contract";

export const NONCE_EXPIRY_SECONDS = 300; // 5 minutes
export const SESSION_EXPIRY_SECONDS = 7 * 24 * 3600; // 7 days

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildAuthMessage(address: string, nonce: string): string {
  return (
    `Sign in to Web3 Chat Worker Node\n\n` +
    `Wallet: ${address}\n` +
    `Nonce: ${nonce}\n` +
    `Statement: I authorize access to my Web3 Chat sovereign session.`
  );
}

export interface NonceResponse {
  nonce: string;
  message: string;
  expires_at: number;
}

export interface VerifyAuthResponse {
  token: string;
  expires_at: number;
  user: AuthUser;
}

export class AuthService {
  /**
   * Generates an EIP-191 sign-in nonce and persists it to D1.
   */
  public static async createNonce(
    db: D1Database,
    walletAddress: string
  ): Promise<NonceResponse> {
    if (!walletAddress || !isAddress(walletAddress)) {
      throw new Error("Invalid Ethereum address");
    }

    const normalized = getAddress(walletAddress).toLowerCase();
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + NONCE_EXPIRY_SECONDS;
    const message = buildAuthMessage(normalized, nonce);

    await db
      .prepare(
        `INSERT INTO nonces (id, wallet_address, nonce, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), normalized, nonce, expiresAt, now)
      .run();

    return {
      nonce,
      message,
      expires_at: expiresAt,
    };
  }

  /**
   * Verifies the EIP-191 signature, invalidates the nonce, and creates a 7-day session.
   */
  public static async verifySignature(
    db: D1Database,
    contractService: ContractService,
    walletAddress: string,
    signature: `0x${string}`,
    nonce: string
  ): Promise<VerifyAuthResponse> {
    if (!walletAddress || !isAddress(walletAddress)) {
      throw new Error("Invalid Ethereum address");
    }
    const normalized = getAddress(walletAddress).toLowerCase();
    const now = Math.floor(Date.now() / 1000);

    // 1. Retrieve and validate nonce
    const nonceRecord = await db
      .prepare(
        `SELECT * FROM nonces
         WHERE wallet_address = ? AND nonce = ? AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .bind(normalized, nonce, now)
      .first<NonceRow>();

    if (!nonceRecord) {
      throw new Error("Invalid or expired nonce");
    }

    // 2. Consume nonce (single-use with race-condition prevention)
    const deleteResult = await db
      .prepare(`DELETE FROM nonces WHERE id = ?`)
      .bind(nonceRecord.id)
      .run();

    if ((deleteResult.meta?.changes ?? 0) === 0) {
      throw new Error("Nonce already used or expired");
    }

    // 3. Verify EIP-191 signature
    const expectedMessage = buildAuthMessage(normalized, nonce);
    const isValid = await verifyMessage({
      address: normalized as `0x${string}`,
      message: expectedMessage,
      signature,
    });

    if (!isValid) {
      throw new Error("Invalid signature");
    }

    // 4. Retrieve contract profile overview if available
    let cloneAddress: string | null = null;
    let metadata: Record<string, any> | undefined = undefined;

    try {
      const overview = await contractService.getUserOverview(normalized);
      cloneAddress = overview.cloneAddress;
      metadata = overview.metadata;
    } catch {
      // User may not have deployed clone yet; fallback gracefully
    }

    // 5. Generate Bearer token and store session
    const rawToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const tokenHash = await hashToken(rawToken);
    const sessionId = crypto.randomUUID();
    const sessionExpiresAt = now + SESSION_EXPIRY_SECONDS;

    await db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(sessionId, normalized, tokenHash, sessionExpiresAt, now)
      .run();

    const authUser: AuthUser = {
      id: normalized,
      wallet_address: normalized,
      contract_address: cloneAddress,
      metadata,
    };

    return {
      token: rawToken,
      expires_at: sessionExpiresAt,
      user: authUser,
    };
  }

  /**
   * Validates a session token from D1.
   */
  public static async validateToken(
    db: D1Database,
    token: string
  ): Promise<SessionRow | null> {
    if (!token) return null;
    const tokenHash = await hashToken(token);
    const now = Math.floor(Date.now() / 1000);

    const session = await db
      .prepare(
        `SELECT * FROM sessions
         WHERE token_hash = ? AND expires_at > ?
         LIMIT 1`
      )
      .bind(tokenHash, now)
      .first<SessionRow>();

    return session || null;
  }

  /**
   * Destroys a session (logout).
   */
  public static async destroySession(
    db: D1Database,
    token: string
  ): Promise<boolean> {
    if (!token) return false;
    const tokenHash = await hashToken(token);
    const result = await db
      .prepare(`DELETE FROM sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();

    return (result.meta?.changes ?? 0) > 0;
  }
}
