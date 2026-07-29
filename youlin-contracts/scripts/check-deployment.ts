import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  http,
  isAddress,
  type Abi,
  type Address,
} from "viem";

import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };
import participationArtifact from "../artifacts/contracts/YoulinParticipation.sol/YoulinParticipation.json" with { type: "json" };
import reputationArtifact from "../artifacts/contracts/YoulinReputation.sol/YoulinReputation.json" with { type: "json" };

type Deployment = {
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
    YoulinParticipation: Address;
  };
};

const deployment = JSON.parse(
  await readFile(
    path.join(process.cwd(), "deployments", "monad-testnet.json"),
    "utf8",
  ),
) as Deployment;
const rpc =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const client = createPublicClient({ transport: http(rpc) });

for (const [name, address] of Object.entries(deployment.contracts)) {
  if (!isAddress(address)) throw new Error(`${name} has an invalid address`);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`${name} has no deployed code`);
  console.log(`${name}: code present at ${address}`);
}

const protocol = deployment.contracts.YoulinProtocol;
const reputation = deployment.contracts.YoulinReputation;
const participation = deployment.contracts.YoulinParticipation;
const [configuredReputation, configuredParticipation, reputationRole, participationRole] =
  (await Promise.all([
    client.readContract({
      address: protocol,
      abi: protocolArtifact.abi as Abi,
      functionName: "reputation",
    }),
    client.readContract({
      address: protocol,
      abi: protocolArtifact.abi as Abi,
      functionName: "participation",
    }),
    client.readContract({
      address: reputation,
      abi: reputationArtifact.abi as Abi,
      functionName: "PROTOCOL_ROLE",
    }),
    client.readContract({
      address: participation,
      abi: participationArtifact.abi as Abi,
      functionName: "PROTOCOL_ROLE",
    }),
  ])) as [Address, Address, `0x${string}`, `0x${string}`];

if (configuredReputation.toLowerCase() !== reputation.toLowerCase()) {
  throw new Error("Protocol reputation address mismatch");
}
if (configuredParticipation.toLowerCase() !== participation.toLowerCase()) {
  throw new Error("Protocol participation address mismatch");
}
const [hasReputationRole, hasParticipationRole] = (await Promise.all([
  client.readContract({
    address: reputation,
    abi: reputationArtifact.abi as Abi,
    functionName: "hasRole",
    args: [reputationRole, protocol],
  }),
  client.readContract({
    address: participation,
    abi: participationArtifact.abi as Abi,
    functionName: "hasRole",
    args: [participationRole, protocol],
  }),
])) as [boolean, boolean];

if (!hasReputationRole || !hasParticipationRole) {
  throw new Error("Protocol roles are not fully configured");
}
console.log("Deployment wiring and protocol roles verified.");
