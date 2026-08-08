import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };
import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Deployment = {
  chainId: number;
  network: string;
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
  };
};

type VideoWalletManifest = {
  accounts: Array<{ label: string; address: Address }>;
};

type Lifecycle = {
  accounts: {
    executor: Address;
    projectADonorsAndProjectBInitiators: Address[];
  };
  projectB: {
    id: string;
    name: string;
    metadataURI: string;
    metadataHash: Hex;
  };
};

type Evidence = {
  schemaVersion: string;
  network: string;
  chainId: number;
  oldProjectId: string;
  newProjectId: string;
  name: string;
  requestedDeadline: string;
  round1DeadlineUnix: string;
  transactions: Array<{
    label: string;
    hash: Hash;
    blockNumber: string;
    confirmedAt: string;
  }>;
  finalState?: unknown;
  updatedAt: string;
};

const OLD_PROJECT_ID = 6n;
const REQUESTED_DEADLINE = 1_786_370_400n; // 2026-08-10 22:00:00 +08:00
const TARGET_AMOUNT = parseEther("30");
const EXPECTED_DURATION = 600n;
const STAKE_PER_INITIATOR = parseEther("10");

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;

const splitKeys = (value: string | undefined, count: number) => {
  const keys = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeKey);
  if (keys.length < count) {
    throw new Error(`DEMO_VIDEO_PRIVATE_KEYS must contain at least ${count} keys`);
  }
  return keys.slice(0, count);
};

const deploymentDir = path.join(process.cwd(), "deployments");
const evidencePath = path.join(deploymentDir, "demo-live-project-b.json");
const deployment = JSON.parse(
  await readFile(path.join(deploymentDir, "monad-testnet.json"), "utf8"),
) as Deployment;
const lifecycle = JSON.parse(
  await readFile(path.join(deploymentDir, "demo-video-lifecycle.json"), "utf8"),
) as Lifecycle;
const walletManifest = JSON.parse(
  await readFile(path.join(deploymentDir, "demo-video-wallets.public.json"), "utf8"),
) as VideoWalletManifest;

const executorKey = process.env.PRIVATE_KEY?.trim();
if (!executorKey) throw new Error("PRIVATE_KEY is missing");
const donorKeys = splitKeys(process.env.DEMO_VIDEO_PRIVATE_KEYS, 3);
const rpc = process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({
  id: deployment.chainId,
  name: deployment.network,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = http(rpc, { retryCount: 4, retryDelay: 1_000 });
const publicClient = createPublicClient({ chain, transport });
const makeWallet = (key: Hex) =>
  createWalletClient({
    account: privateKeyToAccount(key),
    chain,
    transport,
  });
const executor = makeWallet(normalizeKey(executorKey));
const donors = donorKeys.map(makeWallet);
const protocol = deployment.contracts.YoulinProtocol;
const reputation = deployment.contracts.YoulinReputation;
const protocolAbi = protocolArtifact.abi as Abi;
const reputationAbi = reputationArtifact.abi as Abi;

if (executor.account.address.toLowerCase() !== lifecycle.accounts.executor.toLowerCase()) {
  throw new Error("PRIVATE_KEY does not match the lifecycle executor");
}
for (const [index, donor] of donors.entries()) {
  const expected = walletManifest.accounts[index]?.address;
  if (!expected || donor.account.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Video account ${index + 1} does not match its public manifest`);
  }
}

let evidence: Evidence;
try {
  evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Evidence;
} catch {
  evidence = {
    schemaVersion: "1.0",
    network: deployment.network,
    chainId: deployment.chainId,
    oldProjectId: OLD_PROJECT_ID.toString(),
    newProjectId: "7",
    name: lifecycle.projectB.name,
    requestedDeadline: "2026-08-10T22:00:00+08:00",
    round1DeadlineUnix: REQUESTED_DEADLINE.toString(),
    transactions: [],
    updatedAt: new Date().toISOString(),
  };
}

async function persist() {
  evidence.updatedAt = new Date().toISOString();
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function record(label: string, hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  if (!evidence.transactions.some((item) => item.hash === hash)) {
    evidence.transactions.push({
      label,
      hash,
      blockNumber: receipt.blockNumber.toString(),
      confirmedAt: new Date().toISOString(),
    });
    await persist();
  }
  console.log(`${label}: ${hash}`);
}

type Wallet = ReturnType<typeof makeWallet>;
async function send(
  wallet: Wallet,
  label: string,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain,
    address: protocol,
    abi: protocolAbi,
    functionName,
    args,
  });
  await record(label, hash);
  return hash;
}

async function core(projectId: bigint) {
  return (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "getProjectCore",
    args: [projectId],
  })) as readonly [Address, Address, number, bigint, bigint, bigint, number, number, boolean, boolean];
}

async function times(projectId: bigint) {
  return (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "getProjectTimes",
    args: [projectId],
  })) as readonly bigint[];
}

const newProjectId = BigInt(evidence.newProjectId);
if (newProjectId !== 7n) throw new Error("Expected replacement project id 7");

const currentBlock = await publicClient.getBlock();
const oldTimes = await times(OLD_PROJECT_ID);
let oldCore = await core(OLD_PROJECT_ID);
if (oldCore[2] === 1) {
  if (currentBlock.timestamp <= oldTimes[0]) throw new Error("Project #6 deadline has not passed");
  if (oldCore[4] !== 0n) throw new Error("Project #6 unexpectedly has round-one donations");
  await send(executor, "项目 #6：标记首轮失败并解锁发起质押", "markRound1Failed", [OLD_PROJECT_ID]);
  oldCore = await core(OLD_PROJECT_ID);
}
if (oldCore[2] !== 2) throw new Error(`Project #6 is not Round1Failed; state=${oldCore[2]}`);

for (const [index, donor] of donors.entries()) {
  const available = (await publicClient.readContract({
    address: reputation,
    abi: reputationAbi,
    functionName: "availableBalanceOf",
    args: [donor.account.address],
  })) as bigint;
  if (available < STAKE_PER_INITIATOR) {
    throw new Error(`Initiator ${index + 1} has only ${formatEther(available)} available R`);
  }
}

let count = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "projectCount",
})) as bigint;
if (count < newProjectId) {
  if (count !== OLD_PROJECT_ID) throw new Error(`Unexpected projectCount ${count}`);
  await persist();
  await send(donors[0], "项目 #7：创建同名长期募捐草案", "createProjectDraft", [
    executor.account.address,
    TARGET_AMOUNT,
    REQUESTED_DEADLINE,
    EXPECTED_DURATION,
    donors.map((wallet) => wallet.account.address),
    lifecycle.projectB.metadataURI,
    lifecycle.projectB.metadataHash,
  ]);
  count = (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "projectCount",
  })) as bigint;
}
if (count < newProjectId) throw new Error("Replacement project was not created");

