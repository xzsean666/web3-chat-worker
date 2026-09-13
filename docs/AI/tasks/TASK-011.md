# TASK-011: Production Hardening, README, Frontend Integration Guide & Build Verification

## Objective
Finalize production readiness, documentation, scripts, and execute full verification across all 10 test suites:
1. `package.json` Scripts & Production Hardening:
   - Add `"build": "wrangler deploy --dry-run"` so `pnpm run build` succeeds and validates bundle output.
   - Verify `pnpm run typecheck` passes with zero errors.
2. Comprehensive `README.md`:
   - Architecture & system topology diagram (Web3 Client <-> Lightweight Cloudflare Worker Node <-> EVM Smart Contracts / D1 / R2).
   - Core capabilities: EVM EIP-191 authentication, smart contract state indexing & caching, D1 message transit, R2 media storage, explicit delivery/read ACK, 30s message recall & burn-on-read destruction, incremental timestamp sync, and scheduled sweeper.
   - Environment variables & bindings configuration.
   - API endpoint reference table.
   - Local development & testing instructions.
3. Updated Frontend Integration Guide (`docs/FRONTEND_INTEGRATION.md`):
   - Comprehensive frontend developer reference updated for the new lightweight state node architecture:
     - Auth: `/auth/nonce`, `/auth/verify`, `/auth/me`, `/auth/logout`
     - Conversations: `/conversations`, `/conversations/direct`, `/conversations/:id`
     - Groups: `/groups/:id`, `/groups/:id/members`, `/groups/:id/muted`
     - Messaging: `/conversations/:id/messages` (text & media), `/messages/:id/ack`, `/messages/:id/read`, `/messages/:id/recall`, `/messages/ack`, `/messages/read`, `/messages/:id/receipts`
     - Media: `/media/:key`, `/voice/upload`, `/images/upload`, `/files/upload`, `/voice/:id`, `/images/:id`, `/files/:id`
     - Users & Social: `/users/:address`, `/users/me/avatar`, `/users/:address/avatar`, `/users/me/metadata`, `/social/friends`, `/social/blacklist`
     - Sync: `GET /sync?since=<timestamp>&limit=<number>`
     - Complete TypeScript client code examples.
4. Full Project Verification:
   - Run `pnpm run typecheck`.
   - Run `pnpm test` across all suites (must achieve 100% pass rate).
   - Run `pnpm run build`.
   - Update `docs/AI/SESSION_STATE.md` and `docs/AI/TASK_INDEX.md`.

## Scope
- `package.json`
- `README.md`
- `docs/FRONTEND_INTEGRATION.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-011.md`

## Allowed Files
- `package.json`
- `README.md`
- `docs/FRONTEND_INTEGRATION.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-011.md`

## Dependencies
- TASK-010 (Completed)

## Inputs and Outputs
- **Inputs**: Complete codebase implementation and test results.
- **Outputs**: Comprehensive documentation, passing build and test suites.

## Acceptance Criteria
1. `pnpm run build` succeeds without error.
2. `pnpm run typecheck` passes with zero errors.
3. `pnpm test` passes all tests across all test suites.
4. `README.md` and `docs/FRONTEND_INTEGRATION.md` are comprehensive, accurate, and up-to-date.
5. All tasks in `TASK_INDEX.md` are marked DONE.

## Verification Commands
- `pnpm run build`
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
