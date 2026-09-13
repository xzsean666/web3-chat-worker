// SPDX-License-Identifier: MIT
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ChatSDK,
  GroupStatus,
  JoinMode,
  Role,
} from "@web3-chat/sdk";
import { app } from "../src/index";
import { createMockD1Database } from "../test/helpers/db";
import { createMockR2Bucket } from "../test/helpers/r2";
import { ConversationService } from "../src/services/conversation";
import { SweeperService } from "../src/services/sweeper";
import {
  anvilChain,
  deployProtocolToAnvil,
  startAnvil,
  type AnvilInstance,
  type DeployedProtocol,
} from "./deployProtocol";
import type { Env } from "../src/types";

describe("Local Joint Integration: EVM Chat State Storage Smart Contracts & Cloudflare Worker Node", () => {
  let anvil: AnvilInstance;
  let deployed: DeployedProtocol;
  let publicClient: PublicClient;

  // Real EVM test accounts on Anvil
  const aliceAccount = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  );
  const bobAccount = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  );
  const charlieAccount = privateKeyToAccount(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  );

  const aliceAddress = aliceAccount.address;
  const bobAddress = bobAccount.address;
  const charlieAddress = charlieAccount.address;

  let aliceWallet: WalletClient;
  let bobWallet: WalletClient;
  let charlieWallet: WalletClient;

  let sdkAlice: ChatSDK;
  let sdkBob: ChatSDK;
  let sdkCharlie: ChatSDK;

  let env: Env;
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;

  let dmConversationId: string;
  let directMessageId: string;
  let groupMessageId: string;
  let ephemeralMessageId: string;
  let voiceMessageId: string;

  beforeAll(async () => {
    // 1. Start local Anvil sandbox node
    anvil = await startAnvil(8547);

    // 2. Deploy all core smart contracts to Anvil
    deployed = await deployProtocolToAnvil(anvil.rpcUrl);
    publicClient = deployed.publicClient;

    // 3. Configure viem wallet clients for accounts
    aliceWallet = createWalletClient({
      account: aliceAccount,
      chain: anvilChain,
      transport: http(anvil.rpcUrl),
    });

    bobWallet = createWalletClient({
      account: bobAccount,
      chain: anvilChain,
      transport: http(anvil.rpcUrl),
    });

    charlieWallet = createWalletClient({
      account: charlieAccount,
      chain: anvilChain,
      transport: http(anvil.rpcUrl),
    });

    // 4. Initialize real ChatSDK client instances
    sdkAlice = new ChatSDK({
      factoryAddress: deployed.factory,
      chain: anvilChain,
      publicClient,
      walletClient: aliceWallet,
    });

    sdkBob = new ChatSDK({
      factoryAddress: deployed.factory,
      chain: anvilChain,
      publicClient,
      walletClient: bobWallet,
    });

    sdkCharlie = new ChatSDK({
      factoryAddress: deployed.factory,
      chain: anvilChain,
      publicClient,
      walletClient: charlieWallet,
    });

    // 5. Initialize Worker runtime environment connected to real contract factory & Anvil RPC
    env = {
      DB: createMockD1Database(),
      VOICE_BUCKET: createMockR2Bucket(),
      FACTORY_ADDRESS: deployed.factory,
      RPC_URLS: anvil.rpcUrl,
      CHAIN_ID: 31337,
      RPC_CACHE_TTL_SECONDS: "0", // 0 TTL in joint test for instant on-chain reflection
      MESSAGE_RECALL_WINDOW_SECONDS: "30",
    };
  }, 30_000);

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
    }
  });

  it("Stage 1: On-Chain User Clone Registration & Worker EVM Challenge Auth", async () => {
    // 1. Register UserClones on smart contract via SDK
    const txA = await sdkAlice.createUser();
    await publicClient.waitForTransactionReceipt({ hash: txA });

    const txB = await sdkBob.createUser();
    await publicClient.waitForTransactionReceipt({ hash: txB });

    const txC = await sdkCharlie.createUser();
    await publicClient.waitForTransactionReceipt({ hash: txC });

    // Verify clones deployed on-chain
    const cloneA = await sdkAlice.getUserContract(aliceAddress);
    const cloneB = await sdkAlice.getUserContract(bobAddress);
    const cloneC = await sdkAlice.getUserContract(charlieAddress);

    expect(cloneA.startsWith("0x")).toBe(true);
    expect(cloneB.startsWith("0x")).toBe(true);
    expect(cloneC.startsWith("0x")).toBe(true);
    expect(cloneA).not.toBe(cloneB);

    // 2. Set profile metadata on-chain via UserClient
    const userAlice = await sdkAlice.user();
    const txMetaA = await userAlice.setMetadata({
      displayName: "Alice Wonder",
      bio: "Web3 Core Protocol Lead",
      handle: "@alice",
    });
    await publicClient.waitForTransactionReceipt({ hash: txMetaA });

    const userBob = await sdkBob.user();
    const txMetaB = await userBob.setMetadata({
      displayName: "Bob Builder",
      bio: "Decentralized Messaging Dev",
      handle: "@bob",
    });
    await publicClient.waitForTransactionReceipt({ hash: txMetaB });

    // 3. Authenticate with Worker via EIP-191 Challenge-Response
    // Alice Auth
    const nonceResA = await app.request(`/auth/nonce?address=${aliceAddress}`, {}, env);
    expect(nonceResA.status).toBe(200);
    const { nonce: nA, message: msgA } = (await nonceResA.json()) as any;
    const sigA = await aliceWallet.signMessage({ account: aliceAccount, message: msgA });
    const verifyResA = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: aliceAddress, signature: sigA, nonce: nA }),
      },
      env
    );
    expect(verifyResA.status).toBe(200);
    aliceToken = ((await verifyResA.json()) as any).token;
    expect(aliceToken).toBeDefined();

    // Bob Auth
    const nonceResB = await app.request(`/auth/nonce?address=${bobAddress}`, {}, env);
    expect(nonceResB.status).toBe(200);
    const { nonce: nB, message: msgB } = (await nonceResB.json()) as any;
    const sigB = await bobWallet.signMessage({ account: bobAccount, message: msgB });
    const verifyResB = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: bobAddress, signature: sigB, nonce: nB }),
      },
      env
    );
    expect(verifyResB.status).toBe(200);
    bobToken = ((await verifyResB.json()) as any).token;
    expect(bobToken).toBeDefined();

    // Charlie Auth
    const nonceResC = await app.request(`/auth/nonce?address=${charlieAddress}`, {}, env);
    expect(nonceResC.status).toBe(200);
    const { nonce: nC, message: msgC } = (await nonceResC.json()) as any;
    const sigC = await charlieWallet.signMessage({ account: charlieAccount, message: msgC });
    const verifyResC = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: charlieAddress, signature: sigC, nonce: nC }),
      },
      env
    );
    expect(verifyResC.status).toBe(200);
    charlieToken = ((await verifyResC.json()) as any).token;
    expect(charlieToken).toBeDefined();

    // 4. Worker queries user profile directly from live on-chain contract
    const userResA = await app.request(`/users/${aliceAddress}`, {}, env);
    expect(userResA.status).toBe(200);
    const userDataA = (await userResA.json()) as any;
    expect(userDataA.user.address.toLowerCase()).toBe(aliceAddress.toLowerCase());
    expect(userDataA.user.metadata.displayName).toBe("Alice Wonder");
    expect(userDataA.user.metadata.bio).toBe("Web3 Core Protocol Lead");
    expect(userDataA.user.friendCount).toBe("0");
    expect(userDataA.user.groupCount).toBe("0");

    const userResB = await app.request(`/users/${bobAddress}`, {}, env);
    expect(userResB.status).toBe(200);
    const userDataB = (await userResB.json()) as any;
    expect(userDataB.user.metadata.displayName).toBe("Bob Builder");
  });

  it("Stage 2: On-Chain Friendship Handshake & Worker Social Relationship APIs", async () => {
    const relAlice = await sdkAlice.relationship();
    const relBob = await sdkBob.relationship();

    // Alice sends friend request to Bob on-chain
    const txReq = await relAlice.sendRequest(bobAddress);
    await publicClient.waitForTransactionReceipt({ hash: txReq });

    // Bob accepts friend request on-chain
    const txAcc = await relBob.acceptRequest(aliceAddress);
    await publicClient.waitForTransactionReceipt({ hash: txAcc });

    // Verify on-chain status via Worker /social endpoints
    const friendsResA = await app.request(
      "/social/friends",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(friendsResA.status).toBe(200);
    const friendsDataA = (await friendsResA.json()) as any;
    expect(friendsDataA.friends.map((f: string) => f.toLowerCase())).toContain(bobAddress.toLowerCase());

    const friendsResB = await app.request(
      "/social/friends",
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(friendsResB.status).toBe(200);
    const friendsDataB = (await friendsResB.json()) as any;
    expect(friendsDataB.friends.map((f: string) => f.toLowerCase())).toContain(aliceAddress.toLowerCase());

    // Check specific friend check route /social/friends/:address
    const isFrRes1 = await app.request(
      `/social/friends/${bobAddress}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(isFrRes1.status).toBe(200);
    expect(((await isFrRes1.json()) as any).is_friend).toBe(true);

    const isFrRes2 = await app.request(
      `/social/friends/${charlieAddress}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(isFrRes2.status).toBe(200);
    expect(((await isFrRes2.json()) as any).is_friend).toBe(false);

    // Profile friendCount should now be 1
    const profileA = await app.request(`/users/${aliceAddress}`, {}, env);
    expect(((await profileA.json()) as any).user.friendCount).toBe("1");
  });

  it("Stage 3: Direct Messaging & Real-Time On-Chain Blacklist Enforcement", async () => {
    // 1. Alice creates direct conversation with Bob
    const directRes = await app.request(
      "/conversations/direct",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_address: bobAddress }),
      },
      env
    );
    expect(directRes.status).toBe(200);
    const directData = (await directRes.json()) as any;
    dmConversationId = directData.conversation_id;
    expect(dmConversationId).toBe(ConversationService.buildDirectConversationId(aliceAddress, bobAddress));
    expect(directData.can_post).toBe(true);

    // 2. Alice sends a direct message to Bob
    const sendRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: dmConversationId,
          type: "text",
          content: "Hello Bob! Verified via Anvil smart contract.",
        }),
      },
      env
    );
    expect(sendRes.status).toBe(201);
    const sendData = (await sendRes.json()) as any;
    directMessageId = sendData.message.id;
    expect(sendData.message.status).toBe("pending");

    // 3. Bob ACKs delivery and read
    const ackRes = await app.request(
      `/messages/${directMessageId}/ack`,
      { method: "POST", headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(ackRes.status).toBe(200);

    const readRes = await app.request(
      `/messages/${directMessageId}/read`,
      { method: "POST", headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(readRes.status).toBe(200);

    // Verify receipts
    const receiptRes = await app.request(
      `/messages/${directMessageId}/receipts`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(receiptRes.status).toBe(200);
    const receipts = (await receiptRes.json()) as any;
    expect(receipts.total_delivered).toBe(1);
    expect(receipts.total_read).toBe(1);

    // 4. On-Chain Blacklist: Alice blocks Bob on-chain via smart contract
    const userAlice = await sdkAlice.user();
    const txBlock = await userAlice.blockUser(bobAddress);
    await publicClient.waitForTransactionReceipt({ hash: txBlock });

    // Verify Worker detects on-chain blocked status
    const blacklistRes = await app.request(
      `/social/blacklist/${bobAddress}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(blacklistRes.status).toBe(200);
    expect(((await blacklistRes.json()) as any).is_blocked).toBe(true);

    // 5. Bob attempts to send a direct message to Alice -> Worker intercepts with on-chain check
    const blockedSendRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: dmConversationId,
          type: "text",
          content: "Can you hear me Alice?",
        }),
      },
      env
    );
    expect(blockedSendRes.status).toBe(400);
    const blockedData = (await blockedSendRes.json()) as any;
    expect(blockedData.error).toContain("BLOCKED_BY_RECIPIENT");
    expect(blockedData.reason).toBe("BLOCKED_BY_RECIPIENT");

    // 6. Alice unblocks Bob on-chain
    const txUnblock = await userAlice.unblockUser(bobAddress);
    await publicClient.waitForTransactionReceipt({ hash: txUnblock });

    const unblockedCheck = await app.request(
      `/social/blacklist/${bobAddress}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(((await unblockedCheck.json()) as any).is_blocked).toBe(false);

    // Bob can now post again
    const postAgainRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: dmConversationId,
          type: "text",
          content: "Glad to be in touch again Alice!",
        }),
      },
      env
    );
    expect(postAgainRes.status).toBe(201);
  });

  it("Stage 4: On-Chain Group Creation, Dynamic Discovery & Membership Sync", async () => {
    // 1. Alice creates group on smart contract
    const groupMeta = {
      name: "Ethereum Protocol Builders",
      description: "Live joint test group on Anvil",
      announcement: "Welcome to decentralized chat!",
    };

    const txGroup = await sdkAlice.createGroup(groupMeta, [], JoinMode.PUBLIC, 50n);
    const groupRc = await publicClient.waitForTransactionReceipt({ hash: txGroup });
    expect(groupRc.status).toBe("success");

    const totalGroups = await sdkAlice.groupCount();
    expect(totalGroups).toBe(1n);

    // 2. Query Group Overview via Worker API
    const groupRes = await app.request(
      "/groups/1",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(groupRes.status).toBe(200);
    const groupData = (await groupRes.json()) as any;
    expect(groupData.group.id).toBe("group:1");
    expect(groupData.group.name).toBe("Ethereum Protocol Builders");
    expect(groupData.group.owner.toLowerCase()).toBe(aliceAddress.toLowerCase());
    expect(groupData.group.memberCount).toBe("1");
    expect(groupData.group.status).toBe(GroupStatus.ACTIVE);

    // 3. Dynamic Discovery: Alice sees Group 1 in /conversations without local group DB entry
    const aliceConvRes = await app.request(
      "/conversations",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(aliceConvRes.status).toBe(200);
    const aliceConvs = (await aliceConvRes.json()) as any;
    const aliceGroupEntry = aliceConvs.conversations.find((c: any) => c.id === "group:1");
    expect(aliceGroupEntry).toBeDefined();
    expect(aliceGroupEntry.name).toBe("Ethereum Protocol Builders");
    expect(aliceGroupEntry.canPost).toBe(true);

    // Bob has not joined yet -> Group 1 is NOT in Bob's /conversations
    const bobConvResBefore = await app.request(
      "/conversations",
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    const bobConvsBefore = (await bobConvResBefore.json()) as any;
    expect(bobConvsBefore.conversations.some((c: any) => c.id === "group:1")).toBe(false);

    // 4. Bob joins Group 1 on-chain
    const groupBob = await sdkBob.group(1n);
    const txJoin = await groupBob.join();
    await publicClient.waitForTransactionReceipt({ hash: txJoin });

    // Now Bob sees Group 1 dynamically discovered
    const bobConvResAfter = await app.request(
      "/conversations",
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    const bobConvsAfter = (await bobConvResAfter.json()) as any;
    const bobGroupEntry = bobConvsAfter.conversations.find((c: any) => c.id === "group:1");
    expect(bobGroupEntry).toBeDefined();
    expect(bobGroupEntry.canPost).toBe(true);

    // 5. Worker queries group members list from contract
    const membersRes = await app.request(
      "/groups/1/members",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(membersRes.status).toBe(200);
    const membersData = (await membersRes.json()) as any;
    const membersLower = membersData.members.map((m: string) => m.toLowerCase());
    expect(membersLower).toContain(aliceAddress.toLowerCase());
    expect(membersLower).toContain(bobAddress.toLowerCase());
    expect(membersLower).toHaveLength(2);

    // 6. Check caller role & mute status via Worker
    const aliceMuteStatus = await app.request(
      "/groups/1/muted",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(aliceMuteStatus.status).toBe(200);
    const aliceMuteData = (await aliceMuteStatus.json()) as any;
    expect(aliceMuteData.is_member).toBe(true);
    expect(aliceMuteData.role).toBe(Role.OWNER);

    const bobMuteStatus = await app.request(
      "/groups/1/muted",
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(bobMuteStatus.status).toBe(200);
    const bobMuteData = (await bobMuteStatus.json()) as any;
    expect(bobMuteData.is_member).toBe(true);
    expect(bobMuteData.role).toBe(Role.MEMBER);
    expect(bobMuteData.is_muted).toBe(false);
    expect(bobMuteData.is_banned).toBe(false);
  });

  it("Stage 5: On-Chain Group Moderation (Mute & Ban) & Worker Posting Enforcement", async () => {
    // 1. Alice & Bob post messages to Group 1
    const alicePostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Welcome to the group everyone!",
        }),
      },
      env
    );
    expect(alicePostRes.status).toBe(201);
    groupMessageId = ((await alicePostRes.json()) as any).message.id;

    const bobPostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Excited to collaborate on-chain!",
        }),
      },
      env
    );
    expect(bobPostRes.status).toBe(201);

    // 2. Non-member Charlie attempts to post to Group 1 -> Rejected by on-chain check
    const charliePostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${charlieToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Hello from outside!",
        }),
      },
      env
    );
    expect(charliePostRes.status).toBe(400);
    const charlieData = (await charliePostRes.json()) as any;
    expect(charlieData.reason).toBe("NOT_GROUP_MEMBER");

    // 3. On-chain Mute: Alice mutes Bob for 3600 seconds on-chain
    const groupAlice = await sdkAlice.group(1n);
    const txMute = await groupAlice.mute(bobAddress, 3600n);
    await publicClient.waitForTransactionReceipt({ hash: txMute });

    // Worker reflects muted state
    const bobMutedQuery = await app.request(
      "/groups/1/muted",
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(((await bobMutedQuery.json()) as any).is_muted).toBe(true);

    // Bob tries to post -> Worker rejects due to on-chain mute
    const mutedPostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Can I still talk?",
        }),
      },
      env
    );
    expect(mutedPostRes.status).toBe(400);
    expect(((await mutedPostRes.json()) as any).reason).toBe("USER_MUTED_IN_GROUP");

    // 4. Alice unmutes Bob on-chain
    const txUnmute = await groupAlice.unmute(bobAddress);
    await publicClient.waitForTransactionReceipt({ hash: txUnmute });

    // Bob can post again
    const postAfterUnmute = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Thank you for unmuting me!",
        }),
      },
      env
    );
    expect(postAfterUnmute.status).toBe(201);

    // 5. On-chain Ban: Alice bans Bob on-chain
    const txBan = await groupAlice.ban(bobAddress, 3600n);
    await publicClient.waitForTransactionReceipt({ hash: txBan });

    const bobBannedQuery = await app.request(
      "/groups/1/muted",
      { headers: { Authorization: `Bearer ${bobToken}` } },
      env
    );
    expect(((await bobBannedQuery.json()) as any).is_banned).toBe(true);

    const bannedPostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "I am trying to post while banned",
        }),
      },
      env
    );
    expect(bannedPostRes.status).toBe(400);
    expect(((await bannedPostRes.json()) as any).reason).toBe("USER_BANNED_IN_GROUP");

    // 6. Alice unbans Bob on-chain & Bob rejoins
    const txUnban = await groupAlice.unban(bobAddress);
    await publicClient.waitForTransactionReceipt({ hash: txUnban });

    const groupBob = await sdkBob.group(1n);
    const txRejoin = await groupBob.join();
    await publicClient.waitForTransactionReceipt({ hash: txRejoin });

    const postAfterRejoin = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Rejoined and ready to participate!",
        }),
      },
      env
    );
    expect(postAfterRejoin.status).toBe(201);
  });

  it("Stage 6: Group Lifecycle Status (Pause / Resume) vs Worker Posting", async () => {
    const groupAlice = await sdkAlice.group(1n);

    // Alice pauses Group 1 on-chain
    const txPause = await groupAlice.pause();
    await publicClient.waitForTransactionReceipt({ hash: txPause });

    const pausedOverview = await app.request(
      "/groups/1",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(((await pausedOverview.json()) as any).group.status).toBe(GroupStatus.PAUSED);

    // Attempting to post in paused group is rejected
    const pausedPostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Message while paused",
        }),
      },
      env
    );
    expect(pausedPostRes.status).toBe(400);
    expect(((await pausedPostRes.json()) as any).reason).toBe("GROUP_INACTIVE");

    // Alice resumes Group 1 on-chain
    const txResume = await groupAlice.resume();
    await publicClient.waitForTransactionReceipt({ hash: txResume });

    // Posting works again
    const resumePostRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Group resumed, back in action!",
        }),
      },
      env
    );
    expect(resumePostRes.status).toBe(201);
  });

  it("Stage 7: Incremental Timestamp Sync across Real On-Chain Groups and Direct Chats", async () => {
    // 1. Initial full sync for Alice (since = 0)
    const initialSyncRes = await app.request(
      "/sync?since=0",
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(initialSyncRes.status).toBe(200);
    const syncData1 = (await initialSyncRes.json()) as any;
    expect(syncData1.messages.length).toBeGreaterThan(0);
    expect(syncData1.groups.some((g: string) => g === "group:1")).toBe(true);
    const checkpointTime = syncData1.sync_timestamp;

    // 2. Incremental sync with since = checkpointTime -> No new messages
    const emptySyncRes = await app.request(
      `/sync?since=${checkpointTime + 1}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(emptySyncRes.status).toBe(200);
    const syncData2 = (await emptySyncRes.json()) as any;
    expect(syncData2.messages).toHaveLength(0);

    // Wait 1.1s so next message has created_at > checkpointTime
    await new Promise((r) => setTimeout(r, 1100));

    // 3. Bob sends a brand new message to Group 1
    const newMsgRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: "group:1",
          type: "text",
          content: "Sync checkpoint test message!",
        }),
      },
      env
    );
    expect(newMsgRes.status).toBe(201);
    const newMsgId = ((await newMsgRes.json()) as any).message.id;

    // 4. Alice syncs with since = checkpointTime -> Retrieves exactly the new message
    const deltaSyncRes = await app.request(
      `/sync?since=${checkpointTime}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(deltaSyncRes.status).toBe(200);
    const deltaSyncData = (await deltaSyncRes.json()) as any;
    expect(deltaSyncData.messages.some((m: any) => m.id === newMsgId)).toBe(true);
  });

  it("Stage 8: Dedicated Media, 30-Second Recall Protocol & Synchronized R2 Purge", async () => {
    // 1. Alice uploads voice note via dedicated media endpoint
    const audioData = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
    const file = new File([audioData], "voice.ogg", { type: "audio/ogg" });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("conversation_id", "group:1");
    formData.append("duration", "3.5");

    const uploadRes = await app.fetch(
      new Request("http://localhost/voice/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: formData,
      }),
      env
    );
    expect(uploadRes.status).toBe(201);
    const uploadJson = (await uploadRes.json()) as any;
    voiceMessageId = uploadJson.message.id;
    expect(uploadJson.message.type).toBe("voice");
    expect(voiceMessageId).toBeDefined();

    // 2. Audio stream is accessible
    const streamRes = await app.request(`/voice/${voiceMessageId}`, {}, env);
    expect(streamRes.status).toBe(200);

    // 3. Alice recalls the message within 30-second window
    const recallRes = await app.request(
      `/messages/${voiceMessageId}/recall`,
      { method: "POST", headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(recallRes.status).toBe(200);
    const recallData = (await recallRes.json()) as any;
    expect(recallData.message.content).toBeNull();
    expect(recallData.message.recalled_at).toBeGreaterThan(0);

    // 4. Binary is purged immediately from R2; stream returns 410 Gone
    const streamAfterRecall = await app.request(`/voice/${voiceMessageId}`, {}, env);
    expect(streamAfterRecall.status).toBe(410);

    // 5. Ephemeral messaging & 30-second burn countdown window on read
    const ephemeralRes = await app.request(
      "/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: dmConversationId,
          type: "text",
          content: "Self-destructing secret note",
          retention: "on_read",
          burn_after_seconds: 30,
        }),
      },
      env
    );
    expect(ephemeralRes.status).toBe(201);
    ephemeralMessageId = ((await ephemeralRes.json()) as any).message.id;

    // Alice reads the ephemeral message -> activates burn timer
    const readEphemeralRes = await app.request(
      `/messages/${ephemeralMessageId}/read`,
      { method: "POST", headers: { Authorization: `Bearer ${aliceToken}` } },
      env
    );
    expect(readEphemeralRes.status).toBe(200);
    const readEphemeralData = (await readEphemeralRes.json()) as any;
    expect(readEphemeralData.message.expires_at).toBeGreaterThan(0);
    expect(readEphemeralData.message.burn_after_seconds).toBe(30);

    // Run sweeper service for expired purge
    const sweeperResult = await SweeperService.runSweeper(env);
    expect(sweeperResult).toBeDefined();
    expect(sweeperResult.timestamp).toBeGreaterThan(0);
  });

  it("Stage 9: Single-Avatar R2 Storage & Unified On-Chain User Profile", async () => {
    // 1. Alice uploads avatar image to R2
    const avatarBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const avatarRes = await app.request(
      "/users/me/avatar",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "image/png",
        },
        body: avatarBytes,
      },
      env
    );
    expect(avatarRes.status).toBe(201);

    // 2. Stream public avatar via GET /users/:address/avatar
    const getAvatarRes = await app.request(`/users/${aliceAddress}/avatar`, {}, env);
    expect(getAvatarRes.status).toBe(200);
    expect(getAvatarRes.headers.get("Content-Type")).toBe("image/png");

    // 3. User overview integrates on-chain contract state + Worker R2 avatar
    const userOverviewRes = await app.request(`/users/${aliceAddress}`, {}, env);
    expect(userOverviewRes.status).toBe(200);
    const overview = (await userOverviewRes.json()) as any;
    expect(overview.user.avatar_url).toBe(`/users/${aliceAddress.toLowerCase()}/avatar`);
    expect(overview.user.metadata.displayName).toBe("Alice Wonder");
    expect(overview.user.friendCount).toBe("0"); // On-chain block pruned friendship
    expect(overview.user.groupCount).toBe("1");
  });
});
