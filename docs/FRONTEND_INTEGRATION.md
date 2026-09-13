# Web3 Chat Worker 前端对接开发指南 (Frontend Integration Guide)

本文档面向前端与移动端开发团队（Web / React / Vue / React Native / Flutter / 微信小程序等），详细阐述如何对接 **Web3 Chat Worker** 轻状态节点后端服务。

> **基准地址说明**：
> 文档中统一使用占位符 `WORKER_BASE_URL` 表示后端部署根路径（例如 `https://chat-worker.example.com`，末尾不带斜杠 `/`）。前端请配置为环境变量（如 `process.env.NEXT_PUBLIC_WORKER_BASE_URL` 或 `import.meta.env.VITE_WORKER_BASE_URL`）。

---

## 目录

1. [核心架构与设计规范](#1-核心架构与设计规范)
2. [公共请求头与错误响应规范](#2-公共请求头与错误响应规范)
3. [模块一：EVM 钱包签名鉴权 (Auth)](#3-模块一evm-钱包签名鉴权-auth)
4. [模块二：会话与主权群聊 (Conversations & Groups)](#4-模块二会话与主权群聊-conversations--groups)
5. [模块三：消息发送与拉取 (Messages)](#5-模块三消息发送与拉取-messages)
6. [模块四：显式确认机制 (Delivery & Read ACK)](#6-模块四显式确认机制-delivery--read-ack)
7. [模块五：多媒体消息与双重物理销毁 (Media, 30s Recall & Burn)](#7-模块五多媒体消息与双重物理销毁-media-30s-recall--burn)
8. [模块六：用户资料、唯一头像与社交关系 (Users & Social)](#8-模块六用户资料唯一头像与社交关系-users--social)
9. [模块七：增量全局同步引擎 (Incremental Sync)](#9-模块七增量全局同步引擎-incremental-sync)
10. [完整前端集成示例代码 (TypeScript SDK)](#10-完整前端集成示例代码-typescript-sdk)

---

## 1. 核心架构与设计规范

1. **轻状态节点 (Lightweight State Node)**：
   - 用户身份、群组、角色（Owner, Admin, Member）、禁言/封禁、好友与黑名单存储于 **EVM 智能合约**（`web3-chat-contract`）。
   - Worker 节点通过 RPC 池与 TTL 缓存机制（`RPC_CACHE_TTL_SECONDS`）无缝查询链上状态，免除本地群组数据库同步维护。
   - 短暂消息传输、投递回执、会话 Session 存储在 **Cloudflare D1 (SQLite)**。
   - 语音、图片、文件存储在 **Cloudflare R2** 中仅作为**临时中转缓冲区（In-Transit Relay Buffer）**，接收方拉取/已读后定时物理销毁，实现服务端零多媒体留存。
   - 用户头像优先采用智能合约链上 `metadata.avatar`（IPFS / Arweave / HTTPS），实现完全主权化与节点无关性。
2. **Web3 身份标准**：
   - 用户身份由 EVM 钱包地址识别，系统内部强制小写标准化。
   - 登录鉴权采用 EIP-191 挑战-应答签名（SIWE 流程），一次一密，防止重放攻击。
3. **显式 ACK 投递模型 (Explicit ACK)**：
   - 发送消息接口返回 `HTTP 201` **仅代表服务端收妥并入库（API Receipt）**。
   - 接收方客户端获取消息后，主动调用 `POST /messages/:id/ack`（状态转为 `delivered`）。
   - 用户查看消息后，主动调用 `POST /messages/:id/read`（状态转为 `read`）。
4. **多媒体中转“零留存”与双重物理销毁 (Zero-Retention Transit & Burn Protocol)**：
   - **多媒体零持久留存**：接收方读完消息后宽限 30 秒（`MEDIA_TRANSIT_GRACE_SECONDS`），Sweeper 自动将 R2 中的语音/图片/文件物理删除。前端需在本地（IndexedDB/文件沙盒）持久化存储多媒体，用户切换 Worker 节点 0 媒体丢失。
   - **私聊场景阅后即焚**：接收方触发已读后，开启 **30 秒倒计时销毁窗口**（发送方标记已读不会误触）。
   - **群聊场景阅后即焚**：
     - **前端责任**：成员读完后，前端应从本地存储与 UI 中立即销毁/隐藏该消息（单人读后本地即焚）。
     - **服务端责任**：群内所有非发送者成员（`memberCount - 1`）均标记已读后，服务端才开启全服 30 秒倒计时彻底物理销毁。
     - **安全兜底**：若有群成员长期离线，超出 `EPHEMERAL_FALLBACK_TTL`（默认 7 天）后无论是否全员读完均自动被 Sweeper 清理，杜绝数据残留。
   - 销毁窗口到期后，由后台 Sweeper 从 D1 SQLite 和 R2 存储桶中双向物理抹除。
5. **30 秒消息撤回 (Message Recall)**：
   - 发送者可在 30 秒内撤回消息，服务端清空文本并**立即从 R2 物理删除多媒体文件**。

---

## 2. 公共请求头与错误响应规范

### 2.1 跨域支持 (CORS)
Worker 支持全源跨域：
- `Access-Control-Allow-Origin: *`
- 支持 `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` 请求。

### 2.2 请求鉴权 Header
除健康检查和获取 Nonce 之外，受保护路由均需携带 Bearer Token：
```http
Authorization: Bearer <TOKEN>
```

### 2.3 错误响应结构
```json
{
  "error": "具体的错误信息描述"
}
```

---

## 3. 模块一：EVM 钱包签名鉴权 (Auth)

### 3.1 获取登录 Nonce 挑战码
- **接口路径**：`POST WORKER_BASE_URL/auth/nonce`
- **请求体**：
  ```json
  {
    "address": "0x1610725056c027d5ae4e2fce73bb925c82c59eaa"
  }
  ```
- **成功响应 (`HTTP 200`)**：
  ```json
  {
    "nonce": "c6233d4e6eb44078a6331a982994fef4",
    "message": "Sign this message to authenticate with Web3 Chat:\nNonce: c6233d4e6eb44078a6331a982994fef4\nAddress: 0x1610725056c027d5ae4e2fce73bb925c82c59eaa",
    "expires_at": 1788588157
  }
  ```

### 3.2 提交钱包签名完成登录
- **接口路径**：`POST WORKER_BASE_URL/auth/verify`
- **请求体**：
  ```json
  {
    "address": "0x1610725056c027d5ae4e2fce73bb925c82c59eaa",
    "signature": "0x...",
    "nonce": "c6233d4e6eb44078a6331a982994fef4"
  }
  ```
- **成功响应 (`HTTP 200`)**：
  ```json
  {
    "token": "d748f...BearerToken",
    "user": {
      "wallet_address": "0x1610725056c027d5ae4e2fce73bb925c82c59eaa",
      "clone_address": "0x...",
      "profile": { ... }
    }
  }
  ```

### 3.3 获取当前用户信息 & 注销
- `GET WORKER_BASE_URL/auth/me`（获取当前登录信息与链上资料）
- `POST WORKER_BASE_URL/auth/logout`（销毁当前 Session）

---

## 4. 模块二：会话与主权群聊 (Conversations & Groups)

### 4.1 发起 1v1 私聊（确定性 ID）
- **接口路径**：`POST WORKER_BASE_URL/conversations/direct`
- **请求体**：
  ```json
  {
    "target_address": "0x2c3dda511fd990cfa846acba9242c8aed3fbc7c2"
  }
  ```
- **成功响应 (`HTTP 200`)**：
  ```json
  {
    "conversation_id": "dm:0x1610725056c027d5ae4e2fce73bb925c82c59eaa:0x2c3dda511fd990cfa846acba9242c8aed3fbc7c2",
    "type": "dm",
    "peer_address": "0x2c3dda511fd990cfa846acba9242c8aed3fbc7c2"
  }
  ```

### 4.2 查询主权群聊信息与跑马灯
- **接口路径**：`GET WORKER_BASE_URL/groups/:id`（支持 `:id` 为 `1` 或 `group:1`）
- **成功响应 (`HTTP 200`)**：
  ```json
  {
    "group": {
      "id": "group:1",
      "groupId": "1",
      "name": "Web3 BUIDLers DAO",
      "description": "全球开发者技术社区",
      "announcement": "周五举行黑客松",
      "marquee": {
        "enabled": true,
        "text": "欢迎加入！最新黑客松报名已开启！",
        "speed": 50
      },
      "owner": "0x...",
      "memberCount": "128",
      "status": 1
    }
  }
  ```

### 4.3 查询群成员与禁言状态
- `GET WORKER_BASE_URL/groups/:id/members?offset=0&limit=50`
- `GET WORKER_BASE_URL/groups/:id/muted`

---

## 5. 模块三：消息发送与拉取 (Messages)

### 5.1 发送文本消息
- **接口路径**：`POST WORKER_BASE_URL/conversations/:id/messages`
- **请求体 (application/json)**：
  ```json
  {
    "content": "Hello Web3!",
    "retention": "permanent", // 或 "on_read" 阅后即焚
    "burn_after_seconds": 30
  }
  ```
- **成功响应 (`HTTP 201`)**：
  ```json
  {
    "message": {
      "id": "uuid",
      "conversation_id": "dm:0x...:0x...",
      "sender_id": "0x...",
      "type": "text",
      "content": "Hello Web3!",
      "retention": "permanent",
      "status": "pending",
      "created_at": 1788587857
    }
  }
  ```

### 5.2 分页拉取历史消息
- **接口路径**：`GET WORKER_BASE_URL/conversations/:id/messages?limit=50&before=1788587857`
- 自动过滤已过期的阅后即焚消息，并自动携带语音、图片、文件元数据。

---

## 6. 模块四：显式确认机制 (Delivery & Read ACK)

### 6.1 投递确认 (Delivery ACK)
- 单条确认：`POST WORKER_BASE_URL/messages/:id/ack`
- 批量确认：`POST WORKER_BASE_URL/messages/ack`
  ```json
  {
    "message_ids": ["msg-1", "msg-2"]
  }
  ```

### 6.2 已读确认 (Read ACK)
- 单条确认：`POST WORKER_BASE_URL/messages/:id/read`
- 批量确认：`POST WORKER_BASE_URL/messages/read`
  ```json
  {
    "message_ids": ["msg-1", "msg-2"]
  }
  ```
  > **阅后即焚说明**：对于 `retention: "on_read"` 消息：
  > - 私聊：接收方已读后开启 30 秒倒计时销毁窗口；
  > - 群聊：用户读完后前端在本地存储中抹除该消息；服务端待全群所有成员均已读（或超出 7 天兜底 TTL）后开启 30 秒全局物理销毁！

### 6.3 查询消息回执统计
- `GET WORKER_BASE_URL/messages/:id/receipts`
  返回投递人数、已读人数及每条回执的发生时间戳。

---

## 7. 模块五：多媒体消息中转“零留存”协议与物理销毁 (Media, Transit Relay & 30s Recall)

### 7.1 多媒体中转传输与前端本地缓存模式 (Client Local Storage Pattern)
> [!IMPORTANT]
> **Worker 节点不作为多媒体持久网盘！**
> 云端 R2 仅作为消息传输中的临时中转缓冲区（In-Transit Relay Buffer）。为了保护用户极致隐私与降低服务端存储依赖：
> 1. **上传与暂存**：发送方将多媒体文件上传至 Worker R2 存储桶。
> 2. **拉取与本地固化**：接收方客户端收到消息或执行同步后，调用媒体下载端点，**前端必须立即将多媒体数据保存至本地持久化存储**（如浏览器的 IndexedDB / OPFS 或移动端 App 本地文件沙盒）。
> 3. **已读与宽限期销毁**：接收方触发已读（Read ACK）后，服务端开启 30 秒宽限期（`MEDIA_TRANSIT_GRACE_SECONDS`，默认 30 秒）。宽限期一过，后台 Sweeper 将自动从 R2 中物理删除该多媒体二进制，并在 D1 中将消息内容置空。
> 4. **兜底过期清理**：若接收方长时间未登录/未读，超出安全兜底 TTL（默认 7 天）后，Sweeper 亦会自动从 R2 中彻底清除中转二进制。
> 5. **410 Gone 响应**：已被清除的媒体文件若再次请求流式端点，服务端将返回 `HTTP 410 Gone`（`{"error": "... binary was purged from transit relay"}`）。
> 6. **节点迁移无感**：由于所有历史多媒体均由客户端本地自持，用户在未来随意更换 Worker 轻节点时，多媒体数据不会发生任何丢失！

### 7.2 上传语音、图片与文件
前端既支持在 `POST /conversations/:id/messages` 传 `multipart/form-data`，也支持使用专属快捷端点：
- **语音上传**：`POST WORKER_BASE_URL/voice/upload`
  - 表单参数：`file`, `conversation_id`, `duration`, `retention`
- **图片上传**：`POST WORKER_BASE_URL/images/upload`
  - 表单参数：`file`, `conversation_id`, `width`, `height`, `retention`
- **文件上传**：`POST WORKER_BASE_URL/files/upload`
  - 表单参数：`file`, `conversation_id`, `retention`

### 7.3 流式媒体下载与播放 (受中转宽限期约束)
- 语音流：`GET WORKER_BASE_URL/voice/:messageId`
- 图片流：`GET WORKER_BASE_URL/images/:messageId`
- 文件流：`GET WORKER_BASE_URL/files/:messageId`（携带 `Content-Disposition` 附件头）
- 通用对象流：`GET WORKER_BASE_URL/media/:key`
> 若媒体二进制已从临时中转站销毁，上述接口统一返回 `HTTP 410 Gone`。

### 7.4 30 秒消息撤回
- `POST WORKER_BASE_URL/messages/:id/recall`
  - 仅发送者可在 30 秒内撤回。
  - D1 消息内容置空，R2 对应的多媒体二进制文件**立即彻底删除**。

---

## 8. 模块六：用户资料、主权头像与社交关系 (Users & Social)

### 8.1 主权头像系统 (Sovereign Avatar Priority & R2 Fallback)
1. **链上元数据优先**：
   - 用户在 EVM 智能合约注册/设置的 profile metadata 中可包含 `avatar`（支持 `ipfs://...`, `arweave://...`, 或任意公网 HTTPS 图床 URL）。
   - 调用 `GET WORKER_BASE_URL/users/:address` 获取用户信息时，后端**优先返回链上 `overview.metadata.avatar` 的直接 URL**。
   - 这意味着用户的头像完全锚定在区块链与去中心化存储中，换任何 Worker 节点都能即时渲染，零数据绑定！
2. **Worker 本地 R2 头像回退 (Fallback)**：
   - 若用户尚未在链上配置 avatar URL，系统自动回退至 Worker 本地 R2 头像服务（`WORKER_BASE_URL/users/:address/avatar`）。
   - 上传/覆盖 Worker 本地头像：`POST WORKER_BASE_URL/users/me/avatar`
     支持 `multipart/form-data`（key 为 `file` 或 `avatar`）或 JSON（`avatar_base64`）。
   - 直接流式展示头像：`GET WORKER_BASE_URL/users/:address/avatar`
     支持浏览器 `<img src="WORKER_BASE_URL/users/0x.../avatar" />` 直接渲染并带 HTTP ETag 缓存。

### 8.2 链上社交查询
- 获取链上好友列表：`GET WORKER_BASE_URL/social/friends?offset=0&limit=50`
- 检查某人是否是好友：`GET WORKER_BASE_URL/social/friends/:address`
- 检查某人是否被拉黑：`GET WORKER_BASE_URL/social/blacklist/:address`

---

## 9. 模块七：增量全局同步引擎 (Incremental Sync)

- **接口路径**：`GET WORKER_BASE_URL/sync?since=<timestamp>&limit=100`
- **功能特性**：
  1. 一次性获取用户加入的所有链上群组及 1v1 私聊中自 `since` 时间戳以来的所有新增消息。
  2. 自动拉取最新的消息回执变更（已投递、已读）。
  3. 自动排除并过滤已烧毁的阅后即焚消息。
  4. 极度节省移动端电量与流量消耗。

---

## 10. 完整前端集成示例代码 (TypeScript SDK)

```typescript
import { createWalletClient, custom } from 'viem';
import { mainnet } from 'viem/chains';

export class Web3ChatClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // 1. EIP-191 钱包签名鉴权登录
  async loginWithWallet(address: `0x${string}`, signer: (msg: string) => Promise<`0x${string}`>) {
    // 获取 Nonce
    const nonceRes = await fetch(`${this.baseUrl}/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    const { nonce, message } = await nonceRes.json();

    // 唤起签名
    const signature = await signer(message);

    // 提交校验
    const verifyRes = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, nonce }),
    });
    const data = await verifyRes.json();
    this.token = data.token;
    return data;
  }

  // 2. 发送文本消息
  async sendMessage(conversationId: string, content: string, onRead = false) {
    const res = await fetch(`${this.baseUrl}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        content,
        retention: onRead ? 'on_read' : 'permanent',
        burn_after_seconds: 30,
      }),
    });
    return res.json();
  }

  // 3. 批量投递确认
  async acknowledgeMessages(messageIds: string[]) {
    const res = await fetch(`${this.baseUrl}/messages/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ message_ids: messageIds }),
    });
    return res.json();
  }

  // 4. 增量全局同步
  async sync(sinceTimestamp: number) {
    const res = await fetch(`${this.baseUrl}/sync?since=${sinceTimestamp}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return res.json();
  }
}
```
