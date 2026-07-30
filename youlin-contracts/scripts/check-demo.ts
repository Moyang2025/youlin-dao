import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  type Abi,
  type Address,
} from "viem";

import participationArtifact from "../artifacts/contracts/YoulinParticipation.sol/YoulinParticipation.json" with { type: "json" };
import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };
import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Deployment = {
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
    YoulinParticipation: Address;
  };
};
type Demo = {
  projects: Array<{ id: string; expectedState: string }>;
  publicDemoAddresses: { donors: Address[] };
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
const deployment = JSON.parse(
  await readFile(path.join(deployments, "monad-testnet.json"), "utf8"),
) as Deployment;
const demo = JSON.parse(
  await readFile(path.join(deployments, "demo-projects.json"), "utf8"),
) as Demo;
const rpc =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const protocolAbi = protocolArtifact.abi as Abi;
const reputationAbi = reputationArtifact.abi as Abi;
const participationAbi = participationArtifact.abi as Abi;

const projectCount = (await client.readContract({
  address: deployment.contracts.YoulinProtocol,
  abi: protocolAbi,
  functionName: "projectCount",
})) as bigint;
if (projectCount < BigInt(demo.projects.length)) {
  throw new Error(`projectCount ${projectCount} is smaller than demo manifest`);
}

const projects = [];
for (const project of demo.projects) {
  const core = (await client.readContract({
    address: deployment.contracts.YoulinProtocol,
    abi: protocolAbi,
    functionName: "getProjectCore",
    args: [BigInt(project.id)],
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
  const state = stateNames[Number(core[2])];
  if (state !== project.expectedState) {
    throw new Error(
      `Project ${project.id} is ${state}, expected ${project.expectedState}`,
    );
  }
  projects.push({
    id: project.id,
    state,
    targetMON: formatEther(core[3]),
    round1MON: formatEther(core[4]),
    round2MON: formatEther(core[5]),
    midScore: Number(core[6]),
    finalScore: Number(core[7]),
    settled: core[9],
  });
}

const bootstrapClosed = (await client.readContract({
  address: deployment.contracts.YoulinReputation,
  abi: reputationAbi,
  functionName: "bootstrapClosed",
})) as boolean;
if (!bootstrapClosed) throw new Error("Reputation bootstrap is not closed");

const lifecycleId = BigInt(
  demo.projects.find((project) => project.expectedState === "Settled")?.id ??
    "0",
);
if (lifecycleId === 0n) throw new Error("Settled lifecycle project not found");
const donorCredentials = [];
for (const donor of demo.publicDemoAddresses.donors.slice(0, 3)) {
  const [participation, reputation] = await Promise.all([
    client.readContract({
      address: deployment.contracts.YoulinParticipation,
      abi: participationAbi,
      functionName: "balanceOf",
      args: [donor, lifecycleId],
    }) as Promise<bigint>,
    client.readContract({
      address: deployment.contracts.YoulinReputation,
      abi: reputationAbi,
      functionName: "balanceOf",
      args: [donor],
    }) as Promise<bigint>,
  ]);
  if (participation !== 1n) {
    throw new Error(`Donor ${donor} does not hold lifecycle P`);
  }
  donorCredentials.push({
    donor,
    lifecycleP: participation.toString(),
    reputationR: formatEther(reputation),
  });
}

console.log(
  JSON.stringify(
    {
      chainId: 10143,
      projectCount: projectCount.toString(),
      bootstrapClosed,
      projects,
      donorCredentials,
    },
    null,
    2,
  ),
);
