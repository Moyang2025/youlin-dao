import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
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
  chainId: number;
  network: string;
  explorerUrl: string;
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
    YoulinGenesisTreasury: Address;
  };
};

type Evidence = {
  schemaVersion: string;
  network: string;
  chainId: number;
  projectId: string;
  name: string;
  metadataURI: string;
  metadataHash: Hex;
  targetMON: string;
  requestedDeadline: string;
  round1DeadlineUnix: string;
  expectedDurationSeconds: string;
  projectWallet: Address;
  userInitiator: Address;
  virtualInitiators: Address[];
  transactions: Array<{
    label: string;
    hash: Hash;
    blockNumber: string;
    confirmedAt: string;
  }>;
  finalState?: unknown;
  updatedAt: string;
};

const NAME = "为孤独老年人提供陪伴";
const TARGET = parseEther("30");
const VIRTUAL_STAKE = parseEther("5");
const USER_STAKE_REMAINING = parseEther("20");
const ROUND1_DEADLINE = 1_786_370_400n; // 2026-08-10 22:00:00 +08:00
const EXPECTED_DURATION = 2_592_000n; // 30 days
const USER_FUNDING_TX =
  "0xdfc25f5ac83028173ed9ffedfec0d6f48cb1d9976be1918611d1dc3ca0ef9973" as Hash;
const METADATA_FILE = path.resolve(
  process.cwd(),
  "../../youlin-interface/public/demo/metadata/companion-elderly.json",
);
const METADATA_URI =
  "https://youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site/demo/metadata/companion-elderly.json";

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;

const keysFrom = (value: string | undefined): Hex[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeKey);

const deploymentDir = path.join(process.cwd(), "deployments");
const evidencePath = path.join(deploymentDir, "companion-project-open.json");
const deployment = JSON.parse(
  await readFile(path.join(deploymentDir, "monad-testnet.json"), "utf8"),
) as Deployment;
const metadataText = await readFile(METADATA_FILE, "utf8");
const metadataHash = keccak256(toBytes(metadataText));

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
  createWalletClient({ account: privateKeyToAccount(key), chain, transport });

const executorKey = process.env.PRIVATE_KEY?.trim();
if (!executorKey) throw new Error("PRIVATE_KEY is missing");
const executor = makeWallet(normalizeKey(executorKey));
const candidateKeys = [
  ...keysFrom(process.env.DEMO_PRIVATE_KEYS),
  ...keysFrom(process.env.DEMO_VIDEO_PRIVATE_KEYS),
];
if (candidateKeys.length < 2) throw new Error("At least two demo private keys are required");

const protocol = deployment.contracts.YoulinProtocol;
const reputation = deployment.contracts.YoulinReputation;
const protocolAbi = protocolArtifact.abi as Abi;
const reputationAbi = reputationArtifact.abi as Abi;
const fundingTransaction = await publicClient.getTransaction({ hash: USER_FUNDING_TX });
if (
  !fundingTransaction.to ||
  fundingTransaction.to.toLowerCase() !== executor.account.address.toLowerCase()
) {
  throw new Error("The known 50 MON funding transaction does not target the executor wallet");
}
const userAddress = fundingTransaction.from;
const userAvailableR = (await publicClient.readContract({
  address: reputation,
  abi: reputationAbi,
  functionName: "availableBalanceOf",
  args: [userAddress],
})) as bigint;
if (userAvailableR < USER_STAKE_REMAINING) {
  throw new Error(
    `User wallet has only ${formatEther(userAvailableR)} available R; 20 R is required`,
  );
}

const candidates = await Promise.all(
  candidateKeys.map(async (key) => {
    const wallet = makeWallet(key);
    const [availableR, mon] = await Promise.all([
      publicClient.readContract({
        address: reputation,
        abi: reputationAbi,
        functionName: "availableBalanceOf",
        args: [wallet.account.address],
      }) as Promise<bigint>,
      publicClient.getBalance({ address: wallet.account.address }),
    ]);
    return { key, wallet, availableR, mon };
  }),
);
const selected = candidates
  .filter((item) => item.availableR >= VIRTUAL_STAKE && item.mon > parseEther("0.01"))
  .slice(0, 2);
if (selected.length < 2) throw new Error("Fewer than two demo wallets have 5 available R and gas");

