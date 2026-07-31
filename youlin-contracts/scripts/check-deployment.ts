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
import genesisTreasuryArtifact from "../artifacts/contracts/YoulinGenesisTreasury.sol/YoulinGenesisTreasury.json" with { type: "json" };
import profileRegistryArtifact from "../artifacts/contracts/YoulinProfileRegistry.sol/YoulinProfileRegistry.json" with { type: "json" };

type Deployment = {
  contracts: {
    YoulinProtocol: Address;
    YoulinReputation: Address;
    YoulinParticipation: Address;
    YoulinGenesisTreasury?: Address;
    YoulinProfileRegistry?: Address;
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

const profileRegistry = deployment.contracts.YoulinProfileRegistry;
if (profileRegistry !== undefined) {
  const [nicknameLimit, avatarLimit, bioLimit] = (await Promise.all([
    client.readContract({
      address: profileRegistry,
      abi: profileRegistryArtifact.abi as Abi,
      functionName: "MAX_NICKNAME_BYTES",
    }),
    client.readContract({
      address: profileRegistry,
      abi: profileRegistryArtifact.abi as Abi,
      functionName: "MAX_AVATAR_URI_BYTES",
    }),
    client.readContract({
      address: profileRegistry,
      abi: profileRegistryArtifact.abi as Abi,
      functionName: "MAX_BIO_BYTES",
    }),
  ])) as [bigint, bigint, bigint];
  if (nicknameLimit !== 64n || avatarLimit !== 512n || bioLimit !== 512n) {
    throw new Error("Profile registry field limits mismatch");
  }
  console.log("Profile registry code and 64/512/512-byte limits verified.");
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

const genesisTreasury = deployment.contracts.YoulinGenesisTreasury;
if (genesisTreasury !== undefined) {
  const [
    configuredGenesisReputation,
    configuredGenesisParticipation,
    hasGenesisReputationRole,
    hasGenesisParticipationRole,
    perAddressCap,
    votingDuration,
    passBps,
    minimumVoters,
  ] = (await Promise.all([
    client.readContract({
      address: genesisTreasury,
      abi: genesisTreasuryArtifact.abi as Abi,
      functionName: "reputation",
    }),
    client.readContract({
      address: genesisTreasury,
      abi: genesisTreasuryArtifact.abi as Abi,
      functionName: "participation",
    }),
    client.readContract({
      address: reputation,
      abi: reputationArtifact.abi as Abi,
      functionName: "hasRole",
      args: [reputationRole, genesisTreasury],
    }),
    client.readContract({
      address: participation,
      abi: participationArtifact.abi as Abi,
      functionName: "hasRole",
      args: [participationRole, genesisTreasury],
    }),
    client.readContract({
      address: genesisTreasury,
      abi: genesisTreasuryArtifact.abi as Abi,
      functionName: "perAddressCap",
    }),
    client.readContract({
      address: genesisTreasury,
      abi: genesisTreasuryArtifact.abi as Abi,
      functionName: "votingDuration",
    }),
    client.readContract({
      address: genesisTreasury,
      abi: genesisTreasuryArtifact.abi as Abi,
      functionName: "PASS_BPS",
    }),
    client.readContract({
      address: genesisTreasury,
      abi: genesisTreasuryArtifact.abi as Abi,
      functionName: "MIN_VOTERS",
    }),
  ])) as [Address, Address, boolean, boolean, bigint, bigint, bigint, bigint];

  if (
    configuredGenesisReputation.toLowerCase() !== reputation.toLowerCase() ||
    configuredGenesisParticipation.toLowerCase() !== participation.toLowerCase()
  ) {
    throw new Error("Genesis treasury R/P address mismatch");
  }
  if (!hasGenesisReputationRole || !hasGenesisParticipationRole) {
    throw new Error("Genesis treasury roles are not fully configured");
  }
  if (
    perAddressCap !== 100n * 10n ** 18n ||
    votingDuration !== 600n ||
    passBps !== 6_600n ||
    minimumVoters !== 3n
  ) {
    throw new Error("Genesis treasury governance configuration mismatch");
  }
  console.log(
    "Genesis treasury wiring, roles, 100 R cap, 10-minute voting, 66% threshold and 3-voter minimum verified.",
  );
}
