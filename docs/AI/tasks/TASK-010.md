# TASK-010: Message Receipts Query API & Batch Delivery/Read ACK

## Objective
Implement receipts query API and batch ACK endpoints for high-throughput clients:
1. Message Receipts Query (`GET /messages/:id/receipts`):
   - Returns all delivery and read receipts for a given message:
     - `message_id`, `receipts: Array<{ user_id, status, timestamp }>`, `total_delivered`, `total_read`.
   - Access control: sender or member of the conversation.
2. Batch Delivery ACK (`POST /messages/ack`):
   - Accepts `{ message_ids: string[] }`.
   - Receiver marks multiple incoming messages as `delivered`.
   - Updates `messages` status to `delivered` (if currently `pending`), sets `delivered_at`.
   - Inserts records into `message_receipts`.
   - Returns `{ acknowledged: string[], skipped: string[] }`.
3. Batch Read ACK (`POST /messages/read`):
   - Accepts `{ message_ids: string[] }`.
   - Receiver marks multiple incoming messages as `read`.
   - Triggers 30s burn countdown window for any `on_read` messages.
   - Inserts records into `message_receipts`.
   - Returns `{ acknowledged: string[], skipped: string[] }`.
4. MessageService Extensions:
   - Add `getMessageReceipts(env, messageId)`
   - Add `batchAcknowledgeDelivery(env, messageIds, userAddress)`
   - Add `batchMarkAsRead(env, messageIds, userAddress)`
5. Test Suite (`test/batch_receipts.test.ts`):
   - Receipts query for single and multiple readers.
   - Batch delivery ACK updating multiple messages.
   - Batch read ACK updating status and triggering 30s countdown for `on_read` messages.

## Scope
- `src/services/message.ts`
- `src/routes/messages.ts`
- `test/batch_receipts.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-010.md`

## Allowed Files
- `src/services/message.ts`
- `src/routes/messages.ts`
- `test/batch_receipts.test.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-010.md`

## Dependencies
- TASK-009 (Completed)

## Inputs and Outputs
- **Inputs**: `message_ids: string[]`, `messageId`.
- **Outputs**: Receipts lists, batch acknowledgement summaries.

## Acceptance Criteria
1. `GET /messages/:id/receipts` returns list of delivery and read receipts.
2. `POST /messages/ack` updates multiple pending messages to delivered.
3. `POST /messages/read` updates multiple messages to read and activates burn countdown on `on_read` messages.
4. All tests in `test/batch_receipts.test.ts` pass cleanly.
5. `pnpm run typecheck` passes with zero errors.

## Verification Commands
- `pnpm run typecheck`
- `pnpm test`

## Status
DONE
