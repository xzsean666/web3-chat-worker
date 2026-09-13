# Session State (SESSION_STATE.md)

## Current Goal
Complete logical refinement, security/performance audits, group on_read dual-lifecycle protocol, and documentation updates across `web3-chat-contract` and `web3-chat-worker`.

## Current Task
TASK-014: Group Chat on_read Dual-Lifecycle & Fallback Expiration Protocol Refinement

## Current Status
DONE

## Completed Content
- **Group Chat on_read Dual-Lifecycle & Fallback Expiration Protocol**:
  - Differentiated 1-on-1 Direct Messaging vs Multi-Party Group Conversations:
    - **1v1 DM**: Receiver's explicit read marks the message read and activates the 30-second burn countdown window. Sender reading their own sent message acknowledges delivery/read but does not trigger premature burn.
    - **Group Chat**: Client/Frontend responsibility: each user client immediately hides and locally wipes the message upon reading ("前端删除自己读的"). Server/Worker responsibility: records read receipt, queries on-chain group `memberCount` via `ContractService.getGroupOverview`, and only activates the global 30-second burn countdown window after ALL non-sender members (`memberCount - 1`) have read.
    - **Ephemeral Fallback Expiration (`EPHEMERAL_FALLBACK_TTL_SECONDS`, default 7 days)**: If an inactive member never opens the app/group, Sweeper automatically purges unread or incompletely-read ephemeral messages once the fallback TTL elapses, preventing permanent storage leaks.
    - **Query Filtering**: `getConversationMessages`, `SyncService.sync`, and `/media/*` routes immediately omit/return 410 for fallback-expired ephemeral messages even prior to sweeper batch deletion.
- **Added Comprehensive Test Coverage**:
  - Added unit test in `test/messages.test.ts` ensuring sender read does not trigger burn countdown in DM.
  - Added unit test in `test/messages.test.ts` verifying group `on_read` message stays at `expires_at = 0` when first member reads, and only triggers `expires_at = read_at + 30` once all members read.
  - Added unit test in `test/messages.test.ts` verifying unread group `on_read` messages are swept once fallback TTL expires.
- **Updated Documentation**:
  - Updated `local-joint-test/ARCHITECTURE_FLOW.md` with sequence diagram (Section 2.5) and security hardening specifications (Section 3.2 item 9).
  - Updated `docs/FRONTEND_INTEGRATION.md` with explicit client vs server on_read dual-track lifecycle responsibilities.

## Modified / Created Files
- `src/types.ts`
- `src/services/message.ts`
- `src/services/sweeper.ts`
- `src/services/sync.ts`
- `src/routes/media.ts`
- `src/routes/messages.ts`
- `test/messages.test.ts`
- `local-joint-test/ARCHITECTURE_FLOW.md`
- `docs/FRONTEND_INTEGRATION.md`
- `docs/AI/SESSION_STATE.md`

## Executed Verification Commands & Results
- In `/ssd0/git/web3-chat-contract`:
  - `pnpm run test:all`: Passed (26/26 contract tests, 23/23 SDK tests).
- In `/ssd0/git/web3-chat-worker`:
  - `pnpm test`: Passed (84/84 tests across all 11 test suites).
  - `pnpm test:joint`: Passed (9/9 stages on live Anvil node).
  - `pnpm typecheck`: Passed (`tsc --noEmit` with 0 errors).
  - `pnpm run build`: Passed (`wrangler deploy --dry-run`).

## Known Issues & Blockers
- None. Both projects are 100% passing and verified in local live EVM joint integration testing.

## Risks and Assumptions
- Anvil is installed locally at `/root/.local/bin/anvil` and used for local joint integration tests.

## Next Task
All tasks including TASK-012 joint integration are complete.

## Files to Read First Next Session
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-012.md`
- `local-joint-test/README.md`
- `local-joint-test/ARCHITECTURE_FLOW.md`
- `local-joint-test/joint.test.ts`
- `local-joint-test/deployProtocol.ts`
