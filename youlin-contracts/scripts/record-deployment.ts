import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type IgnitionAddresses = Record<string, string>;

const root = process.cwd();
const ignitionPath = path.join(
  root,
  "ignition",
  "deployments",
  "chain-10143",
  "deployed_addresses.json",
);
const addresses = JSON.parse(
  await readFile(ignitionPath, "utf8"),
) as IgnitionAddresses;

const get = (name: string) => {
  const value = addresses[`YoulinModule#${name}`];
  if (!value) throw new Error(`Missing Ignition address for ${name}`);
  return value;
};

const record = {
  chainId: 10143,
  network: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadscan.com",
  deployedAt: new Date().toISOString(),
  demoTimeScale: {
    minExpectedDurationSeconds: 60,
    midVotingDurationSeconds: 120,
    finalVotingDurationSeconds: 120,
    challengeDurationSeconds: 180,
    disputeVotingDurationSeconds: 180,
  },
  contracts: {
    YoulinProtocol: get("YoulinProtocol"),
    YoulinReputation: get("YoulinReputation"),
    YoulinParticipation: get("YoulinParticipation"),
  },
  verification: {
    YoulinProtocol: "pending",
    YoulinReputation: "pending",
    YoulinParticipation: "pending",
  },
  bootstrap: {
    closed: false,
    transactionHash: null,
  },
  ignitionDeploymentDirectory: "ignition/deployments/chain-10143",
};

const deploymentsDirectory = path.join(root, "deployments");
await mkdir(deploymentsDirectory, { recursive: true });
const output = path.join(deploymentsDirectory, "monad-testnet.json");
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`Recorded Monad Testnet deployment at ${output}`);
