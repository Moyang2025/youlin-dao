import "dotenv/config";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const labels = ["video-donor-1", "video-donor-2", "video-donor-3"] as const;
const envPath = path.join(process.cwd(), ".env");
const deploymentDir = path.join(process.cwd(), "deployments");
const manifestPath = path.join(deploymentDir, "demo-video-wallets.public.json");

const normalizeKey = (value: string): Hex =>
  (value.startsWith("0x") ? value : `0x${value}`) as Hex;

const envText = await readFile(envPath, "utf8");
const existingLine = envText
  .split(/\r?\n/)
  .find((line) => line.startsWith("DEMO_VIDEO_PRIVATE_KEYS="));

let keys: Hex[];
if (existingLine) {
  keys = existingLine
    .slice("DEMO_VIDEO_PRIVATE_KEYS=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeKey);
  if (keys.length !== labels.length) {
    throw new Error(
      `DEMO_VIDEO_PRIVATE_KEYS must contain exactly ${labels.length} keys`,
    );
  }
} else {
  keys = labels.map(() => generatePrivateKey());
  const prefix = envText.endsWith("\n") ? "" : "\n";
  await appendFile(
    envPath,
    `${prefix}DEMO_VIDEO_PRIVATE_KEYS=${keys.join(",")}\n`,
    "utf8",
  );
}

const accounts = keys.map((key, index) => ({
  label: labels[index],
  address: privateKeyToAccount(key).address as Address,
}));

await mkdir(deploymentDir, { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      network: "Monad Testnet",
      chainId: 10143,
      purpose: "A donors, scorers, and B initiators for the hackathon video",
      accounts,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  existingLine
    ? "Reused the existing gitignored video demo keys."
    : "Created fresh gitignored video demo keys.",
);
console.log(`Public addresses saved to ${manifestPath}.`);
console.log("No private key was printed.");
