# TASK-012: Local Live EVM Contract & Worker Cross-Project Joint Integration Testing

## Objective
Establish a comprehensive end-to-end local joint integration test harness and test suite between the smart contracts protocol repository (`/ssd0/git/web3-chat-contract`) and the Cloudflare Worker repository (`/ssd0/git/web3-chat-worker`), verifying all live smart contract operations against actual Worker API endpoints running on a live local EVM node (Anvil).

## Scope
- Launch an isolated local EVM blockchain instance (Anvil).
- Compile and deploy core smart contracts (`UserImplementation`, `GroupImplementation`, `ChatStorageFactory`, `RelationshipManager`) using bytecode from `web3-chat-contract`.
- Initialize real `@web3-chat/sdk` instances and connect Worker `ContractService` directly to the live contract factory and Anvil RPC.
- Execute complete multi-stage cross-project joint test suite (`local-joint-test/joint.test.ts`) covering:
  - On-chain user clone creation and profile metadata synchronization with Worker.
  - EIP-191 challenge-response authentication and session token generation.
  - On-chain friendship request, acceptance handshake, and Worker `/social/friends` queries.
  - Direct message transit, explicit delivery & read receipts, and real-time on-chain blacklist enforcement (`blockUser` / `unblockUser`).
  - On-chain group creation, dynamic Worker discovery (`GET /conversations`), member joins, and member queries.
  - On-chain moderation enforcement (group mute and ban) verified against Worker posting authorization.
  - On-chain group lifecycle transitions (pause and resume) verified against Worker posting authorization.
  - Incremental timestamp sync (`GET /sync?since=...`) across live on-chain groups and direct chats.
  - Dual-storage media (voice note upload, streaming, 30s recall with R2 purge, and ephemeral burn-on-read).
  - Single active avatar storage in R2 integrated with unified on-chain user profile overview.
- Support both `POST /conversations/:id/messages` and `POST /messages` with proper HTTP 400 rejection on permission blocks.

## Implementation Details
1. **Dedicated Joint Test Directory (`local-joint-test/`)**:
   - `deployProtocol.ts`: Spawns Anvil background process, deploys implementations and factory from `web3-chat-contract/out`, and configures `setRelationshipManager`.
   - `joint.test.ts`: 9 comprehensive stages testing all facets of contract state interaction with Worker APIs.
   - `run.sh`: Automated one-click execution script.
   - `README.md`: Comprehensive context, actor matrix, stage breakdown, and run instructions.
   - `ARCHITECTURE_FLOW.md`: Detailed Mermaid sequence diagrams for dynamic group discovery, blacklist interception, moderation, and incremental sync.

2. **Production Alignment**:
   - Updated `ContractService.getGroupMemberStatus` to safely fetch dynamic `Role.OWNER` from `getMemberRole`.
   - Added `POST /messages` route and raw image streaming support in `POST /users/me/avatar`.

## Verification
- `web3-chat-contract`:
  - `pnpm run test:all`: 26/26 contract tests passed, 23/23 SDK tests passed.
- `web3-chat-worker`:
  - `./local-joint-test/run.sh`: 9/9 stages passed on live Anvil node.
  - `pnpm vitest run local-joint-test/joint.test.ts`: 9/9 stages passed on live Anvil node.
  - `pnpm test`: 81/81 tests passed across all 11 test suites.
  - `pnpm run typecheck`: 0 TypeScript errors.
  - `pnpm run build`: Production bundle generated successfully (981.48 KiB).
