# TASK-001: Project Skeleton, Environment & Contract Integration Setup

## Objective
Establish the initial project foundation for `web3-chat-worker`:
1. Initialize `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`.
2. Configure dependencies: `hono`, `viem`, `@web3-chat/sdk` (via link/file or vendoring), `@cloudflare/workers-types`, `typescript`, `vitest`.
3. Configure environment bindings interface in `src/types.ts` including `FACTORY_ADDRESS`, `RPC_URLS`, `CHAIN_ID`, `RPC_CACHE_TTL_SECONDS`, `DB` (D1Database), `VOICE_BUCKET` (R2Bucket).
4. Create minimal database migrations for lightweight worker (messages, message_receipts, nonces, sessions, media metadata). Note: users, groups, group members, friends, blacklist are no longer local master tables, but can optionally have local cache tables or be queried via contract service.
5. Setup test mocks for D1, R2, and test wallets.
6. Verify `pnpm install`, `pnpm run typecheck`, and baseline test pass.

## Scope
- Project configuration files.
- Basic types & environment interfaces.
- Test helpers (mock D1, mock R2, test wallet).
- Initial health check route.

## Allowed Files
- `package.json`
- `tsconfig.json`
- `wrangler.jsonc`
- `vitest.config.ts`
- `src/types.ts`
- `src/index.ts`
- `migrations/0001_lightweight_schema.sql`
- `test/helpers/*`
- `test/health.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-001.md`

## Dependencies
- None.

## Inputs and Outputs
- **Inputs**: Environment configuration parameters (`FACTORY_ADDRESS`, `RPC_URLS`, `RPC_CACHE_TTL_SECONDS`).
- **Outputs**: Compiling Cloudflare Worker project passing typecheck and health tests.

## Acceptance Criteria
1. `pnpm install` completes without error.
2. `pnpm run typecheck` passes with 0 TypeScript errors.
3. `pnpm test` runs and passes all baseline tests (health endpoint, test helpers).

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Risks and Assumptions
- Package resolution for `@web3-chat/sdk` from `file:../web3-chat-contract/sdk`.
- Node 24 native SQLite compatibility for test fixtures.

## Status
DONE
