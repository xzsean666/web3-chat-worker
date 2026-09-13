# TASK-005: Messaging Core, Media Storage & 30s Recall/Burn Protocol

## Objective
Implement messaging transit, media storage in R2, explicit client ACK/read lifecycle, 30s recall window, and burn-on-read destruction:
1. Message Dispatch (`POST /conversations/:id/messages`):
   - Supports message types: `text`, `voice`, `image`, `file`.
   - Checks on-chain post permissions via `ConversationService.getConversationDetails`.
   - For `text`: stores content directly in D1 `messages`.
   - For media types (`voice`, `image`, `file`):
     - Stores binary in Cloudflare R2 bucket (`VOICE_BUCKET`).
     - Stores media metadata in respective table (`voice_messages`, `image_messages`, `file_messages`).
     - Sets `messages.content` to reference the object key or summary.
   - Supports `retention: 'permanent' | 'on_read'`.
   - Explicit ACK model: initial status is `pending` (HTTP 200 is only an API receipt).
2. Explicit Delivery & Read Receipts:
   - `POST /messages/:id/ack`:
     - Receiver client explicitly ACKs receipt.
     - Updates message status to `delivered`, sets `delivered_at`.
     - Records receipt in `message_receipts`.
   - `POST /messages/:id/read`:
     - Receiver client marks message as read.
     - Updates message status to `read`, sets `read_at`.
     - If `retention === 'on_read'`: sets `expires_at = now + (burn_after_seconds || 30)` to start the 30s burn countdown.
     - Records receipt in `message_receipts`.
3. 30-Second Message Recall (`POST /messages/:id/recall`):
   - Sender can recall message within `MESSAGE_RECALL_WINDOW_SECONDS` (default: 30s).
   - Only original sender can recall.
   - Marks message as recalled (`recalled_at = now`), clears content.
   - Synchronized media destruction: immediately deletes media object from R2 and removes media table record.
4. Media Retrieval (`GET /media/:key`):
   - Streams media from R2 bucket with correct Content-Type.
   - Checks if parent message is recalled or expired.
5. Message History (`GET /conversations/:id/messages`):
   - Lists messages in a conversation, filtering out burned/expired ephemeral messages.
   - Includes media metadata and delivery/read statuses.
6. Comprehensive test suite in `test/messages.test.ts` verifying text/media sending, explicit ACK, read & 30s burn window start, 30s recall with R2 purge, and recall window timeout.

## Scope
- `src/services/message.ts`
- `src/routes/messages.ts`
- `src/index.ts`
- `test/messages.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-005.md`

## Dependencies
- TASK-004 (Completed)

## Acceptance Criteria
1. Sending text and media messages works with on-chain permission checks.
2. Media binary is uploaded to R2 and metadata stored in D1.
3. Explicit delivery ACK and read ACK update status and trigger 30s burn window for `on_read` messages.
4. 30s message recall permits sender recall within 30s and rejects recall after 30s or by other users.
5. Recalling a media message immediately purges the binary from R2.
6. All tests in `test/messages.test.ts` pass cleanly.
7. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
