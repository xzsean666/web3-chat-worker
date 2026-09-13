# Overall Goal: Lightweight Web3 Chat Worker Node

## 1. Background & Motivation
In `web3-chat-worker-legacy`, all chat states—including user accounts, groups, group memberships, friend relationships, and blacklists—were tightly coupled to a single Cloudflare D1 database instance. This made multi-node deployment and disaster recovery difficult.

The upgraded architecture stores sovereign chat state on EVM smart contracts (`web3-chat-contract`):
- User identities, profiles, and state are anchored in on-chain clones deployed via `ChatStorageFactory.sol`.
- Groups, memberships, roles (Owner, Admin, Member), mute, and ban lists are managed in on-chain `GroupImplementation.sol` clones.
- Bidirectional social relationships and blacklists are coordinated via `RelationshipManager.sol` and `UserImplementation.sol`.
- Global group discovery and user group indexing (`user -> currentGroupIds`) are provided by `ChatStorageFactory.sol`.

## 2. Worker Mission
The new `web3-chat-worker` functions as a **lightweight state node (轻状态节点)**:
1. **Stateless State Recovery**: Any newly initialized worker node connects to the EVM contract via RPC pool and immediately discovers users, groups, and permissions without needing local group synchronization.
2. **Configurable RPC Pool & Caching**: The worker receives RPC pool endpoints and factory contract address during initialization. To prevent excessive RPC load, queries (such as user group memberships, mute/ban status, and block status) are cached with a configurable TTL (`RPC_CACHE_TTL_SECONDS`).
3. **EVM Authentication**: EVM EIP-191 challenge-response authentication.
4. **Messaging & Media Transit**: Relational persistence in D1 for transient/ephemeral messages, receipts, and media metadata; audio/image/file binaries stored in R2.
5. **Incremental Timestamp Sync**: `GET /sync?since=<timestamp>` synchronizes the latest messages across all groups the user belongs to (as determined by contract query) and direct 1:1 chats.
6. **Dual-Storage Ephemeral Messaging**: 30-second recall window, explicit client delivery/read ACK, 30-second burn-on-read destruction.
