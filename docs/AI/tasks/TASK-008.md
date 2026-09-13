# TASK-008: User Avatar Storage (R2), Metadata & Contract Social Query Endpoints

## Objective
Implement user avatar upload & streaming via Cloudflare R2, user metadata handling, profile queries, and smart contract social query endpoints:
1. User Avatar Storage in R2:
   - `POST /users/me/avatar`: Accepts multipart/form-data (`file` or `avatar`) or JSON base64. Saves avatar binary to R2 (`avatars/${userAddress}`). Overwrites existing avatar so each user has a single active avatar.
   - `GET /users/:address/avatar`: Streams user avatar image directly from R2 (`avatars/${normalizedAddress}`) with appropriate `Content-Type`, `Cache-Control`, and `ETag`. Returns 404 if no avatar exists.
2. User Profile & Metadata:
   - `GET /users/:address`: Returns user public profile (combining smart contract `getUserOverview` and avatar presence).
   - `GET /users/me/metadata` & `PUT /users/me/metadata`: Allows authenticated user to store and retrieve personal client settings / metadata (persisted in a lightweight D1 table or contract cache).
3. Contract Social Query Endpoints (`src/routes/social.ts`):
   - `GET /social/friends`: Queries authenticated user's on-chain friends via `ContractService.getUserFriends(userAddress)`.
   - `GET /social/blacklist`: Queries authenticated user's on-chain blacklist via `ContractService.getUserBlacklist(userAddress)`.
4. Tests (`test/users_social.test.ts`):
   - Avatar upload, stream retrieval with headers, overwrite single avatar constraint.
   - User profile query with contract integration.
   - Social friends and blacklist querying.

## Scope
- `migrations/0002_user_metadata.sql` (if needed) or D1 schema update
- `src/services/contract.ts` (add `getUserFriends`, `getUserBlacklist` if not present)
- `src/services/users.ts`
- `src/routes/users.ts`
- `src/routes/social.ts`
- `src/index.ts`
- `test/users_social.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-008.md`

## Allowed Files
- `src/services/contract.ts`
- `src/services/users.ts`
- `src/routes/users.ts`
- `src/routes/social.ts`
- `src/index.ts`
- `migrations/*`
- `test/users_social.test.ts`
- `test/helpers/*`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-008.md`

## Dependencies
- TASK-007 (Completed)

## Inputs and Outputs
- **Inputs**: Multipart avatar uploads, user addresses, smart contract queries.
- **Outputs**: Avatar streaming from R2, user profile responses, on-chain friends & blacklist listings.

## Acceptance Criteria
1. `POST /users/me/avatar` uploads avatar binary to R2 under `avatars/:address`.
2. `GET /users/:address/avatar` streams the image binary from R2 with caching headers.
3. `GET /users/:address` returns public profile information.
4. `GET /social/friends` and `GET /social/blacklist` query on-chain relationships using cached `ContractService`.
5. All tests in `test/users_social.test.ts` pass cleanly.
6. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
