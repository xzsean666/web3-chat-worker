import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { createMockD1Database } from './helpers/db';
import { createMockR2Bucket } from './helpers/r2';
import { createTestWallet } from './helpers/wallet';
import type { Env } from '../src/types';

describe('EVM Authentication & Session Management (/auth)', () => {
  let env: Env;
  const wallet = createTestWallet();
  const otherWallet = createTestWallet();

  beforeEach(() => {
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: '0x1111111111111111111111111111111111111111',
      RPC_URLS: 'http://127.0.0.1:8545',
      RPC_CACHE_TTL_SECONDS: '60',
    };
  });

  describe('GET /auth/nonce', () => {
    it('generates an EIP-191 sign-in nonce for a valid address', async () => {
      const res = await app.request(`/auth/nonce?address=${wallet.address}`, {}, env);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.nonce).toBeDefined();
      expect(typeof data.nonce).toBe('string');
      expect(data.message).toContain(wallet.address);
      expect(data.message).toContain(data.nonce);
      expect(data.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('rejects missing or invalid address', async () => {
      const resNoAddr = await app.request('/auth/nonce', {}, env);
      expect(resNoAddr.status).toBe(400);

      const resInvalid = await app.request('/auth/nonce?address=not-an-address', {}, env);
      expect(resInvalid.status).toBe(400);
    });
  });

  describe('POST /auth/verify', () => {
    it('authenticates a valid signature and returns session Bearer token', async () => {
      // 1. Get nonce
      const nonceRes = await app.request(`/auth/nonce?address=${wallet.address}`, {}, env);
      const { nonce, message } = (await nonceRes.json()) as any;

      // 2. Sign message using test wallet
      const signature = await wallet.signMessage(message);

      // 3. Verify
      const verifyRes = await app.request(
        '/auth/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: wallet.address,
            signature,
            nonce,
          }),
        },
        env
      );

      expect(verifyRes.status).toBe(200);
      const data = (await verifyRes.json()) as any;
      expect(data.token).toBeDefined();
      expect(data.user.wallet_address).toBe(wallet.address);
      expect(data.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('prevents replay attacks by invalidating the nonce after one use', async () => {
      // 1. Get nonce
      const nonceRes = await app.request(`/auth/nonce?address=${wallet.address}`, {}, env);
      const { nonce, message } = (await nonceRes.json()) as any;
      const signature = await wallet.signMessage(message);

      // 2. First verify (succeeds)
      const res1 = await app.request(
        '/auth/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: wallet.address, signature, nonce }),
        },
        env
      );
      expect(res1.status).toBe(200);

      // 3. Second verify with same nonce (fails)
      const res2 = await app.request(
        '/auth/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: wallet.address, signature, nonce }),
        },
        env
      );
      expect(res2.status).toBe(401);
      const err = (await res2.json()) as any;
      expect(err.error).toContain('Invalid or expired nonce');
    });

    it('rejects signature from a different address', async () => {
      const nonceRes = await app.request(`/auth/nonce?address=${wallet.address}`, {}, env);
      const { nonce, message } = (await nonceRes.json()) as any;

      // Signed by otherWallet, but claiming to be wallet.address
      const signature = await otherWallet.signMessage(message);

      const res = await app.request(
        '/auth/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: wallet.address,
            signature,
            nonce,
          }),
        },
        env
      );

      expect(res.status).toBe(401);
      const err = (await res.json()) as any;
      expect(err.error).toContain('Invalid signature');
    });
  });

  describe('Protected Routes & Session Management', () => {
    async function login(): Promise<string> {
      const nonceRes = await app.request(`/auth/nonce?address=${wallet.address}`, {}, env);
      const { nonce, message } = (await nonceRes.json()) as any;
      const signature = await wallet.signMessage(message);

      const verifyRes = await app.request(
        '/auth/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: wallet.address, signature, nonce }),
        },
        env
      );
      const { token } = (await verifyRes.json()) as any;
      return token;
    }

    it('rejects unauthorized requests to GET /auth/me', async () => {
      const resNoHeader = await app.request('/auth/me', {}, env);
      expect(resNoHeader.status).toBe(401);

      const resBadToken = await app.request(
        '/auth/me',
        { headers: { Authorization: 'Bearer bogus-token-123' } },
        env
      );
      expect(resBadToken.status).toBe(401);
    });

    it('returns authenticated user details on GET /auth/me', async () => {
      const token = await login();

      const res = await app.request(
        '/auth/me',
        { headers: { Authorization: `Bearer ${token}` } },
        env
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.user.wallet_address).toBe(wallet.address);
    });

    it('destroys session on POST /auth/logout', async () => {
      const token = await login();

      // Logout
      const logoutRes = await app.request(
        '/auth/logout',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
        env
      );
      expect(logoutRes.status).toBe(200);

      // Try accessing /auth/me again
      const meRes = await app.request(
        '/auth/me',
        { headers: { Authorization: `Bearer ${token}` } },
        env
      );
      expect(meRes.status).toBe(401);
    });
  });
});
