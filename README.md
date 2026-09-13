# Web3 Chat Worker Node

> **High-Performance Lightweight State Node for Decentralized Web3 Chat**  
> Built on **Cloudflare Workers**, **EVM Smart Contracts**, **Cloudflare D1 (SQLite)**, and **Cloudflare R2**.

---

## 1. System Overview & Architecture

`web3-chat-worker` functions as a **lightweight state node (轻状态节点)** in the Web3 Chat Protocol ecosystem.

Unlike legacy monolithic chat backends that store all users, groups, memberships, and social graphs in a single database, this architecture decouples **sovereign state** from **message transit**:

- **Sovereign State (EVM Smart Contracts)**:
  User accounts, profile metadata, groups, roles (Owner, Admin, Member), membership lists, friend relationships, and blacklists are anchored on EVM contracts (`@web3-chat/sdk` / `ChatStorageFactory.sol`).
- **Transit & Ephemeral Messaging (Cloudflare D1)**:
  Transient messages, delivery/read receipts, active auth sessions, and cryptographic nonces are stored in D1 SQLite.
- **Media Object Storage (Cloudflare R2)**:
  Voice notes, images, documents, and user avatars are persisted in R2 buckets.
- **RPC Pooling & Configurable TTL Caching**:
  Queries for user group memberships, mute/ban status, and block status are cached in-memory with configurable TTL (`RPC_CACHE_TTL_SECONDS`) to avoid hammering RPC endpoints.

```text
                            +----------------------------------------+
                            |              Web3 Client               |
                            | (EVM Wallet: MetaMask, Rabby, Phantom) |
                            +----------------------------------------+
                                       |                     |
                    HTTP / REST        |                     | Direct Transactions
                    (Messages / Sync)  |                     | (Group/Profile Writes)
                                       v                     v
                         +---------------------------+  +---------------------------+
                         |  Cloudflare Worker Node   |  |   EVM Smart Contracts     |
                         |   (Lightweight State)     |  |   (Sovereign State Layer) |
                         +-------------+-------------+  +---------------------------+
                                       |                              ^
                         RPC Pool with | (Read Groups/Roles/Blocks)   |
                         TTL Caching   +------------------------------+
                                       |
                        +--------------+--------------+
                        |                             |
                        v                             v
            +-----------------------+     +-----------------------+
            |  Cloudflare D1 (DB)   |     | Cloudflare R2 Bucket  |
            | (Messages, Receipts,  |     | (Voice, Images, Files,|
            |  Sessions, Media Meta)|     |  Avatars)             |
            +-----------------------+     +-----------------------+
```

---

## 2. Core Capabilities

1. **EVM EIP-191 Authentication**:
   - Cryptographic challenge-response (SIWE flow) via `/auth/nonce` and `/auth/verify`.
   - Single-use nonce invalidation to strictly prevent replay attacks.
   - 7-day Bearer session tokens with SHA-256 hash storage.
2. **Stateless Group & Profile Resolution**:
   - Direct chats use deterministic, canonical IDs: `dm:minAddress:maxAddress`.
   - On-chain groups resolve dynamically from `ChatStorageFactory.getUserGroups` with in-memory TTL caching.
3. **Explicit Delivery & Read ACK Model**:
   - HTTP 201 on send is strictly an **API receipt** (message queued in node).
   - Receiver client explicitly confirms delivery via `/messages/:id/ack` (or `/messages/ack`).
   - Receiver client confirms viewing via `/messages/:id/read` (or `/messages/read`).
4. **Dual-Storage Synchronized Destruction (30s Burn Window)**:
   - Ephemeral messages (`retention: "on_read"`) trigger a configurable 30-second burn window upon read confirmation.
   - After expiration, the message is omitted from sync and purged from both D1 and R2 by the background sweeper.
5. **30-Second Message Recall**:
   - Sender can recall any message within 30 seconds (`POST /messages/:id/recall`).
   - Content is redacted in D1 and associated media binaries are **immediately deleted from R2**.
6. **Single Active User Avatar**:
   - Users upload avatars to R2 via `POST /users/me/avatar`.
   - Avatars are streamed directly with caching headers via `GET /users/:address/avatar`.
7. **Incremental Timestamp Sync**:
   - `GET /sync?since=<timestamp>&limit=<number>` aggregates updates, receipts, and new messages across all on-chain groups and direct conversations.
