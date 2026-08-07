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

import participationArtifact from "../artifacts/contracts/YoulinParticipation.sol/YoulinParticipation.json" with { type: "json" };
import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };
import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Deployment = {
  chainId: number;
  network: string;
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
    YoulinParticipation: Address;
  };
};

type PublicWalletManifest = {
  deployer: Address;
  demoAccounts: Array<{ label: string; address: Address }>;
};

type VideoWalletManifest = {
  accounts: Array<{ label: string; address: Address }>;
};

type Evidence = {
  schemaVersion: string;
  network: string;
  chainId: number;
  contracts: Deployment["contracts"];
  accounts: {
    executor: Address;
    projectAInitiators: Address[];
    projectADonorsAndProjectBInitiators: Address[];
  };
  projectA?: {
    id: string;
    name: string;
    metadataURI: string;
    metadataHash: Hex;
  };
  projectB?: {
    id: string;
    name: string;
    metadataURI: string;
    metadataHash: Hex;
  };
  transactions: Array<{
    label: string;
    hash: Hash;
    blockNumber: string;
    timestamp: string;
  }>;
  finalState?: unknown;
  updatedAt: string;
};

const stateNames = [
  "Draft",
  "Round1Funding",
  "Round1Failed",
  "MidSubmissionPending",
  "MidScoring",
  "Round2Funding",
  "FinalSubmissionPending",
  "FinalScoring",
  "ChallengeWindow",
  "DisputeVoting",
  "Settled",
  "ChallengeSucceeded",
  "Cancelled",
] as const;

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;
const splitKeys = (value: string | undefined, label: string, count: number) => {
  const keys = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeKey);
  if (keys.length < count) {
    throw new Error(`${label} must contain at least ${count} private keys`);
  }
  return keys;
};

const deploymentDir = path.join(process.cwd(), "deployments");
const evidencePath = path.join(deploymentDir, "demo-video-lifecycle.json");
const deployment = JSON.parse(
  await readFile(path.join(deploymentDir, "monad-testnet.json"), "utf8"),
) as Deployment;
const publicWallets = JSON.parse(
  await readFile(path.join(deploymentDir, "demo-wallets.public.json"), "utf8"),
) as PublicWalletManifest;
const videoWallets = JSON.parse(
  await readFile(
    path.join(deploymentDir, "demo-video-wallets.public.json"),
    "utf8",
  ),
) as VideoWalletManifest;

const deployerKey = process.env.PRIVATE_KEY?.trim();
if (!deployerKey) throw new Error("PRIVATE_KEY is missing");
const oldKeys = splitKeys(process.env.DEMO_PRIVATE_KEYS, "DEMO_PRIVATE_KEYS", 3);
const videoKeys = splitKeys(
  process.env.DEMO_VIDEO_PRIVATE_KEYS,
  "DEMO_VIDEO_PRIVATE_KEYS",
  3,
);

const rpc =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
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
const executor = makeWallet(normalizeKey(deployerKey));
const initiators = oldKeys.slice(0, 3).map(makeWallet);
const donors = videoKeys.slice(0, 3).map(makeWallet);

if (executor.account.address.toLowerCase() !== publicWallets.deployer.toLowerCase()) {
  throw new Error("PRIVATE_KEY does not match the public deployer manifest");
}
for (const [index, wallet] of initiators.entries()) {
  const expected = publicWallets.demoAccounts[index]?.address;
  if (!expected || wallet.account.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Existing initiator ${index + 1} does not match its public manifest`);
  }
}
for (const [index, wallet] of donors.entries()) {
  const expected = videoWallets.accounts[index]?.address;
  if (!expected || wallet.account.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Video donor ${index + 1} does not match its public manifest`);
  }
}

const protocol = deployment.contracts.YoulinProtocol;
const reputation = deployment.contracts.YoulinReputation;
const participation = deployment.contracts.YoulinParticipation;
const protocolAbi = protocolArtifact.abi as Abi;
const reputationAbi = reputationArtifact.abi as Abi;
const participationAbi = participationArtifact.abi as Abi;

let evidence: Evidence;
try {
  evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Evidence;
} catch {
  evidence = {
    schemaVersion: "1.0",
    network: deployment.network,
    chainId: deployment.chainId,
    contracts: deployment.contracts,
    accounts: {
      executor: executor.account.address,
      projectAInitiators: initiators.map((wallet) => wallet.account.address),
      projectADonorsAndProjectBInitiators: donors.map(
        (wallet) => wallet.account.address,
      ),
    },
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
      timestamp: new Date().toISOString(),
    });
    await persist();
  }
  console.log(`${label}: ${hash}`);
}

