# Project Rules (AGENTS.md)

## 1. Tooling & Package Manager
- Node.js: Always use `pnpm` (`pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm build`, etc.).
- Git CLI / GitHub: Always use `gh` with account `xzsean666` (under `/ssd0/git`).
- Strict verification: Never claim a test passed without running it.

## 2. Agent Principles
- Strict single-task progression: One Goal and one active Task per session.
- No destructive git operations (`reset`, `checkout`, recursive deletion, etc.).
- Do not commit, push, or publish unless explicitly requested.
- Keep documentation in sync across sessions (`docs/AI/SESSION_STATE.md`, `docs/AI/TASK_INDEX.md`, task files).

## 3. Architecture Constraints
- Cloudflare Worker lightweight state node architecture.
- Sovereign chat state (users, groups, memberships, permissions, social relationships, blacklist) is stored in EVM smart contracts (`web3-chat-contract`).
- Worker integrates with smart contracts using `@web3-chat/sdk` and `viem` with configurable RPC pooling and TTL-based caching to avoid hammering RPC endpoints.
- Messages, receipts, temporary auth sessions, and media metadata are stored in Worker D1 SQLite.
- Voice, image, and file binaries are stored in Cloudflare R2 bucket.
- Explicit ACK model: HTTP 200 is only an API receipt; delivery requires active ACK from receiver client.
- Dual-storage synchronized destruction & 30s burn window for `on_read` messages.
- 30-second message recall with immediate media purge in R2.
- Incremental timestamp-based sync (`GET /sync?since=<timestamp>`) pulling all updates across user's on-chain groups and direct conversations.
