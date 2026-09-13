# TASK-006: Incremental Timestamp Sync Engine & Sweeper

## Objective
Implement incremental sync across on-chain groups and direct chats (`GET /sync?since=<timestamp>`) and scheduled cleanup sweeper for dual-storage media & burned messages:
1. Incremental Sync Engine (`src/services/sync.ts`):
   - Discovers user's on-chain groups via cached `ContractService.getUserGroups(userAddress)`.
   - Identifies user's active direct conversations in D1.
   - Queries messages and updates (`created_at > since`, `recalled_at > since`, `delivered_at > since`, `read_at > since`).
   - Filters out expired/burned messages (`expires_at > 0 AND expires_at <= now`).
   - Fetches recent receipts from `message_receipts`.
   - Redacts content for recalled messages (`content: null`).
   - Returns `{ messages, receipts, sync_timestamp, groups }`.
2. Sweeper Service (`src/services/sweeper.ts`):
   - Identifies expired messages (`expires_at > 0 AND expires_at <= now`).
   - Dual-storage synchronized destruction: purges media binaries from R2 (`VOICE_BUCKET.delete`), removes metadata rows from `voice_messages`, `image_messages`, `file_messages`, and deletes `messages` and `message_receipts`.
   - Purges expired nonces and expired sessions.
   - Connects sweeper to `scheduled` handler in `src/index.ts`.
3. Route (`src/routes/sync.ts`):
   - `GET /sync`: Protected by `authMiddleware`, accepts `?since=<timestamp>&limit=<number>`.
4. Tests (`test/sync.test.ts`):
   - Incremental sync across on-chain groups and direct chats.
   - Skipping messages already older than `since`.
   - Syncing message receipts and status changes.
   - Sweeper purging burned messages and R2 binaries.
   - Sweeper purging expired nonces and sessions.

## Scope
- `src/services/sync.ts`
- `src/services/sweeper.ts`
- `src/routes/sync.ts`
- `src/index.ts`
- `test/sync.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-006.md`

## Dependencies
- TASK-005 (Completed)

## Acceptance Criteria
1. Incremental sync aggregates updates across on-chain groups and direct conversations.
2. Burned messages are excluded from sync responses.
3. Sweeper cleanly purges expired media from R2 and expired rows from D1.
4. All tests in `test/sync.test.ts` pass cleanly.
5. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