type Wallet = ReturnType<typeof makeWallet>;
async function sendContract(
  wallet: Wallet,
  label: string,
  functionName: string,
  args: readonly unknown[] = [],
  value?: bigint,
) {
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain,
    address: protocol,
    abi: protocolAbi,
    functionName,
    args,
    value,
  });
  await record(label, hash);
  return hash;
}

async function waitUntil(timestamp: bigint, label: string) {
  let lastNotice = 0;
  while (true) {
    const block = await publicClient.getBlock();
    if (block.timestamp > timestamp) return;
    const now = Date.now();
    if (now - lastNotice >= 25_000) {
      console.log(`${label}: ${timestamp - block.timestamp + 1n}s remaining`);
      lastNotice = now;
    }
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

async function hashFrontendFile(fileName: string) {
  const filePath = path.join(
    process.cwd(),
    "..",
    "..",
    "youlin-interface",
    "public",
    "demo",
    "metadata",
    fileName,
  );
  const content = await readFile(filePath, "utf8");
  return keccak256(toBytes(content));
}

const baseURI =
  "https://youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site/demo/metadata/";

async function projectCount() {
  return (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "projectCount",
  })) as bigint;
}

async function core(projectId: bigint) {
  return (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "getProjectCore",
    args: [projectId],
  })) as readonly [
    Address,
    Address,
    number,
    bigint,
    bigint,
    bigint,
    number,
    number,
    boolean,
    boolean,
  ];
}

async function times(projectId: bigint) {
  return (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "getProjectTimes",
    args: [projectId],
  })) as readonly bigint[];
}

async function ensureDonorFunding() {
  const targetBalance = parseEther("10.3");
  for (const [index, donor] of donors.entries()) {
    const balance = await publicClient.getBalance({ address: donor.account.address });
    if (balance >= targetBalance) continue;
    const hash = await executor.sendTransaction({
      account: executor.account,
      chain,
      to: donor.account.address,
      value: targetBalance - balance,
    });
    await record(`为视频捐款账户 ${index + 1} 分配测试 MON`, hash);
  }
}

async function preflight() {
  for (const [index, initiator] of initiators.entries()) {
    const available = (await publicClient.readContract({
      address: reputation,
      abi: reputationAbi,
      functionName: "availableBalanceOf",
      args: [initiator.account.address],
    })) as bigint;
    if (available < parseEther("10")) {
      throw new Error(`Initiator ${index + 1} has insufficient available R`);
    }
  }
  if (!evidence.projectA) {
    for (const [index, donor] of donors.entries()) {
      const balance = (await publicClient.readContract({
        address: reputation,
        abi: reputationAbi,
        functionName: "balanceOf",
        args: [donor.account.address],
      })) as bigint;
      if (balance !== 0n) {
        throw new Error(`Fresh donor ${index + 1} does not start at zero R`);
      }
    }
  }
  await ensureDonorFunding();
}

async function ensureProjectA() {
  const metadataURI = `${baseURI}video-project-a.json`;
  const metadataHash = await hashFrontendFile("video-project-a.json");
  if (!evidence.projectA) {
    evidence.projectA = {
      id: ((await projectCount()) + 1n).toString(),
      name: "乡村校园安全饮水计划",
      metadataURI,
      metadataHash,
    };
    await persist();
  }
  const id = BigInt(evidence.projectA.id);
  if ((await projectCount()) < id) {
    const block = await publicClient.getBlock();
    await sendContract(initiators[0], "项目 A：创建草案", "createProjectDraft", [
      executor.account.address,
      parseEther("30"),
      block.timestamp + 3_600n,
      600n,
      initiators.map((wallet) => wallet.account.address),
      metadataURI,
      metadataHash,
    ]);
  }
  return id;
}

