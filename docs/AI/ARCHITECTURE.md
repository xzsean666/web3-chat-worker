# System Architecture: Lightweight Web3 Chat Worker Node

## 1. System Topology

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
           | (Messages, Receipts,  |     | (Voice, Images, Files)|
           |  Sessions, Media Meta)|     +-----------------------+
           +-----------------------+
```

## 2. Separation of Responsibilities

| Domain | Source of Truth | Storage Medium | Worker Responsibility |
|---|---|---|---|
| User Identity & Profile | Smart Contract | `UserImplementation` clone | Reads & caches profile; issues auth challenge |
| Groups & Roles | Smart Contract | `GroupImplementation` clone | Verifies membership, role, and mute before sending messages |
| User Groups Index | Smart Contract | `ChatStorageFactory` | Queries `getUserGroups` to route sync & messages |
| Friends & Blacklist | Smart Contract | `RelationshipManager` / User Clone | Verifies 1:1 messaging permissions and block status |
| Messages & Ephemeral States | Worker Node | Cloudflare D1 | Ingestion, retention, delivery status, receipts, recall |
| Media Binaries | Worker Node | Cloudflare R2 | Upload, streaming, synchronized deletion on burn/recall |

## 3. RPC Pooling & Caching Strategy
- Worker receives `RPC_URLS` (or JSON pool config) and `FACTORY_ADDRESS`.
- Worker initializes `@web3-chat/sdk` with `RpcPoolManager` supporting multiple nodes and fallback/latency-ranked routing.
- Worker uses an in-memory/in-isolate TTL cache for contract reads:
  - User groups (`getUserGroups`): cached for `RPC_CACHE_TTL_SECONDS` (default: 60s).
  - Group membership and mute/ban status: cached for `RPC_CACHE_TTL_SECONDS` (default: 60s).
  - Blacklist status: cached for `RPC_CACHE_TTL_SECONDS` (default: 60s).
  - Allows fast message dispatch and sync without hammering RPC nodes.

## 4. Message & Sync Flow
1. **Send Message (`POST /conversations/:id/messages`)**:
   - For direct conversation: checks whether recipient blocked sender on-chain.
   - For group conversation: checks if sender is an active member and not muted on-chain.
   - Saves message to D1, generates receipt stubs.
2. **Incremental Sync (`GET /sync?since=<timestamp>`)**:
   - Reads user's current group IDs from contract (cached).
   - Queries D1 for messages in any of those groups OR direct conversations where user is a participant, with `created_at > since`.
   - Filters out burned ephemeral messages.
