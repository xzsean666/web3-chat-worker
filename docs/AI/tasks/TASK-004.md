# TASK-004: Lightweight Group & Conversation Access Management

## Objective
Implement conversation resolution, on-chain group discovery, and conversation access management without duplicating group state in D1:
1. Canonical Conversation Identification:
   - Group conversations: `group:${groupId}` (or numeric `groupId`).
   - Direct conversations: `dm:${addr1}:${addr2}` (alphabetically sorted lowercased EVM addresses, deterministic and stateless).
2. Conversation Service (`src/services/conversation.ts`):
   - `parseConversationId(conversationId: string, currentUser?: string)`: Resolves type ('dm' or 'group'), peer address, or groupId.
   - `getConversation(conversationId: string, currentUser: string, contractService: ContractService)`: Resolves aggregated details.
   - `verifyConversationAccess(conversationId: string, currentUser: string, contractService: ContractService)`: Verifies user membership in groups or non-blocked status in direct chats.
3. Conversation Routes (`src/routes/conversations.ts`):
   - `GET /conversations`: Lists user's conversations:
     - On-chain groups discovered dynamically from `contractService.getUserGroups(userAddress)`.
     - Direct conversations where the user has messages in D1.
   - `GET /conversations/:id`: Returns details and permissions for a specific conversation.
   - `POST /conversations/direct`: Takes `{ target_address }`, checks blocking status, and returns the canonical direct conversation ID.
4. Mount conversation router in `src/index.ts`.
5. Comprehensive test suite in `test/conversations.test.ts` verifying group discovery, direct conversation creation, access checks, and block protections.

## Scope
- `src/services/conversation.ts`
- `src/routes/conversations.ts`
- `src/index.ts`
- `test/conversations.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-004.md`

## Dependencies
- TASK-002, TASK-003 (Completed)

## Acceptance Criteria
1. Stateless conversation resolution works for both on-chain groups and direct peer chats.
2. Direct conversation IDs are canonical and deterministic (`dm:minAddr:maxAddr`).
3. Group conversations resolve directly from contract via cached `ContractService`.
4. Unauthorized users cannot access conversations they are not part of.
5. All tests in `test/conversations.test.ts` pass cleanly.
6. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
