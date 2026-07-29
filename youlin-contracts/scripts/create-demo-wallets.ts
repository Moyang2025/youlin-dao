import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const labels = [
  "initiator-1",
  "initiator-2",
  "initiator-3",
  "donor-1",
  "donor-2",
  "donor-3",
  "donor-4",
  "challenger-1",
  "challenger-2",
  "juror-1",
  "juror-2",
  "juror-3",
] as const;

const deployerKey = generatePrivateKey();
const demoKeys = labels.map(() => generatePrivateKey());
const deployer = privateKeyToAccount(deployerKey);
const demoAccounts = demoKeys.map((key, index) => ({
  label: labels[index],
  address: privateKeyToAccount(key).address,
}));

const env = [
  `PRIVATE_KEY=${deployerKey}`,
  "ETHERSCAN_API_KEY=",
  "MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz",
  `DEMO_PRIVATE_KEYS=${demoKeys.join(",")}`,
  "",
].join("\n");

const deploymentDir = path.join(process.cwd(), "deployments");
await mkdir(deploymentDir, { recursive: true });
await writeFile(path.join(process.cwd(), ".env"), env, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
await writeFile(
  path.join(deploymentDir, "demo-wallets.public.json"),
  `${JSON.stringify(
    {
      network: "Monad Testnet",
      chainId: 10143,
      deployer: deployer.address,
      demoAccounts,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log("Created a gitignored .env with fresh test-only wallets.");
console.log(`Fund only this deployer address with test MON: ${deployer.address}`);
console.log(
  "Demo private keys were not printed. Their public addresses are in deployments/demo-wallets.public.json.",
);
