# TASK-007: End-to-End Integration & Verification

## Objective
Build a complete End-to-End integration test suite (`test/e2e.test.ts`) validating the full architecture and lifecycle of the lightweight `web3-chat-worker` state node:
1. Multi-User Authentication Lifecycle:
   - Alice and Bob generate EIP-191 nonces, sign them cryptographically, and obtain Bearer tokens via `/auth/verify`.
   - Both users query `/auth/me` to retrieve identity and smart contract clone profiles.
2. Lightweight Stateless Conversation Resolution:
   - Direct 1:1 conversation created via `/conversations/direct` generating deterministic `dm:min:max` ID.
   - On-chain group conversation discovery through `ChatStorageFactory.getUserGroups` with TTL cache.
3. Message Transit & Explicit ACK Model:
   - Alice sends text message to Bob; initial status is `pending`.
   - Bob polls / syncs and sends delivery ACK (`POST /messages/:id/ack`).
   - Bob reads the message and sends read ACK (`POST /messages/:id/read`).
4. Dual-Storage Media & 30s Recall Protocol:
   - Alice uploads voice/image media via `/conversations/:id/messages` (stored in R2, metadata in D1).
   - Media is accessible via `/media/:key`.
   - Alice recalls the media message within 30s: R2 binary is purged immediately, message content is cleared, and `/media/:key` returns 410.
5. Burn-on-Read Ephemeral Lifecycle:
   - Alice sends `on_read` message with `burn_after_seconds = 30`.
   - Bob reads the message, activating the 30s burn countdown (`expires_at = now + 30`).
   - After expiration, the message is omitted from sync and purged by `SweeperService`.
6. On-Chain Permission & Blacklist Enforcement:
   - Bob blocks Alice on-chain.
   - Worker checks on-chain block status (cached) and prevents Alice from posting messages to Bob.
7. Incremental Timestamp Sync (`GET /sync?since=<timestamp>`):
   - Bob synchronizes all incoming messages and receipts across direct chats and on-chain groups.
8. Verification & Project Audit:
   - Execute full test suite (`pnpm test`).
   - Execute TypeScript check (`pnpm run typecheck`).
   - Update documentation and session state.

## Scope
- `test/e2e.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-007.md`

## Dependencies
- TASK-001 through TASK-006 (Completed)

## Acceptance Criteria
1. E2E test suite executes the complete user journey and verifies all architectural requirements.
2. All unit and integration test suites pass (100% pass rate).
3. `pnpm run typecheck` passes with zero errors.
4. All tasks in `TASK_INDEX.md` are marked DONE.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
