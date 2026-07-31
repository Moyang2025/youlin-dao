import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import profileArtifact from "../artifacts/contracts/YoulinProfileRegistry.sol/YoulinProfileRegistry.json" with { type: "json" };

type Deployment = {
  contracts: { YoulinProfileRegistry: Address };
};

const privateKey = process.env.PRIVATE_KEY?.trim();
if (!privateKey) throw new Error("PRIVATE_KEY is missing from the local .env");
const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;
const deployment = JSON.parse(
  await readFile(path.join(process.cwd(), "deployments", "monad-testnet.json"), "utf8"),
) as Deployment;
const rpc = process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = http(rpc);
const account = privateKeyToAccount(normalizeKey(privateKey));
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const profile = {
  nickname: "有邻 DAO 演示账户",
  avatarURI:
    "https://youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site/youlin-logo.png",
  bio: "关注社区公共项目、透明募捐与可验证的链上公益履历。",
};

const hash = await walletClient.writeContract({
  address: deployment.contracts.YoulinProfileRegistry,
  abi: profileArtifact.abi as Abi,
  functionName: "setProfile",
  args: [profile.nickname, profile.avatarURI, profile.bio],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("Profile demo transaction reverted");

await mkdir(path.join(process.cwd(), "deployments"), { recursive: true });
await writeFile(
  path.join(process.cwd(), "deployments", "profile-demo.json"),
  `${JSON.stringify(
    {
      chainId: 10143,
      registry: deployment.contracts.YoulinProfileRegistry,
      account: account.address,
      profile,
      transactionHash: hash,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Demo profile written on chain: ${hash}`);