8. **Scheduled Dual-Storage Sweeper**:
   - Cloudflare Worker `scheduled` cron job executes `SweeperService` to sweep expired messages, orphan media files in R2, and expired nonces/sessions.

---

## 3. Environment Configuration & Bindings

Configured in `wrangler.jsonc` or Cloudflare Dashboard:

| Variable | Type | Description | Default |
|---|---|---|---|
| `DB` | D1 Database | Cloudflare D1 database binding | Required |
| `VOICE_BUCKET` | R2 Bucket | Cloudflare R2 bucket binding for media & avatars | Required |
| `FACTORY_ADDRESS` | String (Address) | Address of deployed `ChatStorageFactory.sol` | Required |
| `RPC_URLS` | String | Comma-separated RPC endpoints for RPC pooling | Required |
| `CHAIN_ID` | String / Number | Target EVM Chain ID (e.g. `1`, `11155111`, `31337`) | `31337` |
| `RPC_CACHE_TTL_SECONDS` | String / Number | In-memory cache TTL for contract queries | `60` |
| `MESSAGE_RECALL_WINDOW_SECONDS`| String / Number | Maximum allowable window to recall a message | `30` |

---

## 4. API Endpoints Directory

### Authentication (`/auth`)
- `POST /auth/nonce` - Generate EIP-191 sign-in challenge.
- `POST /auth/verify` - Verify wallet signature and obtain Bearer token.
- `GET /auth/me` - Get current authenticated user profile and contract identity.
- `POST /auth/logout` - Invalidate current session token.

### Conversations (`/conversations`)
- `GET /conversations` - List active conversations (on-chain groups + direct chats).
- `POST /conversations/direct` - Obtain deterministic direct conversation ID (`dm:min:max`).
- `GET /conversations/:id` - Get conversation details and verify user permissions.

### Groups (`/groups`)
- `GET /groups/:id` - Query group on-chain overview, marquee, and settings.
- `GET /groups/:id/members` - Query group member addresses with pagination.
- `GET /groups/:id/muted` - Query group mute status and caller mute status.

### Messages & Receipts (`/messages`, `/conversations/:id/messages`)
- `GET /conversations/:id/messages` - Query active messages with pagination.
- `POST /conversations/:id/messages` - Send text (JSON) or media (multipart/form-data) message.
- `POST /messages/:id/ack` - Explicit delivery ACK for a single message.
- `POST /messages/ack` - Batch delivery ACK for multiple messages (`{ message_ids }`).
- `POST /messages/:id/read` - Explicit read ACK for a single message (triggers 30s burn countdown).
- `POST /messages/read` - Batch read ACK for multiple messages (`{ message_ids }`).
- `POST /messages/:id/recall` - Recall message within 30 seconds (purges R2 binary immediately).
- `GET /messages/:id/receipts` - Retrieve all delivery and read receipts for a message.

### Media Storage (`/media`, `/voice`, `/images`, `/files`)
- `GET /media/*` - Retrieve media object by key.
- `POST /voice/upload` & `GET /voice/:id` - Upload and stream voice audio.
- `POST /images/upload` & `GET /images/:id` - Upload and stream image attachments.
- `POST /files/upload` & `GET /files/:id` - Upload and stream file attachments.

### Users & Social (`/users`, `/social`)
- `GET /users/:address` - Query user public profile overview.
- `POST /users/me/avatar` - Upload single user avatar to R2 (multipart or base64).
- `GET /users/:address/avatar` - Stream user avatar directly from R2.
- `GET /users/me/metadata` - Retrieve client metadata from D1.
- `PUT /users/me/metadata` - Update client metadata in D1.
- `GET /social/friends` - Query user's on-chain friends list.
- `GET /social/friends/:address` - Check if target address is an on-chain friend.
- `GET /social/blacklist/:address` - Check if target address is blocked.

### Synchronization (`/sync`)
- `GET /sync?since=<timestamp>&limit=<number>` - Incremental timestamp sync across all groups and direct conversations.

---

## 5. Development & Testing

```bash
# 1. Install dependencies
pnpm install

# 2. Run TypeScript type check
pnpm run typecheck

# 3. Run all test suites
pnpm test

# 4. Dry-run bundle build verification
pnpm run build

# 5. Local development server
pnpm run dev

# 6. Deploy to Cloudflare Workers
pnpm run deploy
```

---

## 6. License
MIT
