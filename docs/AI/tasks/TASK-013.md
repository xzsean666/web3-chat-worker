# TASK-013: Full Security & Performance Audit, Optimization and Dual-Project Hardening

## Objective
Perform a comprehensive security and performance audit of both `web3-chat-contract` and `web3-chat-worker` according to `local-joint-test/ARCHITECTURE_FLOW.md`, fix all identified vulnerabilities and performance bottlenecks, optimize database queries, implement isolate-level caching and SDK pooling, and verify end-to-end functionality.

## Scope
- `web3-chat-contract`:
  - Review all smart contracts (`GroupImplementation`, `UserImplementation`, `ChatStorageFactory`, `RelationshipManager`).
  - Fix `_banMemberInternal` timestamp addition against `uint64` arithmetic overflow.
  - Eliminate CommonJS `require("crypto")` in SDK `invite.ts` in favor of cross-platform `globalThis.crypto.getRandomValues`.
- `web3-chat-worker`:
  - Isolate-level shared TTL caching and persistent `ChatSDK` / `RpcPoolManager` in `ContractService`.
  - Elimination of N+1 database queries in `MessageService.getConversationMessages` and `SyncService.sync` via `MessageService.enrichMediaMessages`.
  - Atomic batch deletion in `SweeperService.runSweeper` using Cloudflare D1 `env.DB.batch(...)`.
  - Single `LEFT JOIN` query for media streaming routes (`/voice/:id`, `/images/:id`, `/files/:id`).
  - Strict pagination cursor calculation in `SyncService.sync` preventing message skips when limit is reached.
  - Comprehensive input bounds validation for message content, media files, avatars, and metadata.
  - Atomic nonce single-use check in `AuthService` preventing concurrent replay attacks.
  - D1 SQLite schema composite indexes (`idx_nonces_wallet_nonce`, `idx_messages_content`).

## Verification
- `web3-chat-contract`:
  - `pnpm run build`
  - `pnpm run test:all` (26/26 contract tests, 23/23 SDK tests)
- `web3-chat-worker`:
  - `pnpm typecheck`
  - `pnpm test` (81/81 tests passing)
  - `pnpm test:joint` (9/9 stages on live Anvil node)

## Status
DONE