async function runProjectA(id: bigint) {
  let project = await core(id);
  if (project[2] === 0) {
    for (const [index, initiator] of initiators.entries()) {
      const accepted = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "isInitiator",
        args: [id, initiator.account.address],
      })) as boolean;
      if (!accepted) {
        await sendContract(
          initiator,
          `项目 A：发起人 ${index + 1} 锁定 10 R`,
          "acceptInitiation",
          [id, parseEther("10")],
        );
      }
    }
    await sendContract(executor, "项目 A：达到共同发起门槛并激活", "activateProject", [id]);
    project = await core(id);
  }

  if (project[2] === 1) {
    for (const [index, donor] of donors.entries()) {
      const donated = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "round1DonationOf",
        args: [id, donor.account.address],
      })) as bigint;
      const desired = parseEther("5");
      if (donated < desired) {
        await sendContract(
          donor,
          `项目 A：首轮捐款账户 ${index + 1}`,
          "donateRound1",
          [id],
          desired - donated,
        );
      }
    }
    project = await core(id);
  }

  if (project[2] >= 3) {
    for (const [index, donor] of donors.entries()) {
      const claimed = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "round1ReputationClaimed",
        args: [id, donor.account.address],
      })) as boolean;
      if (!claimed) {
        await sendContract(
          donor,
          `项目 A：捐款账户 ${index + 1} 领取首轮 R`,
          "claimRound1DonationReputation",
          [id],
        );
      }
    }
    project = await core(id);
    if (!project[8]) {
      await sendContract(initiators[0], "项目 A：领取第一阶段资金", "claimRound1Funds", [id]);
    }
  }

  project = await core(id);
  if (project[2] === 3) {
    const projectTimes = await times(id);
    await waitUntil(projectTimes[3] + 220n, "等待链上中期提交时点");
    const evidenceURI = `${baseURI}video-project-a-mid.json`;
    const evidenceHash = await hashFrontendFile("video-project-a-mid.json");
    await sendContract(initiators[0], "项目 A：提交中期材料", "submitMidReview", [
      id,
      evidenceURI,
      evidenceHash,
    ]);
    project = await core(id);
  }

  if (project[2] === 4) {
    for (const [index, donor] of donors.entries()) {
      const submitted = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "hasSubmittedMidScore",
        args: [id, donor.account.address],
      })) as boolean;
      if (!submitted) {
        await sendContract(
          donor,
          `项目 A：中期评分账户 ${index + 1}`,
          "submitMidScore",
          [id, 8],
        );
      }
    }
    const projectTimes = await times(id);
    await waitUntil(projectTimes[6], "等待中期评分窗口结束");
    await sendContract(executor, "项目 A：链上定分并开放第二轮", "finalizeMidScore", [id]);
    project = await core(id);
  }

  if (project[2] === 5) {
    for (const [index, donor] of donors.entries()) {
      const donated = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "round2DonationOf",
        args: [id, donor.account.address],
      })) as bigint;
      const desired = parseEther("5");
      if (donated < desired) {
        await sendContract(
          donor,
          `项目 A：第二轮捐款账户 ${index + 1}`,
          "donateRound2",
          [id],
          desired - donated,
        );
      }
    }
    project = await core(id);
  }

  if (project[2] === 5 || project[2] === 6) {
    const content = (await publicClient.readContract({
      address: protocol,
      abi: protocolAbi,
      functionName: "getProjectContent",
      args: [id],
    })) as readonly [string, Hex, string, Hex, string, Hex];
    if (!content[4]) {
      const evidenceURI = `${baseURI}video-project-a-final.json`;
      const evidenceHash = await hashFrontendFile("video-project-a-final.json");
      await sendContract(initiators[0], "项目 A：提交结项材料", "submitFinalReview", [
        id,
        evidenceURI,
        evidenceHash,
      ]);
    }
    project = await core(id);
  }

  if (project[2] === 7) {
    for (const [index, donor] of donors.entries()) {
      const submitted = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "hasSubmittedFinalScore",
        args: [id, donor.account.address],
      })) as boolean;
      if (!submitted) {
        await sendContract(
          donor,
          `项目 A：结项评分账户 ${index + 1}`,
          "submitFinalScore",
          [id, 9],
        );
      }
    }
    const projectTimes = await times(id);
    await waitUntil(projectTimes[9], "等待结项评分窗口结束");
    await sendContract(executor, "项目 A：链上确定结项分", "finalizeFinalScore", [id]);
    project = await core(id);
  }

  if (project[2] === 8) {
    const projectTimes = await times(id);
    await waitUntil(projectTimes[10], "等待无挑战结算窗口结束");
    await sendContract(executor, "项目 A：无挑战最终结算", "settleWithoutChallenge", [id]);
    project = await core(id);
  }

  if (project[2] !== 10 || !project[9]) {
    throw new Error(`Project A ended in unexpected state ${stateNames[project[2]]}`);
  }
}

