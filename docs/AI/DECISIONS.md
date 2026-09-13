# Architectural Decisions (DECISIONS.md)

## ADR-001: Move Sovereign State to Smart Contracts
- **Context**: In the legacy worker, group ownership, memberships, friends, and blacklists resided in Cloudflare D1. Recovering state across multiple workers or restoring from failure was tightly coupled to D1 database replication.
- **Decision**: Use `web3-chat-contract` (`ChatStorageFactory`, `UserImplementation`, `GroupImplementation`, `RelationshipManager`) as the canonical source of truth for social relationships and groups.
- **Consequences**: Worker becomes a lightweight state node. Worker relies on RPC calls to verify membership and permissions.

## ADR-002: In-Memory TTL Caching for On-Chain Contract Queries
- **Context**: Reading contract status on every single message or sync request causes excessive RPC traffic, network latency, and rate-limiting from public/private RPC providers.
- **Decision**: Implement a configurable `RPC_CACHE_TTL_SECONDS` (default: 60s) caching layer inside the worker for user groups, memberships, mute status, and blocks.
- **Consequences**: Sub-millisecond response times for message validation while keeping on-chain state reasonably synchronized.

## ADR-003: Messages and Media Remain in Worker (D1 + R2)
- **Context**: Blockchain storage for high-frequency chat messages and voice/image/file binaries is prohibitively expensive and violates privacy (especially for ephemeral burn-on-read messages).
- **Decision**: Keep messages, message receipts, and media binaries in Cloudflare D1 and R2.
- **Consequences**: Ephemeral messages can be truly burned/purged in both D1 and R2 without leaving on-chain traces.

## ADR-004: Direct Conversation and Group ID Format
- **Context**: Direct conversations are 1:1, while groups are on-chain entities with numeric `groupId`.
- **Decision**:
  - Direct conversations use `direct:<minAddress>:<maxAddress>` (case-insensitive normalized).
  - Groups use `group:<groupId>` (e.g. `group:1`) or numeric string `1`.
- **Consequences**: Clear separation between 1:1 direct conversations and on-chain group conversations.
