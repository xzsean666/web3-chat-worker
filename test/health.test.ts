import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { createMockD1Database } from './helpers/db';
import { createMockR2Bucket } from './helpers/r2';
import type { Env } from '../src/types';
import { ChatSDK } from '@web3-chat/sdk';

describe('Health Route and Environment Setup', () => {
  it('responds with 200 OK and health info', async () => {
    const db = createMockD1Database();
    const bucket = createMockR2Bucket();
    const env: Env = {
      DB: db,
      VOICE_BUCKET: bucket,
      FACTORY_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      RPC_URLS: 'http://127.0.0.1:8545',
      RPC_CACHE_TTL_SECONDS: '60',
    };

    const res = await app.request('http://localhost/health', {
      method: 'GET',
    }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('web3-chat-worker');
    expect(body.factory).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3');
  });

  it('verifies D1 mock initializes tables correctly', async () => {
    const db = createMockD1Database();
    const result = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages', 'message_receipts', 'nonces', 'sessions', 'voice_messages', 'image_messages', 'file_messages')"
    ).all();

    expect(result.results.length).toBe(7);
  });

  it('verifies @web3-chat/sdk is importable and functional', () => {
    const invite = ChatSDK.generateInviteCode('TEST');
    expect(invite.secret).toBeDefined();
    expect(invite.codeHash).toBeDefined();
    expect(invite.codeHash.startsWith('0x')).toBe(true);

    const recomputedHash = ChatSDK.hashInviteCode(invite.secret);
    expect(recomputedHash).toBe(invite.codeHash);
  });
});
