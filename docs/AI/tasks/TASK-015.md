# TASK-015: Media Transit Zero-Retention Protocol & Sovereign On-Chain Avatar Priority

## Objective
Implement zero-retention transit relay semantics for Cloudflare R2 media binaries and enforce sovereign on-chain avatar priority to ensure zero state lock-in when switching Worker nodes.

## Scope
- **Sovereign On-Chain Avatar Priority**:
  - Update `GET /users/:address` in `src/routes/users.ts` to inspect smart contract `overview.metadata?.avatar` (e.g. IPFS / Arweave / HTTPS).
  - Prioritize the on-chain avatar URL directly when present, falling back to local Worker R2 (`/users/:address/avatar`) only when no on-chain avatar is specified.
  - Ensures 100% data portability across Worker nodes: changing Worker node causes zero avatar loss.
- **In-Transit Media Relay Auto-Purge & Zero Cloud Retention**:
  - Add `MEDIA_TRANSIT_GRACE_SECONDS` (default 30 seconds) to `Env` and config.
  - Enhance `SweeperService.runSweeper` in `src/services/sweeper.ts` to actively scan and purge delivered/read media binaries (`type IN ('voice', 'image', 'file')`) from R2 after the grace window (`read_at <= now - graceSeconds`).
  - Purge unread in-transit media binaries exceeding fallback TTL (`created_at <= now - 7 days`) from R2 to eliminate cloud storage accumulation.
  - Update `src/routes/media.ts` to return `HTTP 410 Gone` with clear rationale (`"Voice/Image/File binary was purged from transit relay"`) when media objects have been purged.
  - Update `messages` table setting `content = NULL` and clean up `voice_messages`, `image_messages`, `file_messages` metadata in an atomic batch.
- **Verification & Documentation**:
  - Unit tests in `test/groups_media.test.ts` for on-chain avatar priority and media transit purge.
  - Architecture documentation in `local-joint-test/ARCHITECTURE_FLOW.md`.
  - Frontend integration guidelines in `docs/FRONTEND_INTEGRATION.md`.

## Verification
- `pnpm test` (86/86 tests passing across all 11 test suites)
- `pnpm test:joint` (9/9 stages on live Anvil node)
- `pnpm --dir /ssd0/git/web3-chat-contract run test:all` (49/49 contract & SDK tests passing)
- `pnpm typecheck` (0 errors)
- `pnpm run build` (`wrangler deploy --dry-run` passing)

## Status
DONE
