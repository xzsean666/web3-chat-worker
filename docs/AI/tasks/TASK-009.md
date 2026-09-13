# TASK-009: Group State Query & Dedicated Media API Routes

## Objective
Implement group state querying from smart contracts and dedicated media upload/streaming routes for frontend convenience:
1. Group State & Moderation Query Routes (`src/routes/groups.ts`):
   - `GET /groups/:id`: Retrieves full group overview (id, name, description, marquee, owner, memberCount, status, etc.) from `ContractService.getGroupOverview(groupId)`.
   - `GET /groups/:id/members`: Retrieves group member list (with pagination) from `ContractService.getGroupMembers(groupId, offset, limit)`.
   - `GET /groups/:id/muted`: Retrieves group mute status and query for muted members.
2. Dedicated Media API Routes (`src/routes/media.ts`):
   - In addition to sending media via `POST /conversations/:id/messages`, frontend applications often upload media via dedicated endpoints (`/voice/upload`, `/images/upload`, `/files/upload`) or retrieve media directly (`/voice/:id`, `/images/:id`, `/files/:id`):
     - `POST /voice/upload`: Multipart form-data with `file`, `conversation_id`, `duration`.
     - `GET /voice/:id`: Stream voice audio.
     - `POST /images/upload`: Multipart form-data with `file`, `conversation_id`, `width`, `height`.
     - `GET /images/:id`: Stream image.
     - `POST /files/upload`: Multipart form-data with `file`, `conversation_id`.
     - `GET /files/:id`: Stream file attachment with `content-disposition`.
3. ContractService Extensions:
   - Add `getGroupMembers(groupId: bigint, offset?: bigint, limit?: bigint)` to `ContractService` with caching.
4. Test Suite (`test/groups_media.test.ts`):
   - Group overview, members, and mute queries.
   - Dedicated voice/image/file upload and streaming with content-type assertions.

## Scope
- `src/services/contract.ts`
- `src/routes/groups.ts`
- `src/routes/media.ts`
- `src/index.ts`
- `test/groups_media.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-009.md`

## Allowed Files
- `src/services/contract.ts`
- `src/routes/groups.ts`
- `src/routes/media.ts`
- `src/index.ts`
- `test/groups_media.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-009.md`

## Dependencies
- TASK-008 (Completed)

## Inputs and Outputs
- **Inputs**: Group IDs, form-data file uploads with conversation_id.
- **Outputs**: Group overview/member JSON payloads, media stream responses.

## Acceptance Criteria
1. `GET /groups/:id` returns group overview from contract with caching.
2. `GET /groups/:id/members` returns member list from contract.
3. `POST /voice/upload`, `POST /images/upload`, `POST /files/upload` upload files to R2, record metadata in D1, and create message with pending status.
4. `GET /voice/:id`, `GET /images/:id`, `GET /files/:id` stream the corresponding media files.
5. All tests in `test/groups_media.test.ts` pass cleanly.
6. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
