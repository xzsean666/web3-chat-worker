# Task Index

| Task ID | Objective | Scope | Status | Dependencies |
|---|---|---|---|---|
| [TASK-001](tasks/TASK-001.md) | Project Skeleton, Environment & Contract Integration Setup | Project config, deps, bindings, test harness | DONE | None |
| [TASK-002](tasks/TASK-002.md) | On-Chain Contract Service & Cached RPC Client Layer | Contract client, RPC pool, TTL cache | DONE | TASK-001 |
| [TASK-003](tasks/TASK-003.md) | EVM Authentication & User Profile Management | Challenge auth, token verification, user profile | DONE | TASK-002 |
| [TASK-004](tasks/TASK-004.md) | Lightweight Group & Conversation Access Management | Group resolution from contract, 1:1 direct chat, permissions | DONE | TASK-002, TASK-003 |
| [TASK-005](tasks/TASK-005.md) | Messaging Core, Media Storage & 30s Recall/Burn Protocol | Text/voice/image/file, 30s recall, ACK/read, burn-on-read | DONE | TASK-004 |
| [TASK-006](tasks/TASK-006.md) | Incremental Timestamp Sync Engine & Sweeper | Timestamp sync across on-chain groups, scheduled sweeper | DONE | TASK-005 |
| [TASK-007](tasks/TASK-007.md) | End-to-End Integration & Verification | E2E integration test suite, verification | DONE | TASK-006 |
| [TASK-008](tasks/TASK-008.md) | User Avatar Storage (R2), Metadata & Contract Social Query Endpoints | User avatars, metadata, profile, friends & blacklist queries | DONE | TASK-007 |
| [TASK-009](tasks/TASK-009.md) | Group State Query & Dedicated Media API Routes | Group overview/members/mute queries, /voice, /images, /files endpoints | DONE | TASK-008 |
| [TASK-010](tasks/TASK-010.md) | Message Receipts Query API & Batch Delivery/Read ACK | Receipts query, batch delivery ACK, batch read ACK | DONE | TASK-009 |
| [TASK-011](tasks/TASK-011.md) | Production Hardening, README, Frontend Integration Guide & Build Verification | Complete README, updated frontend integration guide, build scripts, full verification | DONE | TASK-010 |
| [TASK-012](tasks/TASK-012.md) | Local Live EVM Contract & Worker Cross-Project Joint Integration Testing | Live Anvil sandbox, real contract deployments, end-to-end multi-user joint verification across EVM contracts and Worker APIs | DONE | TASK-011 |
| [TASK-013](tasks/TASK-013.md) | Full Security & Performance Audit, Optimization and Dual-Project Hardening | Comprehensive security & performance audit across EVM contracts and Worker APIs, eliminating N+1 DB queries, isolate-level TTL cache & SDK pooling, atomic batch sweeper, JOIN media streams, overflow defense | DONE | TASK-012 |

