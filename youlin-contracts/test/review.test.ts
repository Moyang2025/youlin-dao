import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEther } from "viem";
import {
  advanceAfter,
  advanceTime,
  createActivatedProject,
  deploySystem,
  fundRound1,
  submitFinalAndFinalize,
  submitMidAndFinalize,
  viem,
} from "./helpers.js";

describe("YoulinProtocol reviews and settlement", function () {
  it("derives both deadlines from on-chain completion and actual submission time", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    let times = await system.protocol.read.getProjectTimes([1n]);
    assert.equal(times[4], times[3] + 1_200n);

    await advanceTime(300);
    await system.protocol.write.submitMidReview(
      [
        1n,
        "ipfs://youlin/mid.json",
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      ],
      { account: system.initiator1.account },
    );
    times = await system.protocol.read.getProjectTimes([1n]);
    assert.equal(times[7], times[5] + (times[5] - times[3]));
  });

  it("matches the PRBMath logarithm vector and enforces initiator exclusion", async function () {
    const system = await deploySystem();
    assert.equal(
      await system.protocol.read.donationWeight([parseEther("1")]),
      693_147_180_559_945_309n,
    );

    await createActivatedProject(system);
    await fundRound1(system, [[system.initiator1, "3"]]);
    await advanceTime(300);
    await system.protocol.write.submitMidReview(
      [
        1n,
        "ipfs://youlin/mid.json",
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      ],
      { account: system.initiator1.account },
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidScore([1n, 10], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "NotEligibleToScore",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1DonationReputation([1n], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "InitiatorCannotEarnDonationReputation",
    );
  });

  it("keeps round two closed at 59 and opens it at 60", async function () {
    const below = await deploySystem();
    await createActivatedProject(below);
    await fundRound1(below, [
      [below.donor1, "1.6"],
      [below.donor2, "1.4"],
    ]);
    await submitMidAndFinalize(below, [
      [below.donor1, 5],
      [below.donor2, 7],
    ]);
    const belowCore = await below.protocol.read.getProjectCore([1n]);
    assert.equal(belowCore[6], 59);
    assert.equal(belowCore[2], 6);

    const passing = await deploySystem();
    await createActivatedProject(passing);
    await fundRound1(passing, [
      [passing.donor1, "1.5"],
      [passing.donor2, "1.5"],
    ]);
    await submitMidAndFinalize(passing, [
      [passing.donor1, 5],
      [passing.donor2, 7],
    ]);
    const passingCore = await passing.protocol.read.getProjectCore([1n]);
    assert.equal(passingCore[6], 60);
    assert.equal(passingCore[2], 5);
  });

  it("settles final scores below 60 immediately and burns every initiator stake", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);
    await submitFinalAndFinalize(system, [[system.donor1, 5]]);

    const core = await system.protocol.read.getProjectCore([1n]);
    assert.equal(core[7], 50);
    assert.equal(core[2], 10);
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
      await system.protocol.read.canChallenge([
        1n,
        system.challenger1.account.address,
      ]),
      false,
    );
  });

  for (const [score, expectedBalance] of [
    [60, "99.5"],
    [80, "100"],
    [85, "100.125"],
    [100, "100.5"],
  ] as const) {
    it(`applies the frozen ${score}-point return formula`, async function () {
      const system = await deploySystem();
      await createActivatedProject(system);
      await fundRound1(system, [
        [system.donor1, "1.5"],
        [system.donor2, "1.5"],
      ]);
      await submitMidAndFinalize(system, [
        [system.donor1, 8],
        [system.donor2, 8],
      ]);
      const rawScores =
        score === 85
          ? ([[system.donor1, 8], [system.donor2, 9]] as const)
          : ([[system.donor1, score / 10], [system.donor2, score / 10]] as const);
      await submitFinalAndFinalize(system, rawScores);
      let times = await system.protocol.read.getProjectTimes([1n]);
      await advanceAfter(times[10]);
      await system.protocol.write.settleWithoutChallenge([1n]);

      for (const initiator of system.initiators) {
        assert.equal(
          await system.reputation.read.balanceOf([initiator.account.address]),
          parseEther(expectedBalance),
        );
        assert.equal(
          await system.reputation.read.lockedBalanceOf([
            initiator.account.address,
          ]),
          0n,
        );
      }
    });
  }

  it("lets anyone mark final submission overdue and burn all stakes", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);
    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[7]);
    await system.protocol.write.markFinalSubmissionOverdue([1n], {
      account: system.donor4.account,
    });
    const core = await system.protocol.read.getProjectCore([1n]);
    assert.equal(core[7], 0);
    assert.equal(core[2], 10);
  });
});
