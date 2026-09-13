// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ChatStorageFactoryABI,
  GroupImplementationABI,
  RelationshipManagerABI,
  UserImplementationABI,
} from "@web3-chat/sdk";

export const ANVIL_DEFAULT_PORT = 8547;

export const anvilChain = defineChain({
  id: 31337,
  name: "Anvil Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [`http://127.0.0.1:${ANVIL_DEFAULT_PORT}`] },
  },
});

export interface AnvilInstance {
  process: ChildProcess;
  rpcUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startAnvil(port = ANVIL_DEFAULT_PORT): Promise<AnvilInstance> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvilProc = spawn("anvil", ["--port", port.toString(), "--silent"]);

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  if (!ready) {
    anvilProc.kill("SIGKILL");
    throw new Error(`Failed to start local Anvil node on port ${port}`);
  }

  return {
    process: anvilProc,
    rpcUrl,
    port,
    stop: async () => {
      try {
        anvilProc.kill("SIGTERM");
      } catch {
        anvilProc.kill("SIGKILL");
      }
    },
  };
}

export function loadBytecode(contractName: string): Hex {
  const candidates = [
    resolve(__dirname, `../../web3-chat-contract/out/${contractName}.sol/${contractName}.json`),
    resolve(`/ssd0/git/web3-chat-contract/out/${contractName}.sol/${contractName}.json`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      if (parsed.bytecode?.object) {
        return parsed.bytecode.object as Hex;
      }
    }
  }

  throw new Error(`Cannot find compiled bytecode for contract ${contractName}`);
}

export interface DeployedProtocol {
  userImpl: Address;
  groupImpl: Address;
  factory: Address;
  relMgr: Address;
  publicClient: PublicClient;
  deployerWallet: WalletClient;
  rpcUrl: string;
}

export async function deployProtocolToAnvil(rpcUrl = `http://127.0.0.1:${ANVIL_DEFAULT_PORT}`): Promise<DeployedProtocol> {
  const deployerAccount = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  );

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: anvilChain, transport });
  const deployerWallet = createWalletClient({
    account: deployerAccount,
    chain: anvilChain,
    transport,
  });

  // 1. Deploy UserImplementation
  const userImplHash = await deployerWallet.deployContract({
    abi: UserImplementationABI,
    bytecode: loadBytecode("UserImplementation"),
  });
  const userImplReceipt = await publicClient.waitForTransactionReceipt({ hash: userImplHash });
  const userImpl = userImplReceipt.contractAddress!;

  // 2. Deploy GroupImplementation
  const groupImplHash = await deployerWallet.deployContract({
    abi: GroupImplementationABI,
    bytecode: loadBytecode("GroupImplementation"),
  });
  const groupImplReceipt = await publicClient.waitForTransactionReceipt({ hash: groupImplHash });
  const groupImpl = groupImplReceipt.contractAddress!;

  // 3. Deploy ChatStorageFactory
  const factoryHash = await deployerWallet.deployContract({
    abi: ChatStorageFactoryABI,
    bytecode: loadBytecode("ChatStorageFactory"),
    args: [userImpl, groupImpl],
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  const factory = factoryReceipt.contractAddress!;

  // 4. Deploy RelationshipManager
  const relMgrHash = await deployerWallet.deployContract({
    abi: RelationshipManagerABI,
    bytecode: loadBytecode("RelationshipManager"),
    args: [factory],
  });
  const relMgrReceipt = await publicClient.waitForTransactionReceipt({ hash: relMgrHash });
  const relMgr = relMgrReceipt.contractAddress!;

  // 5. Configure RelationshipManager on Factory
  const setRelHash = await deployerWallet.writeContract({
    address: factory,
    abi: ChatStorageFactoryABI,
    functionName: "setRelationshipManager",
    args: [relMgr],
  });
  await publicClient.waitForTransactionReceipt({ hash: setRelHash });

  return {
    userImpl,
    groupImpl,
    factory,
    relMgr,
    publicClient,
    deployerWallet,
    rpcUrl,
  };
}
