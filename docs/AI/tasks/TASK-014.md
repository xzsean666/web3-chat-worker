# TASK-014: Group Chat on_read Dual-Lifecycle & Fallback Expiration Protocol Refinement

## Objective
Refine the "burn-on-read" (`on_read`) ephemeral message protocol for group chat vs 1-on-1 direct messaging, defining explicit client-side vs server-side responsibilities, and adding safe fallback expiration for unread/stale ephemeral messages.

## Scope
- **Protocol Differentiation**:
  - **1v1 Direct Messaging**: Receiver's explicit read marks the message read and activates the 30-second burn countdown window (`expires_at = read_at + 30`). Sender reading their own message does not trigger premature burn.
  - **Multi-Party Group Conversations**:
    - **Frontend / Client responsibility**: Each user client immediately hides and deletes the message from local storage upon reading ("单人读后本地即焚").
    - **Server / Worker responsibility**: Worker records read receipt in D1, checks on-chain `memberCount` via `ContractService.getGroupOverview`, and only activates the global 30-second burn countdown window when all non-sender members (`memberCount - 1`) have read.
  - **Safe Ephemeral Fallback Expiration (`EPHEMERAL_FALLBACK_TTL_SECONDS`, default 7 days)**: If some group members are permanently offline or inactive, ephemeral messages are automatically purged by Sweeper once the fallback TTL elapses, preventing permanent storage leaks.
  - **Query-time Filtering**: `MessageService.getConversationMessages`, `SyncService.sync`, and `/media/*` routes immediately omit/return 410 for fallback-expired ephemeral messages even prior to sweeper batch deletion.

## Verification
- `pnpm test` (84/84 tests passing)
- `pnpm test:joint` (9/9 stages on live Anvil node)
- `pnpm typecheck` (0 errors)

## Status
DONE
