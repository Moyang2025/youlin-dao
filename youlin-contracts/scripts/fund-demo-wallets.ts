import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type PublicWallets = {
  deployer: Address;
  demoAccounts: Array<{ label: string; address: Address }>;
};

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;
const deployerKey = process.env.PRIVATE_KEY?.trim();
if (!deployerKey) {
  throw new Error("PRIVATE_KEY is missing from the local .env");
}

const target = parseEther(process.env.DEMO_WALLET_TARGET_MON ?? "0.1");
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
const account = privateKeyToAccount(normalizeKey(deployerKey));
const walletClient = createWalletClient({ account, chain, transport });
const publicWallets = JSON.parse(
  await readFile(
    path.join(process.cwd(), "deployments", "demo-wallets.public.json"),
    "utf8",
  ),
) as PublicWallets;

if (publicWallets.deployer.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error("The public wallet manifest does not match PRIVATE_KEY");
}

const deficits: Array<{ label: string; address: Address; value: bigint }> = [];
for (const demo of publicWallets.demoAccounts) {
  const balance = await publicClient.getBalance({ address: demo.address });
  if (balance < target) {
    deficits.push({ ...demo, value: target - balance });
  }
}

const totalRequired = deficits.reduce((sum, item) => sum + item.value, 0n);
const deployerBalance = await publicClient.getBalance({
  address: account.address,
});
const gasReserve = parseEther("0.5");
if (deployerBalance < totalRequired + gasReserve) {
  throw new Error(
    `Deployer has ${formatEther(deployerBalance)} MON; at least ${formatEther(
      totalRequired + gasReserve,
    )} MON is required for demo funding plus the deployment reserve`,
  );
}

for (const deficit of deficits) {
  const hash = await walletClient.sendTransaction({
    account,
    chain,
    to: deficit.address,
    value: deficit.value,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(
    `${deficit.label} funded to ${formatEther(target)} MON: ${hash}`,
  );
}

console.log(
  deficits.length === 0
    ? "All demo wallets already meet the target balance."
    : `Funded ${deficits.length} demo wallets without exposing private keys.`,
);
