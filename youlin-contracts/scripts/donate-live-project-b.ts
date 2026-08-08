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

import participationArtifact from "../artifacts/contracts/YoulinParticipation.sol/YoulinParticipation.json" with { type: "json" };
import protocolArtifact from "../artifacts/contracts/YoulinProtocol.sol/YoulinProtocol.json" with { type: "json" };

type Deployment = {
  chainId: number;
  network: string;
  contracts: {
    YoulinProtocol: Address;
    YoulinParticipation: Address;
  };
};

type WalletManifest = {
  deployer: Address;
  demoAccounts: Array<{ label: string; address: Address }>;
};

type Evidence = {
  schemaVersion: string;
  network: string;
  chainId: number;
  projectId: string;
  donationPerAccountMON: string;
  accounts: Address[];
  transactions: Array<{
    label: string;
    hash: Hash;
    blockNumber: string;
    confirmedAt: string;
  }>;
  finalState?: unknown;
  updatedAt: string;
};

const PROJECT_ID = 7n;
const DONATION_PER_ACCOUNT = parseEther("1");
const FUNDING_BALANCE = parseEther("1.5");

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;

const splitKeys = (value: string | undefined, count: number) => {
  const keys = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeKey);
  if (keys.length < count) throw new Error(`DEMO_PRIVATE_KEYS must contain ${count} keys`);
  return keys.slice(0, count);
};

const deploymentDir = path.join(process.cwd(), "deployments");
const evidencePath = path.join(deploymentDir, "demo-live-project-b-donations.json");
const deployment = JSON.parse(
  await readFile(path.join(deploymentDir, "monad-testnet.json"), "utf8"),
) as Deployment;
const manifest = JSON.parse(
  await readFile(path.join(deploymentDir, "demo-wallets.public.json"), "utf8"),
) as WalletManifest;

const executorKey = process.env.PRIVATE_KEY?.trim();
if (!executorKey) throw new Error("PRIVATE_KEY is missing");
const donorKeys = splitKeys(process.env.DEMO_PRIVATE_KEYS, 3);
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
const executor = makeWallet(normalizeKey(executorKey));
const donors = donorKeys.map(makeWallet);
const protocol = deployment.contracts.YoulinProtocol;
const participation = deployment.contracts.YoulinParticipation;
const protocolAbi = protocolArtifact.abi as Abi;
const participationAbi = participationArtifact.abi as Abi;

if (executor.account.address.toLowerCase() !== manifest.deployer.toLowerCase()) {
  throw new Error("PRIVATE_KEY does not match the public deployer manifest");
}
for (const [index, donor] of donors.entries()) {
  const expected = manifest.demoAccounts[index]?.address;
  if (!expected || donor.account.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Demo account ${index + 1} does not match its public manifest`);
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
    projectId: PROJECT_ID.toString(),
    donationPerAccountMON: "1",
    accounts: donors.map((wallet) => wallet.account.address),
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

const coreBefore = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectCore",
  args: [PROJECT_ID],
})) as readonly [Address, Address, number, bigint, bigint, bigint, number, number, boolean, boolean];
const times = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectTimes",
  args: [PROJECT_ID],
})) as readonly bigint[];
const block = await publicClient.getBlock();
if (coreBefore[2] !== 1) throw new Error(`Project #7 is not in Round1Funding; state=${coreBefore[2]}`);
if (block.timestamp > times[0]) throw new Error("Project #7 round-one deadline has passed");

for (const [index, donor] of donors.entries()) {
  const donated = (await publicClient.readContract({
    address: protocol,
    abi: protocolAbi,
    functionName: "round1DonationOf",
    args: [PROJECT_ID, donor.account.address],
  })) as bigint;
  if (donated > DONATION_PER_ACCOUNT) {
    throw new Error(`Demo account ${index + 1} has already donated more than 1 MON`);
  }
  const remaining = DONATION_PER_ACCOUNT - donated;
  if (remaining === 0n) continue;

  const balance = await publicClient.getBalance({ address: donor.account.address });
  const requiredBalance = remaining + (FUNDING_BALANCE - DONATION_PER_ACCOUNT);
  if (balance < requiredBalance) {
    const hash = await executor.sendTransaction({
      account: executor.account,
      chain,
      to: donor.account.address,
      value: requiredBalance - balance,
    });
    await record(`为捐款账户 ${index + 1} 补足测试 MON 与 gas`, hash);
  }

  const hash = await donor.writeContract({
    account: donor.account,
    chain,
    address: protocol,
    abi: protocolAbi,
    functionName: "donateRound1",
    args: [PROJECT_ID],
    value: remaining,
    gas: 3_500_000n,
  });
  await record(`捐款账户 ${index + 1} 向项目 #7 捐赠 1 MON`, hash);
}

const coreAfter = (await publicClient.readContract({
  address: protocol,
  abi: protocolAbi,
  functionName: "getProjectCore",
  args: [PROJECT_ID],
})) as readonly [Address, Address, number, bigint, bigint, bigint, number, number, boolean, boolean];
const finalAccounts = [];
for (const donor of donors) {
  const [donated, projectP] = await Promise.all([
    publicClient.readContract({
      address: protocol,
      abi: protocolAbi,
      functionName: "round1DonationOf",
      args: [PROJECT_ID, donor.account.address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: participation,
      abi: participationAbi,
      functionName: "balanceOf",
      args: [donor.account.address, PROJECT_ID],
    }) as Promise<bigint>,
  ]);
  finalAccounts.push({
    address: donor.account.address,
    round1DonationMON: formatEther(donated),
    projectP: projectP.toString(),
  });
}

evidence.finalState = {
  projectId: PROJECT_ID.toString(),
  state: coreAfter[2] === 1 ? "Round1Funding" : coreAfter[2].toString(),
  round1RaisedMON: formatEther(coreAfter[4]),
  round1CapMON: formatEther(coreAfter[3] / 2n),
  accounts: finalAccounts,
};
await persist();

console.log(JSON.stringify({ evidencePath, transactionCount: evidence.transactions.length, finalState: evidence.finalState }, null, 2));
