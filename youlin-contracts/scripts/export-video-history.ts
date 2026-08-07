import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  formatEther,
  http,
  type Abi,
  type Address,
  type Hash,
} from "viem";

import participationArtifact from "../artifacts/contracts/YoulinParticipation.sol/YoulinParticipation.json" with { type: "json" };
import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };
import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Lifecycle = {
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
    YoulinParticipation: Address;
  };
  accounts: {
    projectAInitiators: Address[];
    projectADonorsAndProjectBInitiators: Address[];
  };
  projectA: { id: string };
  projectB: { id: string };
  transactions: Array<{ label: string; hash: Hash; blockNumber: string }>;
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

const deployments = path.join(process.cwd(), "deployments");
const lifecycle = JSON.parse(
  await readFile(path.join(deployments, "demo-video-lifecycle.json"), "utf8"),
) as Lifecycle;
const client = createPublicClient({
  transport: http(
    process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz",
    { retryCount: 4 },
  ),
});
const protocolAbi = protocolArtifact.abi as Abi;
const reputationAbi = reputationArtifact.abi as Abi;
const participationAbi = participationArtifact.abi as Abi;
const projectAId = BigInt(lifecycle.projectA.id);
const RPC_DELAY_MS = 180;

const pause = () => new Promise((resolve) => setTimeout(resolve, RPC_DELAY_MS));

async function throttledRead<T>(request: Parameters<typeof client.readContract>[0]) {
  const result = await client.readContract(request);
  await pause();
  return result as T;
}

const checkpoints = [
  { key: "draft", match: "项目 A：创建草案" },
  { key: "activated", match: "项目 A：达到共同发起门槛并激活" },
  { key: "round1", match: "项目 A：首轮捐款账户 3" },
  { key: "midSubmitted", match: "项目 A：中期评分账户 3" },
  { key: "midFinalized", match: "项目 A：链上定分并开放第二轮" },
  { key: "round2", match: "项目 A：第二轮捐款账户 3" },
  { key: "finalSubmitted", match: "项目 A：结项评分账户 3" },
  { key: "finalFinalized", match: "项目 A：链上确定结项分" },
  { key: "settled", match: "项目 A：无挑战最终结算" },
  { key: "projectBActivated", match: "项目 B：达到共同发起门槛并激活" },
] as const;

async function readAt(functionName: string, args: readonly unknown[], blockNumber: bigint) {
  return throttledRead({
    address: lifecycle.contracts.YoulinProtocol,
    abi: protocolAbi,
    functionName,
    args,
    blockNumber,
  });
}

const snapshots = [];
for (const checkpoint of checkpoints) {
  const tx = lifecycle.transactions.find((item) => item.label === checkpoint.match);
  if (!tx) throw new Error(`Missing transaction ${checkpoint.match}`);
  const blockNumber = BigInt(tx.blockNumber);
  const id = checkpoint.key === "projectBActivated"
    ? BigInt(lifecycle.projectB.id)
    : projectAId;
  const core = (await readAt("getProjectCore", [id], blockNumber)) as readonly [
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
  const donorState = [];
  for (const donor of lifecycle.accounts.projectADonorsAndProjectBInitiators) {
    const r = await throttledRead<bigint>({
        address: lifecycle.contracts.YoulinReputation,
        abi: reputationAbi,
        functionName: "balanceOf",
        args: [donor],
        blockNumber,
      });
    const availableR = await throttledRead<bigint>({
        address: lifecycle.contracts.YoulinReputation,
        abi: reputationAbi,
        functionName: "availableBalanceOf",
        args: [donor],
        blockNumber,
      });
    const projectAP = await throttledRead<bigint>({
        address: lifecycle.contracts.YoulinParticipation,
        abi: participationAbi,
        functionName: "balanceOf",
        args: [donor, projectAId],
        blockNumber,
      });
    const round1 = await readAt("round1DonationOf", [projectAId, donor], blockNumber) as bigint;
    const round2 = await readAt("round2DonationOf", [projectAId, donor], blockNumber) as bigint;
    donorState.push({
      address: donor,
      r: formatEther(r),
      availableR: formatEther(availableR),
      projectAP: projectAP.toString(),
      round1MON: formatEther(round1),
      round2MON: formatEther(round2),
    });
  }
  snapshots.push({
    key: checkpoint.key,
    label: checkpoint.match,
    transactionHash: tx.hash,
    blockNumber: tx.blockNumber,
    projectId: id.toString(),
    state: stateNames[core[2]],
    targetMON: formatEther(core[3]),
    round1MON: formatEther(core[4]),
    round2MON: formatEther(core[5]),
    midScore: Number(core[6]),
    finalScore: Number(core[7]),
    settled: core[9],
    donors: donorState,
  });
}

const output = {
  schemaVersion: "1.0",
  source: "Historical eth_call snapshots at confirmed Monad Testnet blocks",
  generatedAt: new Date().toISOString(),
  snapshots,
};
const outputPath = path.join(deployments, "demo-video-history.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Saved ${snapshots.length} historical snapshots to ${outputPath}`);
