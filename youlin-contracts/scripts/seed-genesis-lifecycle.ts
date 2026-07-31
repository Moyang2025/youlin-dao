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

import genesisArtifact from "../artifacts/contracts/YoulinGenesisTreasury.sol/YoulinGenesisTreasury.json" with { type: "json" };

type Deployment = {
  contracts: {
    YoulinGenesisTreasury: Address;
  };
};

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;
const deployerKey = process.env.PRIVATE_KEY?.trim();
const demoKeys = (process.env.DEMO_PRIVATE_KEYS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!deployerKey) throw new Error("PRIVATE_KEY is missing from the local .env");
if (demoKeys.length < 6) {
  throw new Error("DEMO_PRIVATE_KEYS must contain at least six test keys");
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
const admin = makeWallet(deployerKey);
const donors = demoKeys.slice(3, 6).map(makeWallet);
const recipient = privateKeyToAccount(normalizeKey(demoKeys[9])).address;
const treasury = deployment.contracts.YoulinGenesisTreasury;
const abi = genesisArtifact.abi as Abi;
const transactions: Array<{ label: string; hash: Hash }> = [];

async function send(
  wallet: DemoWallet,
  label: string,
  functionName: string,
  args: readonly unknown[] = [],
  value?: bigint,
) {
  const hash = await wallet.writeContract({
    address: treasury,
    abi,
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

async function waitUntil(timestamp: bigint) {
  let lastNotice = 0;
  while (true) {
    const block = await publicClient.getBlock();
    if (block.timestamp > timestamp) return;
    const now = Date.now();
    if (now - lastNotice > 20_000) {
      console.log(
        `Waiting for genesis vote to close: ${timestamp - block.timestamp + 1n}s`,
      );
      lastNotice = now;
    }
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

let shortened = false;
try {
  await send(admin, "Temporarily set demo voting duration to 60 seconds", "setVotingDuration", [
    60,
  ]);
  shortened = true;

  for (const [index, donor] of donors.entries()) {
    await send(
      donor,
      `Genesis donation ${index + 1}`,
      "donate",
      [],
      parseEther("0.01"),
    );
  }

  const proposalId =
    ((await publicClient.readContract({
      address: treasury,
      abi,
      functionName: "proposalCount",
    })) as bigint) + 1n;
  const metadata = JSON.stringify({
    title: "创世金库首笔社区治理演示支出",
    purpose: "验证三名真实捐赠者、对数加权投票、66% 门槛与链上执行闭环。",
    recipient,
    amountMON: "0.005",
  });
  const metadataURI = `data:application/json;charset=utf-8,${encodeURIComponent(
    metadata,
  )}`;
  const metadataHash = keccak256(toBytes(metadata));

  await send(donors[0], "Create genesis treasury demo proposal", "createProposal", [
    recipient,
    parseEther("0.005"),
    metadataURI,
    metadataHash,
  ]);
  for (const [index, donor] of donors.entries()) {
    await send(donor, `Genesis support vote ${index + 1}`, "vote", [
      proposalId,
      true,
    ]);
  }

  const proposal = (await publicClient.readContract({
    address: treasury,
    abi,
    functionName: "getProposal",
    args: [proposalId],
  })) as readonly unknown[];
  await waitUntil(proposal[4] as bigint);
  await send(donors[2], "Finalize genesis proposal", "finalizeProposal", [
    proposalId,
  ]);

  const recipientBalanceBefore = await publicClient.getBalance({
    address: recipient,
  });
  await send(donors[1], "Execute genesis proposal", "executeProposal", [
    proposalId,
  ]);
  const recipientBalanceAfter = await publicClient.getBalance({
    address: recipient,
  });
  if (recipientBalanceAfter - recipientBalanceBefore !== parseEther("0.005")) {
    throw new Error("Genesis proposal recipient did not receive exactly 0.005 MON");
  }

  const output = {
    chainId: 10143,
    treasury,
    generatedAt: new Date().toISOString(),
    rule:
      "At least 3 actual voters; support >= 66% of cast log weights; abstention is neutral.",
    weightFormula: "ln(1 + cumulative donation in MON) at proposal snapshot",
    donors: donors.map((wallet) => wallet.account.address),
    donationPerDonorMON: "0.01",
    proposal: {
      id: proposalId.toString(),
      recipient,
      amountMON: "0.005",
      metadataURI,
      metadataHash,
      result: "passed-and-executed",
    },
    transactions,
  };
  await mkdir(path.join(process.cwd(), "deployments"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "deployments", "genesis-demo.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  console.log("Genesis donation and treasury governance lifecycle completed.");
} finally {
  if (shortened) {
    await send(
      admin,
      "Restore live voting duration to 600 seconds",
      "setVotingDuration",
      [600],
    );
  }
}