async function ensureProjectB() {
  const metadataURI = `${baseURI}video-project-b.json`;
  const metadataHash = await hashFrontendFile("video-project-b.json");
  if (!evidence.projectB) {
    evidence.projectB = {
      id: ((await projectCount()) + 1n).toString(),
      name: "偏远地区青少年编程启蒙工作",
      metadataURI,
      metadataHash,
    };
    await persist();
  }
  const id = BigInt(evidence.projectB.id);
  if ((await projectCount()) < id) {
    const block = await publicClient.getBlock();
    await sendContract(donors[0], "项目 B：由 A 的捐款者创建草案", "createProjectDraft", [
      executor.account.address,
      parseEther("30"),
      block.timestamp + 3_600n,
      600n,
      donors.map((wallet) => wallet.account.address),
      metadataURI,
      metadataHash,
    ]);
  }
  return id;
}

async function runProjectB(id: bigint) {
  let project = await core(id);
  if (project[2] === 0) {
    for (const [index, donor] of donors.entries()) {
      const accepted = (await publicClient.readContract({
        address: protocol,
        abi: protocolAbi,
        functionName: "isInitiator",
        args: [id, donor.account.address],
      })) as boolean;
      if (!accepted) {
        await sendContract(
          donor,
          `项目 B：原项目 A 捐款者 ${index + 1} 锁定 10 R`,
          "acceptInitiation",
          [id, parseEther("10")],
        );
      }
    }
    await sendContract(executor, "项目 B：达到共同发起门槛并激活", "activateProject", [id]);
    project = await core(id);
  }
  if (project[2] !== 1) {
    throw new Error(`Project B ended in unexpected state ${stateNames[project[2]]}`);
  }
}

async function buildFinalState(projectAId: bigint, projectBId: bigint) {
  const projectACore = await core(projectAId);
  const projectBCore = await core(projectBId);
  const donorState = [];
  for (const donor of donors) {
    const [r, availableR, projectAP, round1, round2, projectBStake] =
      await Promise.all([
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
          address: participation,
          abi: participationAbi,
          functionName: "balanceOf",
          args: [donor.account.address, projectAId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: protocol,
          abi: protocolAbi,
          functionName: "round1DonationOf",
          args: [projectAId, donor.account.address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: protocol,
          abi: protocolAbi,
          functionName: "round2DonationOf",
          args: [projectAId, donor.account.address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: protocol,
          abi: protocolAbi,
          functionName: "initiatorStake",
          args: [projectBId, donor.account.address],
        }) as Promise<bigint>,
      ]);
    donorState.push({
      address: donor.account.address,
      projectAP: projectAP.toString(),
      round1DonationMON: formatEther(round1),
      round2DonationMON: formatEther(round2),
      totalR: formatEther(r),
      availableR: formatEther(availableR),
      projectBStakeR: formatEther(projectBStake),
    });
  }
  evidence.finalState = {
    projectA: {
      id: projectAId.toString(),
      state: stateNames[projectACore[2]],
      targetMON: formatEther(projectACore[3]),
      round1MON: formatEther(projectACore[4]),
      round2MON: formatEther(projectACore[5]),
      midScore: Number(projectACore[6]),
      finalScore: Number(projectACore[7]),
      settled: projectACore[9],
    },
    projectB: {
      id: projectBId.toString(),
      state: stateNames[projectBCore[2]],
      targetMON: formatEther(projectBCore[3]),
      totalInitiatorStakeR: formatEther(
        (await publicClient.readContract({
          address: protocol,
          abi: protocolAbi,
          functionName: "totalInitiatorStake",
          args: [projectBId],
        })) as bigint,
      ),
    },
    donors: donorState,
  };
  await persist();
}

await preflight();
const projectAId = await ensureProjectA();
await runProjectA(projectAId);
const projectBId = await ensureProjectB();
await runProjectB(projectBId);
await buildFinalState(projectAId, projectBId);

console.log(
  JSON.stringify(
    {
      success: true,
      evidencePath,
      projectAId: projectAId.toString(),
      projectBId: projectBId.toString(),
      transactionCount: evidence.transactions.length,
      finalState: evidence.finalState,
    },
    null,
    2,
  ),
);
