import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keccak256, parseEther, toBytes } from "viem";
import {
  advanceAfter,
  createActivatedProject,
  deploySystem,
  fundRound1,
  submitFinalAndFinalize,
  submitMidAndFinalize,
  viem,
  type TestSystem,
} from "./helpers.js";

describe("YoulinProtocol challenge and dispute", function () {
  async function prepareChallenge(system: TestSystem) {
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);
    await submitFinalAndFinalize(system, [[system.donor1, 8]]);
  }

  async function supportAndBegin(system: TestSystem) {
    await system.protocol.write.supportChallenge(
      [
        1n,
        parseEther("1"),
        "ipfs://youlin/challenge.json",
        keccak256(toBytes("challenge")),
      ],
      { account: system.challenger1.account },
    );
    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[10]);
    await system.protocol.write.beginDisputeVoting([1n]);
  }

  async function finalizeVoting(system: TestSystem) {
    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[11]);
    await system.protocol.write.finalizeDispute([1n]);
  }

  it("rejects initiator and duplicate challenge support", async function () {
    const system = await deploySystem();
    await prepareChallenge(system);
    const args = [
      1n,
      parseEther("1"),
      "ipfs://youlin/challenge.json",
      keccak256(toBytes("challenge")),
    ] as const;

    await viem.assertions.revertWithCustomError(
      system.protocol.write.supportChallenge(args, {
        account: system.initiator1.account,
      }),
      system.protocol,
      "InitiatorCannotChallenge",
    );
    await system.protocol.write.supportChallenge(args, {
      account: system.challenger1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.supportChallenge(args, {
        account: system.challenger1.account,
      }),
      system.protocol,
      "ChallengeAlreadySupported",
    );
  });

  it("passes at the exact 60% sqrt-weight threshold", async function () {
    const system = await deploySystem();
    await prepareChallenge(system);
    await supportAndBegin(system);

    await system.protocol.write.voteOnDispute(
      [1n, true, parseEther("9")],
      { account: system.juror1.account },
    );
    await system.protocol.write.voteOnDispute(
      [1n, false, parseEther("1")],
      { account: system.juror2.account },
    );
    await system.protocol.write.voteOnDispute(
      [1n, false, parseEther("1")],
      { account: system.juror3.account },
    );
    await finalizeVoting(system);

    assert.equal(await system.protocol.read.challengeSucceeded([1n]), true);
  });

  it("fails just below the 60% sqrt-weight threshold", async function () {
    const system = await deploySystem();
    await prepareChallenge(system);
    await supportAndBegin(system);

    await system.protocol.write.voteOnDispute(
      [1n, true, parseEther("8.99")],
      { account: system.juror1.account },
    );
    await system.protocol.write.voteOnDispute(
      [1n, false, parseEther("1")],
      { account: system.juror2.account },
    );
    await system.protocol.write.voteOnDispute(
      [1n, false, parseEther("1")],
      { account: system.juror3.account },
    );
    await finalizeVoting(system);

    assert.equal(await system.protocol.read.challengeSucceeded([1n]), false);
  });

  it("moves all initiator stake to successful challengers and unlocks jurors", async function () {
    const system = await deploySystem();
    await prepareChallenge(system);
    await supportAndBegin(system);
    for (const juror of [system.juror1, system.juror2, system.juror3]) {
      await system.protocol.write.voteOnDispute(
        [1n, true, parseEther("1")],
        { account: juror.account },
      );
    }
    await finalizeVoting(system);

    for (const initiator of system.initiators) {
      assert.equal(
        await system.reputation.read.balanceOf([initiator.account.address]),
        parseEther("98"),
      );
      assert.equal(
        await system.reputation.read.lockedBalanceOf([initiator.account.address]),
        0n,
      );
    }
    assert.equal(
      await system.reputation.read.lockedBalanceOf([
        system.challenger1.account.address,
      ]),
      0n,
    );
    await system.protocol.write.claimSuccessfulChallengeReward([1n], {
      account: system.challenger1.account,
    });
    assert.equal(
      await system.reputation.read.balanceOf([system.challenger1.account.address]),
      parseEther("106"),
    );

    for (const juror of [system.juror1, system.juror2, system.juror3]) {
      assert.equal(
        await system.reputation.read.lockedBalanceOf([juror.account.address]),
        parseEther("1"),
      );
      await system.protocol.write.unlockDisputeVoteStake([1n], {
        account: juror.account,
      });
      assert.equal(
        await system.reputation.read.lockedBalanceOf([juror.account.address]),
        0n,
      );
    }
  });

  it("splits a failed challenge 50/50 between initiators and donors", async function () {
    const system = await deploySystem();
    await prepareChallenge(system);
    await supportAndBegin(system);
    await system.protocol.write.voteOnDispute(
      [1n, true, parseEther("1")],
      { account: system.juror1.account },
    );
    await system.protocol.write.voteOnDispute(
      [1n, false, parseEther("1")],
      { account: system.juror2.account },
    );
    await system.protocol.write.voteOnDispute(
      [1n, false, parseEther("1")],
      { account: system.juror3.account },
    );
    await finalizeVoting(system);

    assert.equal(await system.protocol.read.donorRewardPool([1n]), parseEther("0.5"));
    assert.equal(
      await system.protocol.read.initiatorRewardPool([1n]),
      parseEther("0.5"),
    );
    assert.equal(
      await system.reputation.read.balanceOf([system.challenger1.account.address]),
      parseEther("99"),
    );
    await system.protocol.write.claimDonorChallengeReward([1n], {
      account: system.donor1.account,
    });
    assert.equal(
      await system.reputation.read.balanceOf([system.donor1.account.address]),
      parseEther("100.7"),
    );
    await system.protocol.write.claimInitiatorChallengeReward([1n], {
      account: system.initiator1.account,
    });
    assert.equal(
      await system.reputation.read.balanceOf([system.initiator1.account.address]),
      parseEther("100.166666666666666666"),
    );
  });
});
