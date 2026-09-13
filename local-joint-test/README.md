# Web3 Chat Protocol 本地跨项目端到端联调测试指南 (README.md)

本目录封装了 **EVM 智能合约协议 (`web3-chat-contract`)** 与 **Cloudflare Worker 状态中继节点 (`web3-chat-worker`)** 在本地完整链路的联调测试套件、自动化运行脚本与架构上下文。

---

## 1. 联调背景与目标

在 Web3 Chat Protocol 架构中：
- **`web3-chat-contract`（主权层）**：负责链上用户身份克隆（`UserImplementation`）、群组治理与成员关系（`GroupImplementation`）、双向好友握手（`RelationshipManager`）以及全局克隆工厂（`ChatStorageFactory`）。
- **`web3-chat-worker`（中继层）**：基于 Cloudflare Worker 运行，负责 EIP-191 质询鉴权、消息实时中转（D1 SQLite）、大媒体文件暂存与撤回立即物理删除（R2 Object Storage）、增量时间戳同步（`/sync`）与 30 秒阅后即焚倒计时。
- **联调目标**：确保在**真实本地 EVM 节点**上部署的智能合约，能够与 Worker 各 API 端点实时联动。重点验证**链上状态直接决定 Worker 发信与群组准入权限**，且 Worker 数据库**绝不本地复制链上关系数据**。

---

## 2. 目录结构

```
/ssd0/git/web3-chat-worker/local-joint-test/
├── README.md              # 联调完整说明与上下文文档（本文档）
├── ARCHITECTURE_FLOW.md   # 核心时序图与数据流转详细架构设计
├── run.sh                 # 一键式端到端联调自动化执行脚本（可执行）
├── deployProtocol.ts      # 本地 Anvil 节点调度与核心合约自动部署器
└── joint.test.ts          # 9 大核心阶段全场景端到端联调测试代码
```

---

## 3. 前置依赖与运行要求

1. **Foundry / Anvil**：系统已安装 `anvil`（测试脚本会自动拉起 `anvil --port 8547 --silent`）。
2. **Node.js & pnpm**：使用 Node.js 20+ 及 `pnpm` 包管理器。
3. **合约构建文件**：确保 `/ssd0/git/web3-chat-contract/out` 下存在已编译的合约 Artifacts（若未编译，`run.sh` 会自动触发编译）。

---

## 4. 一键执行方式

### 方式 A：通过自动化脚本执行（推荐）
```bash
cd /ssd0/git/web3-chat-worker
./local-joint-test/run.sh
```

### 方式 B：通过 pnpm 命令执行
```bash
cd /ssd0/git/web3-chat-worker
pnpm run test:joint
```

---

## 5. 测试账号矩阵 (Test Actors)

联调测试使用 Anvil 内置的标准私钥与地址，已在链上分配 10,000 ETH：

| 角色 | 钱包地址 (Address) | 私钥 (Private Key) | 职责 |
|---|---|---|---|
| **Alice (Deployer & Owner)** | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | 合约部署者、用户克隆创建者、群组 1 创建者与所有者 |
| **Bob (User & Member)** | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | 用户克隆创建者、Alice 的好友、群组 1 成员、治理对象（禁言/封禁） |
| **Charlie (External Actor)** | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | 未加群/未加好友的外部用户，用于负面鉴权测试 |

---

## 6. 9 大阶段联调深度解析 (`joint.test.ts`)

### Stage 1: 链上身份克隆部署与 EIP-191 质询鉴权
- **链上操作**：Alice、Bob、Charlie 分别在合约调用 `sdk.createUser()`，Factory 部署 EIP-1167 最小代理克隆。调用 `setMetadata` 设置链上主权昵称与简介。
- **Worker 操作**：
  - 调用 `GET /auth/nonce?address=...` 获得服务端随机防重放 nonce。
  - 使用各私钥对挑战文本签名，调用 `POST /auth/verify` 获取 7 天 Bearer Token。
  - 调用 `GET /users/:address`，Worker 直接通过 RPC 聚合调用链上 `getUserOverview`，返回链上写入的姓名和简介。

### Stage 2: 链上好友握手与 Worker 社交关系查询
- **链上操作**：Alice 在链上调用 `RelationshipManager.sendRequest(Bob)`，Bob 调用 `acceptRequest(Alice)`，完成链上双向好友确认。
- **Worker 操作**：
  - Alice 与 Bob 分别调用 `GET /social/friends`，实时返回对方地址。
  - 调用 `GET /social/friends/:address`，针对 Bob 返回 `is_friend: true`，针对 Charlie 返回 `is_friend: false`。
  - 用户的 Profile `friendCount` 实时更新为 `1`。

