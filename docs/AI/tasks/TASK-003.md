# TASK-003: EVM Authentication & User Profile Management

## Objective
Implement EVM EIP-191 challenge-response authentication, session management, auth middleware, and user profile management:
1. `GET /auth/nonce?address=0x...`:
   - Validates Ethereum address format using `viem.isAddress`.
   - Generates cryptographically secure nonce and EIP-191 sign-in challenge message.
   - Persists nonce in D1 `nonces` table with 5-minute expiration.
   - Returns `{ nonce, message, expires_at }`.
2. `POST /auth/verify`:
   - Accepts `{ address, signature, nonce }`.
   - Verifies signature using Viem's `verifyMessage`.
   - Deletes used nonce from D1 to prevent replay attacks.
   - Queries on-chain profile / contract address via `ContractService`.
   - Generates a Bearer token, stores SHA-256 `token_hash` in D1 `sessions` (7-day validity).
   - Returns session token and user info.
3. Auth Middleware (`src/middleware/auth.ts`):
   - Extracts Bearer token from `Authorization` header.
   - Validates session from D1 `sessions` table.
   - Sets `c.set('user', authUser)`, `c.set('session', sessionRow)`, and `c.set('token', token)`.
4. User Profile & Session Routes:
   - `GET /auth/me`: Returns current user identity and on-chain profile metadata.
   - `POST /auth/logout`: Invalidates the current session in D1.
5. Test Suite (`test/auth.test.ts`):
   - End-to-end tests using `createTestWallet()` with actual cryptographic signing and verification.
   - Tests for nonce generation, valid login, invalid signature, replay attack with used nonce, expired session, middleware protection, and `/auth/me` / `/auth/logout`.

## Scope
- `src/services/auth.ts`
- `src/middleware/auth.ts`
- `src/routes/auth.ts`
- `src/index.ts`
- `test/auth.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-003.md`

## Dependencies
- TASK-002 (Completed)

## Acceptance Criteria
1. Full EIP-191 authentication cycle works with real cryptographic keypairs.
2. Nonce replay prevention: each nonce can be used at most once.
3. Auth middleware protects secured endpoints and rejects invalid/expired tokens with 401.
4. `/auth/me` retrieves cached user profile overview from `ContractService`.
5. All tests in `test/auth.test.ts` and previous tests pass cleanly.
6. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