let evidence: Evidence;
try {
  evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Evidence;
} catch {
  const nextProjectId =
    ((await publicClient.readContract({
      address: protocol,
      abi: protocolAbi,
      functionName: "projectCount",
    })) as bigint) + 1n;
  evidence = {
    schemaVersion: "1.0",
    network: deployment.network,
    chainId: deployment.chainId,
    projectId: nextProjectId.toString(),
    name: NAME,
    metadataURI: METADATA_URI,
    metadataHash,
    targetMON: "30",
    requestedDeadline: "2026-08-10T22:00:00+08:00",
    round1DeadlineUnix: ROUND1_DEADLINE.toString(),
    expectedDurationSeconds: EXPECTED_DURATION.toString(),
    projectWallet: executor.account.address,
    userInitiator: userAddress,
    virtualInitiators: selected.map((item) => item.wallet.account.address),
    transactions: [],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

const projectId = BigInt(evidence.projectId);
const persist = async () => {
  evidence.updatedAt = new Date().toISOString();
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
};
const record = async (label: string, hash: Hash) => {
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
};

let projectCount = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "projectCount",
})) as bigint;
if (projectCount < projectId) {
  if (projectCount + 1n !== projectId) throw new Error(`Unexpected projectCount ${projectCount}`);
  const hash = await selected[0].wallet.writeContract({
    account: selected[0].wallet.account,
    chain,
    address: protocol,
    abi: protocolAbi,
    functionName: "createProjectDraft",
    args: [
      evidence.projectWallet,
      TARGET,
      ROUND1_DEADLINE,
      EXPECTED_DURATION,
      METADATA_URI,
      metadataHash,
    ],
  });
  await record(`项目 #${projectId}：创建“${NAME}”草案`, hash);
  projectCount = projectId;
}
if (projectCount < projectId) throw new Error("Project draft was not created");

const content = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectContent",
  args: [projectId],
})) as readonly [string, Hex, string, Hex, string, Hex];
if (content[0] !== METADATA_URI || content[1].toLowerCase() !== metadataHash.toLowerCase()) {
  throw new Error("Existing project metadata does not match this task");
}

for (const [index, item] of selected.entries()) {
  if (item.mon < parseEther("1")) {
    const gasHash = await executor.sendTransaction({
      account: executor.account,
      chain,
      to: item.wallet.account.address,
      value: parseEther("1") - item.mon,
    });
    await record(`为虚拟共同发起人 ${index + 1} 补充交易 gas`, gasHash);
  }
  const stake = (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "initiatorStake",
    args: [projectId, item.wallet.account.address],
  })) as bigint;
  if (stake === 0n) {
    const hash = await item.wallet.writeContract({
      account: item.wallet.account,
      chain,
      address: protocol,
      abi: protocolAbi,
      functionName: "acceptInitiation",
      args: [projectId, VIRTUAL_STAKE],
      gas: 400_000n,
      maxFeePerGas: 120_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
    });
    await record(`项目 #${projectId}：虚拟共同发起人 ${index + 1} 锁定 5 R`, hash);
  }
}

const [core, times, acceptedCount, totalStake, userStake] = await Promise.all([
  publicClient.readContract({ address: protocol, abi: protocolAbi, functionName: "getProjectCore", args: [projectId] }) as Promise<readonly [Address, Address, number, bigint, bigint, bigint, number, number, boolean, boolean]>,
  publicClient.readContract({ address: protocol, abi: protocolAbi, functionName: "getProjectTimes", args: [projectId] }) as Promise<readonly bigint[]>,
  publicClient.readContract({ address: protocol, abi: protocolAbi, functionName: "acceptedInitiatorCount", args: [projectId] }) as Promise<bigint>,
  publicClient.readContract({ address: protocol, abi: protocolAbi, functionName: "totalInitiatorStake", args: [projectId] }) as Promise<bigint>,
  publicClient.readContract({ address: protocol, abi: protocolAbi, functionName: "initiatorStake", args: [projectId, evidence.userInitiator] }) as Promise<bigint>,
]);
if (core[2] !== 0) throw new Error(`Expected Draft state, received ${core[2]}`);
if (times[0] !== ROUND1_DEADLINE) throw new Error("Round-one deadline mismatch");
if (acceptedCount !== 2n || totalStake !== parseEther("10") || userStake !== 0n) {
  throw new Error("Unexpected initiator state after preparation");
}

evidence.finalState = {
  state: "Draft",
  acceptedInitiators: acceptedCount.toString(),
  requiredInitiators: "3",
  totalStakedR: formatEther(totalStake),
  requiredTotalStakeR: "30",
  userStakeR: formatEther(userStake),
  userRequiredStakeR: "20",
  userAvailableR: formatEther(userAvailableR),
  round1DeadlineUnix: times[0].toString(),
  round1DeadlineAsiaShanghai: "2026-08-10T22:00:00+08:00",
  explorerProjectContract: `${deployment.explorerUrl}/address/${protocol}`,
};
await persist();
console.log(JSON.stringify({ evidencePath, ...evidence, privateKeysExposed: false }, null, 2));