### Stage 3: 点对点消息流转与链上黑名单实时拦截
- **Worker 操作**：Alice 向 Bob 发送私聊消息（初始 `pending`），Bob 调用 `/messages/:id/ack`（变为 `delivered`），随后调用 `/messages/:id/read`（变为 `read`），回执系统完整记录。
- **链上操作**：Alice 调用 `userAlice.blockUser(Bob)` 将 Bob 写入链上黑名单。
- **联动拦截**：
  - Worker `/social/blacklist/:bob` 实时返回 `is_blocked: true`。
  - Bob 试图通过 `POST /messages` 给 Alice 发消息，Worker 在校验 `canPostDirectMessage` 时触发链上 `isBlocked(Alice, Bob)` 查询，立即拦截并返回 `400 / BLOCKED_BY_RECIPIENT`。
  - Alice 链上调用 `unblockUser(Bob)` 后，Bob 发信恢复成功。

### Stage 4: 链上群组创建、Worker 动态发现与成员同步
- **链上操作**：Alice 调用 `sdkAlice.createGroup("Ethereum Protocol Builders", ...)`，生成 Group ID = 1。
- **动态发现**：
  - Alice 调用 Worker `GET /conversations`，Worker 实时调用链上 `getUserGroups(Alice)` 发现群 1，并合成会话列表（Worker 本地无任何预存群记录）。
  - Bob 调用 `GET /conversations`，由于尚未加群，会话列表中无群 1。
  - Bob 在链上调用 `groupBob.join()`。
  - 再次调用 `GET /conversations`，Bob 动态发现群 1，且 `/groups/1/members` 正确返回两名成员。
  - `/groups/1/muted` 验证 Alice 为 `Role.OWNER`，Bob 为 `Role.MEMBER`。

### Stage 5: 群组发言权限与链上治理管控（禁言/封禁）
- **非成员拦截**：外部用户 Charlie 试图在群 1 发言，被 Worker 链上校验拦截（`NOT_GROUP_MEMBER`）。
- **禁言管控**：Alice 在链上调用 `groupAlice.mute(Bob, 3600)`；Bob 发言被 Worker 实时拦截（`USER_MUTED_IN_GROUP`）；Alice 链上调用 `unmute` 后恢复。
- **封禁管控**：Alice 在链上调用 `groupAlice.ban(Bob, 3600)`；Bob 发言被实时拦截（`USER_BANNED_IN_GROUP`）；Alice 解封且 Bob 重新 `join()` 后恢复发言。

### Stage 6: 群组生命周期（暂停/恢复）控制
- **链上暂停**：Alice 在链上调用 `groupAlice.pause()`。
- **Worker 拦截**：群状态变为 `GroupStatus.PAUSED`，任何成员发信均被 Worker 拦截（`GROUP_INACTIVE`）。
- **链上恢复**：Alice 调用 `resume()`，发信即刻恢复通行。

### Stage 7: 跨链上群组与私聊的增量时间戳同步
- **全量同步**：Alice 调用 `GET /sync?since=0`，获取全部私聊与群聊消息。
- **增量同步**：Alice 记录 `sync_timestamp`；Bob 在群内发送新消息；Alice 调用 `GET /sync?since=<sync_timestamp>`，系统仅返回该条新消息，实现极简增量同步。

### Stage 8: 专用媒体与 30 秒协议（撤回立即清除 R2 & 阅后即焚倒计时）
- **媒体上传与流式读取**：Alice 调用 `POST /voice/upload` 上传音频，保存至 R2，并发送至群 1；通过 `GET /voice/:id` 正常播放。
- **30 秒撤回 & R2 物理销毁**：Alice 调用 `POST /messages/:id/recall`；Worker 将消息内容置空，并**立即删除 R2 中的二进制对象**；随后的流式访问直接返回 `410 Gone`。
- **阅后即焚**：Bob 发送 `retention: "on_read"` 消息，Alice 标记已读后，Worker 自动激活 30 秒销毁倒计时，定时 Sweeper 自动清理过期数据。

### Stage 9: R2 头像存储与链上用户资料统一视图
- **头像存储**：Alice 调用 `POST /users/me/avatar` 上传头像二进制流至 R2。
- **流式服务**：公开端点 `GET /users/:address/avatar` 流式输出头像图片。
- **统一视图**：`GET /users/:address` 将链上主权状态（姓名、好友数、群组数）与 Worker R2 头像 URL 完美融合成单一完整的用户 Profile。

---

## 7. 常见问题排查 (Troubleshooting)

1. **端口冲突 (`port 8547 is already in use`)**：
   - 脚本 `run.sh` 内置了 `fuser -k 8547/tcp` 自动清理挂起进程。亦可手动执行 `killall anvil`。
2. **找不到合约编译输出 (`Cannot find compiled bytecode`)**：
   - 请先进入 `/ssd0/git/web3-chat-contract` 目录并运行 `pnpm run compile`，或直接执行 `./local-joint-test/run.sh`（自动触发编译）。
3. **秒级时间戳同步粒度 (`since == created_at`)**：
   - 由于 SQLite 和 EVM 时间戳以秒（Seconds）为单位，在快速单测中若同一秒连续发信，测试代码内置了 `1.1s` 微等待以保证时间戳严格递增。
