import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Deployment = {
  contracts: { YoulinReputation: Address };
  bootstrap: { closed: boolean; transactionHash: string | null };
};

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;
const adminKey = process.env.PRIVATE_KEY;
const demoKeys = (process.env.DEMO_PRIVATE_KEYS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!adminKey) throw new Error("PRIVATE_KEY is required");
if (demoKeys.length < 12) {
  throw new Error("DEMO_PRIVATE_KEYS must contain at least 12 comma-separated test keys");
}

const deploymentPath = path.join(
  process.cwd(),
  "deployments",
  "monad-testnet.json",
);
const deployment = JSON.parse(
  await readFile(deploymentPath, "utf8"),
) as Deployment;
const rpc =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const transport = http(rpc);
const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const publicClient = createPublicClient({ chain: monadTestnet, transport });
const admin = privateKeyToAccount(normalizeKey(adminKey));
const wallet = createWalletClient({
  account: admin,
  chain: monadTestnet,
  transport,
});
const reputation = deployment.contracts.YoulinReputation;
const closed = (await publicClient.readContract({
  address: reputation,
  abi: reputationArtifact.abi as Abi,
  functionName: "bootstrapClosed",
})) as boolean;

if (closed) {
  console.log("Bootstrap is already permanently closed.");
  process.exit(0);
}

const accounts = Array.from(
  new Set([
    admin.address,
    ...demoKeys.map((key) => privateKeyToAccount(normalizeKey(key)).address),
  ]),
);
const mintHash = await wallet.writeContract({
  address: reputation,
  abi: reputationArtifact.abi as Abi,
  functionName: "bootstrapMint",
  args: [accounts, accounts.map(() => parseEther("100"))],
});
await publicClient.waitForTransactionReceipt({ hash: mintHash });
console.log(`Bootstrapped ${accounts.length} public demo addresses: ${mintHash}`);

const closeHash = await wallet.writeContract({
  address: reputation,
  abi: reputationArtifact.abi as Abi,
  functionName: "closeBootstrap",
});
await publicClient.waitForTransactionReceipt({ hash: closeHash });
deployment.bootstrap = { closed: true, transactionHash: closeHash };
await writeFile(
  deploymentPath,
  `${JSON.stringify(deployment, null, 2)}\n`,
  "utf8",
);
console.log(`Bootstrap permanently closed: ${closeHash}`);
