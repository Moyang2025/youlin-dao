import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keccak256, parseEther, toBytes } from "viem";
import {
  advanceAfter,
  createActivatedProject,
  deploySystem,
  donateRound2,
  fundRound1,
  publicClient,
  submitFinalAndFinalize,
  submitMidAndFinalize,
} from "./helpers.js";

describe("YoulinProtocol complete lifecycle flows", function () {
  it("flow 1: round-one failure -> permissionless failure -> pull refund", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await system.protocol.write.donateRound1([1n], {
      account: system.donor1.account,
      value: parseEther("1"),
    });
    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[0]);
    await system.protocol.write.markRound1Failed([1n], {
      account: system.donor4.account,
    });
    await system.protocol.write.refundRound1([1n], {
      account: system.donor1.account,
    });
    assert.equal(
      await publicClient.getBalance({ address: system.protocol.address }),
      0n,
    );
    assert.equal((await system.protocol.read.getProjectCore([1n]))[2], 2);
  });

  it("flow 2: mid failure -> no round two -> final failure -> total stake burn", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 5]]);
    assert.equal((await system.protocol.read.getProjectCore([1n]))[2], 6);
    await submitFinalAndFinalize(system, [[system.donor1, 5]]);
    const core = await system.protocol.read.getProjectCore([1n]);
    assert.equal(core[2], 10);
    assert.equal(core[7], 50);
    assert.equal(await system.reputation.read.totalSupply(), parseEther("1194.2"));
  });

  it("flow 3: mid pass -> round two direct -> high score -> no-challenge bonus", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await system.protocol.write.claimRound1DonationReputation([1n], {
      account: system.donor1.account,
    });
    await system.protocol.write.claimRound1Funds([1n], {
      account: system.initiator1.account,
    });
    await submitMidAndFinalize(system, [[system.donor1, 8]]);
    await donateRound2(system, [[system.donor4, "3"]]);
    await submitFinalAndFinalize(system, [
      [system.donor1, 9],
      [system.donor4, 9],
    ]);
    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[10]);
    await system.protocol.write.settleWithoutChallenge([1n]);

    assert.equal((await system.protocol.read.getProjectCore([1n]))[2], 10);
    assert.equal(
      await system.reputation.read.balanceOf([system.initiator1.account.address]),
      parseEther("100.25"),
    );
    assert.equal(
      await system.participation.read.hasCredential([
        system.donor4.account.address,
        1n,
      ]),
      true,
    );
  });

  it("flow 4: passing project -> challenge -> three-juror success -> challenger claim", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);
    await submitFinalAndFinalize(system, [[system.donor1, 8]]);
    await system.protocol.write.supportChallenge(
      [
        1n,
        parseEther("1"),
        "ipfs://youlin/challenge.json",
        keccak256(toBytes("challenge")),
      ],
      { account: system.challenger1.account },
    );
    let times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[10]);
    await system.protocol.write.beginDisputeVoting([1n]);
    for (const juror of [system.juror1, system.juror2, system.juror3]) {
      await system.protocol.write.voteOnDispute(
        [1n, true, parseEther("1")],
        { account: juror.account },
      );
    }
    times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[11]);
    await system.protocol.write.finalizeDispute([1n]);
    await system.protocol.write.claimSuccessfulChallengeReward([1n], {
      account: system.challenger1.account,
    });

    assert.equal((await system.protocol.read.getProjectCore([1n]))[2], 11);
    assert.equal(
      await system.reputation.read.balanceOf([system.challenger1.account.address]),
      parseEther("106"),
    );
  });
});
