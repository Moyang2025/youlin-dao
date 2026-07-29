import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };
import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Deployment = {
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
  };
};

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;
const keys = (process.env.DEMO_PRIVATE_KEYS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (keys.length < 12) {
  throw new Error("DEMO_PRIVATE_KEYS must contain at least 12 comma-separated test keys");
}

const deployment = JSON.parse(
  await readFile(
    path.join(process.cwd(), "deployments", "monad-testnet.json"),
    "utf8",
  ),
) as Deployment;
const rpc =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = http(rpc);
const publicClient = createPublicClient({ chain, transport });
const makeWallet = (key: string) =>
  createWalletClient({
    account: privateKeyToAccount(normalizeKey(key)),
    chain,
    transport,
  });
type DemoWallet = ReturnType<typeof makeWallet>;
const wallets = keys.slice(0, 12).map(makeWallet);
const [
  initiator1,
  initiator2,
  initiator3,
  donor1,
  donor2,
  donor3,
  donor4,
  challenger1,
  challenger2,
  juror1,
  juror2,
  juror3,
] = wallets;
const initiators = [initiator1, initiator2, initiator3] as const;
const protocol = deployment.contracts.YoulinProtocol;
const reputation = deployment.contracts.YoulinReputation;
const protocolAbi = protocolArtifact.abi as Abi;
const transactions: Array<{ label: string; hash: Hash }> = [];
const projects: Array<{
  id: string;
  label: string;
  expectedState: string;
  metadataURI: string;
}> = [];

const closed = (await publicClient.readContract({
  address: reputation,
  abi: reputationArtifact.abi as Abi,
  functionName: "bootstrapClosed",
})) as boolean;
if (!closed) {
  throw new Error("Run npm run bootstrap:demo before seeding projects");
}

async function send(
  wallet: DemoWallet,
  label: string,
  functionName: string,
  args: readonly unknown[] = [],
  value?: bigint,
) {
  const hash = await wallet.writeContract({
    address: protocol,
    abi: protocolAbi,
    functionName,
    args,
    value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  transactions.push({ label, hash });
  console.log(`${label}: ${hash}`);
  return hash;
}

async function waitUntil(timestamp: bigint, label: string) {
  let lastNotice = 0;
  while (true) {
    const block = await publicClient.getBlock();
    if (block.timestamp > timestamp) return;
    const remaining = Number(timestamp - block.timestamp + 1n);
    const now = Date.now();
    if (now - lastNotice > 30_000) {
      console.log(`${label}: ${remaining}s remaining`);
      lastNotice = now;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

async function createProject(
  fileName: string,
  label: string,
  deadlineSeconds: number,
  expectedDurationSeconds = 600,
) {
  const metadataPath = path.join(
    process.cwd(),
    "..",
    "..",
    "youlin-interface",
    "public",
    "demo",
    "metadata",
    fileName,
  );
  const metadata = await readFile(metadataPath, "utf8");
  const metadataHash = keccak256(toBytes(metadata));
  const metadataURI =
    `https://youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site/` +
    `demo/metadata/${fileName}`;
  const count = (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "projectCount",
  })) as bigint;
  const id = count + 1n;
  const block = await publicClient.getBlock();
  await send(initiator1, `${label}：创建草案`, "createProjectDraft", [
    initiator1.account.address,
    parseEther("0.06"),
    block.timestamp + BigInt(deadlineSeconds),
    BigInt(expectedDurationSeconds),
    initiators.map((wallet) => wallet.account.address),
    metadataURI,
    metadataHash,
  ]);
  return { id, metadataURI };
}

async function acceptAndActivate(id: bigint, label: string) {
  for (const [index, initiator] of initiators.entries()) {
    await send(
      initiator,
      `${label}：发起人 ${index + 1} 确认质押`,
      "acceptInitiation",
      [id, parseEther("0.02")],
    );
  }
  await send(donor4, `${label}：权限外激活`, "activateProject", [id]);
}

const draft = await createProject("project-draft.json", "项目 A", 3_600);
projects.push({
  id: draft.id.toString(),
  label: "项目 A：草案待共同发起",
  expectedState: "Draft",
  metadataURI: draft.metadataURI,
});

const funding = await createProject("project-funding.json", "项目 B", 3_600);
await acceptAndActivate(funding.id, "项目 B");
projects.push({
  id: funding.id.toString(),
  label: "项目 B：第一轮募捐",
  expectedState: "Round1Funding",
  metadataURI: funding.metadataURI,
});

const failed = await createProject("project-failed.json", "项目 C", 75);
await acceptAndActivate(failed.id, "项目 C");
await send(
  donor1,
  "项目 C：未达标捐款",
  "donateRound1",
  [failed.id],
  parseEther("0.005"),
);
const failedTimes = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectTimes",
  args: [failed.id],
})) as readonly bigint[];
await waitUntil(failedTimes[0], "等待项目 C 第一轮截止");
await send(donor2, "项目 C：判定首轮未达标", "markRound1Failed", [failed.id]);
await send(donor1, "项目 C：领取退款", "refundRound1", [failed.id]);
projects.push({
  id: failed.id.toString(),
  label: "项目 C：第一轮未达标并退款",
  expectedState: "Round1Failed",
  metadataURI: failed.metadataURI,
});

const lifecycle = await createProject(
  "project-settled.json",
  "项目 D",
  3_600,
  900,
);
await acceptAndActivate(lifecycle.id, "项目 D");
for (const [index, donor] of [donor1, donor2, donor3].entries()) {
  await send(
    donor,
    `项目 D：第一轮捐款 ${index + 1}`,
    "donateRound1",
    [lifecycle.id],
    parseEther("0.01"),
  );
}
for (const donor of [donor1, donor2, donor3]) {
  await send(
    donor,
    "项目 D：领取第一轮捐款 R",
    "claimRound1DonationReputation",
    [lifecycle.id],
  );
}
await send(
  initiator1,
  "项目 D：项目钱包领取第一轮资金",
  "claimRound1Funds",
  [lifecycle.id],
);
let times = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectTimes",
  args: [lifecycle.id],
})) as readonly bigint[];
await waitUntil(times[3] + 180n, "保留可完成结项的第一阶段用时");
await send(initiator1, "项目 D：提交中期材料", "submitMidReview", [
  lifecycle.id,
  lifecycle.metadataURI,
  keccak256(toBytes("project-d-mid-evidence")),
]);
for (const donor of [donor1, donor2, donor3]) {
  await send(donor, "项目 D：中期评分 8", "submitMidScore", [lifecycle.id, 8]);
}
times = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectTimes",
  args: [lifecycle.id],
})) as readonly bigint[];
await waitUntil(times[6], "等待项目 D 中期评分结束");
await send(donor4, "项目 D：中期定分", "finalizeMidScore", [lifecycle.id]);
for (const [index, donor] of [donor4, donor2, donor3].entries()) {
  await send(
    donor,
    `项目 D：第二轮捐款 ${index + 1}`,
    "donateRound2",
    [lifecycle.id],
    parseEther("0.01"),
  );
}
await send(initiator1, "项目 D：提交结项材料", "submitFinalReview", [
  lifecycle.id,
  lifecycle.metadataURI,
  keccak256(toBytes("project-d-final-evidence")),
]);
for (const donor of [donor1, donor2, donor3, donor4]) {
  await send(donor, "项目 D：结项评分 9", "submitFinalScore", [lifecycle.id, 9]);
}
times = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectTimes",
  args: [lifecycle.id],
})) as readonly bigint[];
await waitUntil(times[9], "等待项目 D 结项评分结束");
await send(challenger1, "项目 D：结项定分", "finalizeFinalScore", [lifecycle.id]);
times = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectTimes",
  args: [lifecycle.id],
})) as readonly bigint[];
await waitUntil(times[10], "等待项目 D 挑战窗口结束");
await send(challenger2, "项目 D：无挑战最终结算", "settleWithoutChallenge", [
  lifecycle.id,
]);
projects.push({
  id: lifecycle.id.toString(),
  label: "项目 D：90 分完整结算",
  expectedState: "Settled",
  metadataURI: lifecycle.metadataURI,
});

const outputDirectory = path.join(process.cwd(), "deployments");
await mkdir(outputDirectory, { recursive: true });
const output = {
  chainId: 10143,
  generatedAt: new Date().toISOString(),
  note: "All entries and state transitions were created by Monad Testnet transactions.",
  publicDemoAddresses: {
    initiators: initiators.map((wallet) => wallet.account.address),
    donors: [donor1, donor2, donor3, donor4].map(
      (wallet) => wallet.account.address,
    ),
    challengers: [challenger1, challenger2].map(
      (wallet) => wallet.account.address,
    ),
    jurors: [juror1, juror2, juror3].map((wallet) => wallet.account.address),
  },
  projects,
  transactions,
};
await writeFile(
  path.join(outputDirectory, "demo-projects.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);
console.log("Demo projects and one complete lifecycle recorded.");