let replacementCore = await core(newProjectId);
if (replacementCore[2] === 0) {
  for (const [index, donor] of donors.entries()) {
    const stake = (await publicClient.readContract({
      address: protocol,
      abi: protocolAbi,
      functionName: "initiatorStake",
      args: [newProjectId, donor.account.address],
    })) as bigint;
    if (stake === 0n) {
      await send(donor, `项目 #7：共同发起人 ${index + 1} 锁定 10 R`, "acceptInitiation", [
        newProjectId,
        STAKE_PER_INITIATOR,
      ]);
    }
  }
  await send(executor, "项目 #7：达到门槛并激活第一轮募捐", "activateProject", [newProjectId]);
  replacementCore = await core(newProjectId);
}

const replacementTimes = await times(newProjectId);
if (replacementCore[2] !== 1) throw new Error(`Project #7 state is ${replacementCore[2]}, expected Round1Funding`);
if (replacementTimes[0] !== REQUESTED_DEADLINE) throw new Error("Project #7 deadline mismatch");

const initiators = [];
for (const donor of donors) {
  const [totalR, availableR, stake] = await Promise.all([
    publicClient.readContract({
      address: reputation,
      abi: reputationAbi,
      functionName: "balanceOf",
      args: [donor.account.address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: reputation,
      abi: reputationAbi,
      functionName: "availableBalanceOf",
      args: [donor.account.address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: protocol,
      abi: protocolAbi,
      functionName: "initiatorStake",
      args: [newProjectId, donor.account.address],
    }) as Promise<bigint>,
  ]);
  initiators.push({
    address: donor.account.address,
    totalR: formatEther(totalR),
    availableR: formatEther(availableR),
    projectStakeR: formatEther(stake),
  });
}

evidence.finalState = {
  oldProject: { id: "6", state: "Round1Failed", round1MON: formatEther(oldCore[4]) },
  replacementProject: {
    id: newProjectId.toString(),
    state: "Round1Funding",
    targetMON: formatEther(replacementCore[3]),
    round1MON: formatEther(replacementCore[4]),
    round1DeadlineUnix: replacementTimes[0].toString(),
    round1DeadlineUtc: new Date(Number(replacementTimes[0]) * 1000).toISOString(),
    round1DeadlineAsiaShanghai: "2026-08-10T22:00:00+08:00",
  },
  initiators,
};
await persist();

console.log(JSON.stringify({ evidencePath, transactionCount: evidence.transactions.length, finalState: evidence.finalState }, null, 2));
