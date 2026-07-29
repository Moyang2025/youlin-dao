import { network } from "hardhat";
import {
  keccak256,
  parseEther,
  toBytes,
  type GetWalletClientReturnType,
} from "viem";

export const connection = await network.create("hardhat");
export const viem = connection.viem;
export const publicClient = await viem.getPublicClient();
export const testClient = await viem.getTestClient();
export const wallets = await viem.getWalletClients();

export type TestWallet = GetWalletClientReturnType;

export async function deploySystem() {
  const [
    admin,
    initiator1,
    initiator2,
    initiator3,
    donor1,
    donor2,
    donor3,
    donor4,
    challenger1,
    challenger2,
    juror1,
    juror2,
    juror3,
    projectWallet,
  ] = wallets;

  const reputation = await viem.deployContract("YoulinReputation", [
    admin.account.address,
  ]);
  const participation = await viem.deployContract("YoulinParticipation", [
    admin.account.address,
    "ipfs://youlin/{id}.json",
  ]);
  const protocol = await viem.deployContract("YoulinProtocol", [
    admin.account.address,
    reputation.address,
    participation.address,
    60n,
    120n,
    120n,
    180n,
    180n,
    parseEther("1"),
    parseEther("0.5"),
    6_000,
    3,
  ]);

  await reputation.write.grantRole([
    await reputation.read.PROTOCOL_ROLE(),
    protocol.address,
  ]);
  await participation.write.grantRole([
    await participation.read.PROTOCOL_ROLE(),
    protocol.address,
  ]);

  const bootstrapped = [
    initiator1,
    initiator2,
    initiator3,
    donor1,
    donor2,
    donor3,
    donor4,
    challenger1,
    challenger2,
    juror1,
    juror2,
    juror3,
  ];
  await reputation.write.bootstrapMint([
    bootstrapped.map((wallet) => wallet.account.address),
    bootstrapped.map(() => parseEther("100")),
  ]);
  await reputation.write.closeBootstrap();

  return {
    admin,
    initiator1,
    initiator2,
    initiator3,
    initiators: [initiator1, initiator2, initiator3] as const,
    donor1,
    donor2,
    donor3,
    donor4,
    challenger1,
    challenger2,
    juror1,
    juror2,
    juror3,
    projectWallet,
    reputation,
    participation,
    protocol,
  };
}

export type TestSystem = Awaited<ReturnType<typeof deploySystem>>;

export async function createActivatedProject(system: TestSystem) {
  const block = await publicClient.getBlock();
  await system.protocol.write.createProjectDraft(
    [
      system.projectWallet.account.address,
      parseEther("6"),
      block.timestamp + 10_000n,
      1_800n,
      system.initiators.map((wallet) => wallet.account.address),
      "ipfs://youlin/project.json",
      keccak256(toBytes("project")),
    ],
    { account: system.initiator1.account },
  );
  for (const initiator of system.initiators) {
    await system.protocol.write.acceptInitiation(
      [1n, parseEther("2")],
      { account: initiator.account },
    );
  }
  await system.protocol.write.activateProject([1n]);
}

export async function fundRound1(
  system: TestSystem,
  donations: ReadonlyArray<readonly [TestWallet, string]> = [
    [system.donor1, "1"],
    [system.donor2, "1"],
    [system.donor3, "1"],
  ],
) {
  for (const [donor, amount] of donations) {
    await system.protocol.write.donateRound1([1n], {
      account: donor.account,
      value: parseEther(amount),
    });
  }
}

export async function advanceTime(seconds: number) {
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}

export async function advanceAfter(timestamp: bigint) {
  const block = await publicClient.getBlock();
  if (block.timestamp <= timestamp) {
    await advanceTime(Number(timestamp - block.timestamp + 1n));
  }
}

export async function submitMidAndFinalize(
  system: TestSystem,
  scores: ReadonlyArray<readonly [TestWallet, number]>,
) {
  await advanceTime(300);
  await system.protocol.write.submitMidReview(
    [1n, "ipfs://youlin/mid.json", keccak256(toBytes("mid"))],
    { account: system.initiator1.account },
  );
  for (const [scorer, score] of scores) {
    await system.protocol.write.submitMidScore(
      [1n, score],
      { account: scorer.account },
    );
  }
  const times = await system.protocol.read.getProjectTimes([1n]);
  await advanceAfter(times[6]);
  await system.protocol.write.finalizeMidScore([1n]);
}

export async function donateRound2(
  system: TestSystem,
  donations: ReadonlyArray<readonly [TestWallet, string]> = [
    [system.donor4, "1"],
    [system.donor2, "1"],
    [system.donor3, "1"],
  ],
) {
  for (const [donor, amount] of donations) {
    await system.protocol.write.donateRound2([1n], {
      account: donor.account,
      value: parseEther(amount),
    });
  }
}

export async function submitFinalAndFinalize(
  system: TestSystem,
  scores: ReadonlyArray<readonly [TestWallet, number]>,
) {
  await system.protocol.write.submitFinalReview(
    [1n, "ipfs://youlin/final.json", keccak256(toBytes("final"))],
    { account: system.initiator1.account },
  );
  for (const [scorer, score] of scores) {
    await system.protocol.write.submitFinalScore(
      [1n, score],
      { account: scorer.account },
    );
  }
  const times = await system.protocol.read.getProjectTimes([1n]);
  await advanceAfter(times[9]);
  await system.protocol.write.finalizeFinalScore([1n]);
}
