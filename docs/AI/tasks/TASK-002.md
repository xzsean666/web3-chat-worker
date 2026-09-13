# TASK-002: On-Chain Contract Service & Cached RPC Client Layer

## Objective
Implement the contract integration and caching service layer (`src/services/contract.ts`) for the lightweight worker node:
1. Initialize `@web3-chat/sdk` `ChatSDK` with `RpcPoolManager` handling RPC endpoints configured in `Env.RPC_URLS` (comma-separated or single URL) and `Env.FACTORY_ADDRESS`.
2. Implement an in-memory TTL caching layer to prevent excessive RPC calls as requested ("不要频繁的去请求rpc，这里做个参数"):
   - `getUserGroups(userAddress: string)`: List of group IDs belonging to the user.
   - `getGroupMemberStatus(groupId: bigint, userAddress: string)`: Returns `{ isMember: boolean; role: Role; isMuted: boolean; isBanned: boolean }`.
   - `isBlocked(userAddress: string, targetAddress: string)`: Checks whether `targetAddress` is blocked by `userAddress` in smart contract.
   - `getGroupOverview(groupId: bigint)`: Returns aggregated group metadata and settings.
   - `getUserOverview(userAddress: string)`: Returns aggregated user profile metadata.
3. Support configurable cache TTL via `Env.RPC_CACHE_TTL_SECONDS` (defaults to 60s).
4. Provide helper to check whether a user can post a message to a direct conversation or an on-chain group.
5. Create comprehensive tests in `test/contract.test.ts` verifying RPC client initialization, cache hits, cache expiration, and permission checks.

## Scope
- `src/services/contract.ts`
- `test/contract.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-002.md`

## Allowed Files
- `src/services/contract.ts`
- `test/contract.test.ts`
- `test/helpers/*`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-002.md`

## Dependencies
- TASK-001 (Completed)

## Inputs and Outputs
- **Inputs**: `Env` containing `FACTORY_ADDRESS`, `RPC_URLS`, `RPC_CACHE_TTL_SECONDS`.
- **Outputs**: High-performance, TTL-cached `ContractService` instance used across routes and services.

## Acceptance Criteria
1. `ContractService` correctly creates `ChatSDK` with RPC pool configurations.
2. Repeated calls to `getUserGroups`, `getGroupMemberStatus`, `isBlocked`, etc. within TTL return cached values without making duplicate RPC calls.
3. All unit tests in `test/contract.test.ts` pass cleanly.
4. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Risks and Assumptions
- Mocking or creating local anvil/hardhat RPC or mocking PublicClient reads for tests.

## Status
DONE
