import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keccak256, parseEther, toBytes, zeroAddress } from "viem";
import {
  advanceAfter,
  advanceTime,
  createActivatedProject,
  deploySystem,
  fundRound1,
  publicClient,
  submitFinalAndFinalize,
  submitMidAndFinalize,
  viem,
} from "./helpers.js";

const hash = (value: string) => keccak256(toBytes(value));

describe("YoulinProtocol boundaries and aggregate views", function () {
  it("rejects invalid deployment configuration and enforces emergency pause", async function () {
    const system = await deploySystem();

    await assert.rejects(
      viem.deployContract("YoulinProtocol", [
        zeroAddress,
        system.reputation.address,
        system.participation.address,
        60n,
        120n,
        120n,
        180n,
        180n,
        parseEther("1"),
        parseEther("0.5"),
        6_000,
        3,
        0n,
      ]),
    );
    await assert.rejects(
      viem.deployContract("YoulinProtocol", [
        system.admin.account.address,
        system.reputation.address,
        system.participation.address,
        0n,
        120n,
        120n,
        180n,
        180n,
        parseEther("1"),
        parseEther("0.5"),
        6_000,
        3,
        0n,
      ]),
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.read.initiatorBounds([0n]),
      system.protocol,
      "ZeroAmount",
    );

    await system.protocol.write.pause({ account: system.admin.account });
    const block = await publicClient.getBlock();
    await assert.rejects(
      system.protocol.write.createProjectDraft(
        [
          system.projectWallet.account.address,
          parseEther("6"),
          block.timestamp + 1_000n,
          1_800n,
          system.initiators.map((wallet) => wallet.account.address),
          "ipfs://youlin/project.json",
          hash("paused"),
        ],
        { account: system.initiator1.account },
      ),
    );
    await system.protocol.write.unpause({ account: system.admin.account });
    await createActivatedProject(system);
    assert.equal(await system.protocol.read.projectCount(), 1n);
    assert.equal(await system.protocol.read.donationWeight([0n]), 0n);
    assert.equal(
      await system.protocol.read.canSubmitMidScore([
        0n,
        system.donor1.account.address,
      ]),
      false,
    );
    assert.equal(
      await system.protocol.read.canSubmitFinalScore([
        0n,
        system.donor1.account.address,
      ]),
      false,
    );
    assert.equal(
      await system.protocol.read.canChallenge([
        0n,
        system.donor1.account.address,
      ]),
      false,
    );
    assert.deepEqual(
      await system.protocol.read.claimableRewards([
        0n,
        system.donor1.account.address,
      ]),
      [0n, 0n, 0n, 0n],
    );
  });

  it("covers draft validation, acceptance guards, pagination and project views", async function () {
    const system = await deploySystem();
    const block = await publicClient.getBlock();
    const invited = system.initiators.map((wallet) => wallet.account.address);
    const valid = [
      system.projectWallet.account.address,
      parseEther("6"),
      block.timestamp + 10_000n,
      1_800n,
      invited,
      "ipfs://youlin/project.json",
      hash("project"),
    ] as const;

    for (const [args, error] of [
      [[zeroAddress, ...valid.slice(1)], "ZeroAddress"],
      [[valid[0], 0n, ...valid.slice(2)], "ZeroAmount"],
      [[valid[0], valid[1], block.timestamp, ...valid.slice(3)], "DeadlineNotInFuture"],
      [[valid[0], valid[1], valid[2], 1n, ...valid.slice(4)], "ExpectedDurationTooShort"],
      [[...valid.slice(0, 5), "", valid[6]], "EmptyURI"],
      [[...valid.slice(0, 6), `0x${"0".repeat(64)}`], "EmptyHash"],
    ] as const) {
      await viem.assertions.revertWithCustomError(
        system.protocol.write.createProjectDraft(args as never, {
          account: system.initiator1.account,
        }),
        system.protocol,
        error,
      );
    }
    await system.protocol.write.createProjectDraft(valid, {
      account: system.initiator1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.cancelExpiredDraft([1n]),
      system.protocol,
      "SubmissionWindowOpen",
    );
    await system.protocol.write.acceptInitiation([1n, parseEther("1")], {
      account: system.donor1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.acceptInitiation([1n, 0n], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "ZeroAmount",
    );
    await system.protocol.write.acceptInitiation([1n, parseEther("2")], {
      account: system.initiator1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.acceptInitiation([1n, parseEther("2")], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "AlreadyAccepted",
    );
    await system.protocol.write.acceptInitiation([1n, parseEther("2")], {
      account: system.initiator2.account,
    });
    await system.protocol.write.acceptInitiation([1n, parseEther("0.5")], {
      account: system.initiator3.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.activateProject([1n]),
      system.protocol,
      "InitiatorStakeNotMet",
    );

    const initiators = await system.protocol.read.getInitiators([1n]);
    assert.equal(initiators[0].length, 4);
    assert.deepEqual(initiators[1], [true, true, true, true]);
    assert.deepEqual(
      await system.protocol.read.getInitiatedProjects([
        system.initiator1.account.address,
        0n,
        1n,
      ]),
      [1n],
    );
    assert.deepEqual(
      await system.protocol.read.getInitiatedProjects([
        system.initiator1.account.address,
        1n,
        1n,
      ]),
      [],
    );
    assert.deepEqual(
      await system.protocol.read.getParticipatedProjects([
        system.donor1.account.address,
        0n,
        0n,
      ]),
      [],
    );
    await system.protocol.read.getProjectCore([1n]);
    await system.protocol.read.getProjectTimes([1n]);
    await system.protocol.read.getProjectContent([1n]);
    await viem.assertions.revertWithCustomError(
      system.protocol.read.getProjectCore([2n]),
      system.protocol,
      "ProjectNotFound",
    );
  });

  it("enforces escrow, claim and refund boundaries", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);

    await viem.assertions.revertWithCustomError(
      system.protocol.write.donateRound1([1n], {
        account: system.donor1.account,
        value: 0n,
      }),
      system.protocol,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.donateRound1([1n], {
        account: system.donor1.account,
        value: parseEther("3.1"),
      }),
      system.protocol,
      "DonationExceedsRemaining",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1DonationReputation([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "Round1NotCompleted",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1Funds([1n], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "Round1NotCompleted",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.markRound1Failed([1n]),
      system.protocol,
      "SubmissionWindowOpen",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.refundRound1([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "InvalidProjectState",
    );

    await fundRound1(system, [[system.donor1, "3"]]);
    assert.equal(await system.protocol.read.remainingRound1([1n]), 0n);
    await viem.assertions.revertWithCustomError(
      system.protocol.write.donateRound1([1n], {
        account: system.donor2.account,
        value: 1n,
      }),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.markRound1Failed([1n]),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1DonationReputation([1n], {
        account: system.donor2.account,
      }),
      system.protocol,
      "NoDonation",
    );
    await system.protocol.write.claimRound1DonationReputation([1n], {
      account: system.donor1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1DonationReputation([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "ReputationAlreadyClaimed",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1Funds([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "NotInitiator",
    );
    await system.protocol.write.claimRound1Funds([1n], {
      account: system.initiator1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1Funds([1n], {
        account: system.initiator2.account,
      }),
      system.protocol,
      "Round1FundsAlreadyClaimed",
    );
  });

  it("enforces review windows and exposes score/content aggregates", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);

    await viem.assertions.revertWithCustomError(
      system.protocol.write.markMidSubmissionOverdue([1n]),
      system.protocol,
      "SubmissionWindowOpen",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidReview([1n, "ipfs://mid", hash("mid")], {
        account: system.donor1.account,
      }),
      system.protocol,
      "NotInitiator",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidReview([1n, "", hash("mid")], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "EmptyURI",
    );
    await system.protocol.write.submitMidReview(
      [1n, "ipfs://mid", hash("mid")],
      { account: system.initiator1.account },
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidReview([1n, "ipfs://mid", hash("again")], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.markMidSubmissionOverdue([1n]),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidScore([1n, 0], {
        account: system.donor1.account,
      }),
      system.protocol,
      "ScoreOutOfRange",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidScore([1n, 8], {
        account: system.donor2.account,
      }),
      system.protocol,
      "NotEligibleToScore",
    );
    await system.protocol.write.submitMidScore([1n, 8], {
      account: system.donor1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitMidScore([1n, 8], {
        account: system.donor1.account,
      }),
      system.protocol,
      "NotEligibleToScore",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.finalizeMidScore([1n]),
      system.protocol,
      "VotingWindowOpen",
    );
    const histograms = await system.protocol.read.getScoreHistograms([1n]);
    assert.equal(histograms[0][7], 1n);
    await system.protocol.read.getProjectContent([1n]);
  });

  it("enforces round-two, final review and final scoring boundaries", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);

    await viem.assertions.revertWithCustomError(
      system.protocol.write.donateRound2([1n], {
        account: system.donor2.account,
        value: 0n,
      }),
      system.protocol,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.donateRound2([1n], {
        account: system.donor2.account,
        value: parseEther("3.1"),
      }),
      system.protocol,
      "DonationExceedsRemaining",
    );
    await system.protocol.write.donateRound2([1n], {
      account: system.donor2.account,
      value: parseEther("1"),
    });
    assert.equal(await system.protocol.read.remainingRound2([1n]), parseEther("2"));
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitFinalReview([1n, "ipfs://final", hash("final")], {
        account: system.donor1.account,
      }),
      system.protocol,
      "NotInitiator",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitFinalReview([1n, "", hash("final")], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "EmptyURI",
    );
    await system.protocol.write.submitFinalReview(
      [1n, "ipfs://final", hash("final")],
      { account: system.initiator1.account },
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitFinalReview(
        [1n, "ipfs://final", hash("again")],
        { account: system.initiator1.account },
      ),
      system.protocol,
      "FinalSubmissionNotPending",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.markFinalSubmissionOverdue([1n]),
      system.protocol,
      "FinalSubmissionNotPending",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitFinalScore([1n, 11], {
        account: system.donor1.account,
      }),
      system.protocol,
      "ScoreOutOfRange",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitFinalScore([1n, 8], {
        account: system.donor3.account,
      }),
      system.protocol,
      "NotEligibleToScore",
    );
    await system.protocol.write.submitFinalScore([1n, 8], {
      account: system.donor1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.submitFinalScore([1n, 8], {
        account: system.donor1.account,
      }),
      system.protocol,
      "NotEligibleToScore",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.finalizeFinalScore([1n]),
      system.protocol,
      "VotingWindowOpen",
    );
    assert.equal(
      await system.protocol.read.canSubmitFinalScore([
        1n,
        system.donor2.account.address,
      ]),
      true,
    );
  });

  it("enforces challenge/dispute guards and returns live claim summaries", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);
    await submitFinalAndFinalize(system, [[system.donor1, 8]]);

    await viem.assertions.revertWithCustomError(
      system.protocol.write.supportChallenge(
        [1n, parseEther("0.9"), "ipfs://challenge", hash("challenge")],
        { account: system.challenger1.account },
      ),
      system.protocol,
      "ChallengeStakeTooLow",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.supportChallenge(
        [1n, parseEther("1"), "", hash("challenge")],
        { account: system.challenger1.account },
      ),
      system.protocol,
      "EmptyURI",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.beginDisputeVoting([1n]),
      system.protocol,
      "ChallengeWindowOpen",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.settleWithoutChallenge([1n]),
      system.protocol,
      "ChallengeWindowOpen",
    );
    await system.protocol.write.supportChallenge(
      [1n, parseEther("1"), "ipfs://challenge", hash("challenge")],
      { account: system.challenger1.account },
    );
    assert.equal(
      await system.protocol.read.canChallenge([
        1n,
        system.challenger1.account.address,
      ]),
      false,
    );
    let summary = await system.protocol.read.getChallengeSummary([1n]);
    assert.equal(summary[0], parseEther("1"));
    assert.equal(summary[1], 1n);
    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[10]);
    await viem.assertions.revertWithCustomError(
      system.protocol.write.settleWithoutChallenge([1n]),
      system.protocol,
      "ChallengeExists",
    );
    await system.protocol.write.beginDisputeVoting([1n]);
    await viem.assertions.revertWithCustomError(
      system.protocol.write.supportChallenge(
        [1n, parseEther("1"), "ipfs://challenge", hash("late")],
        { account: system.challenger2.account },
      ),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.beginDisputeVoting([1n]),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.settleWithoutChallenge([1n]),
      system.protocol,
      "InvalidProjectState",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.voteOnDispute([1n, true, parseEther("0.4")], {
        account: system.juror1.account,
      }),
      system.protocol,
      "JurorStakeTooLow",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.voteOnDispute([1n, true, parseEther("1")], {
        account: system.initiator1.account,
      }),
      system.protocol,
      "JurorNotEligible",
    );
    await system.protocol.write.voteOnDispute([1n, true, parseEther("1")], {
      account: system.juror1.account,
    });
    await viem.assertions.revertWithCustomError(
      system.protocol.write.voteOnDispute([1n, false, parseEther("1")], {
        account: system.juror1.account,
      }),
      system.protocol,
      "DisputeVoteAlreadySubmitted",
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.finalizeDispute([1n]),
      system.protocol,
      "VotingWindowOpen",
    );
    assert.deepEqual(
      await system.protocol.read.claimableRewards([
        1n,
        system.juror1.account.address,
      ]),
      [0n, 0n, 0n, 0n],
    );
    summary = await system.protocol.read.getChallengeSummary([1n]);
    assert.equal(summary[4], 1n);
  });

  it("finalizes empty score sets as zero and handles mid-submission timeout", async function () {
    const noScores = await deploySystem();
    await createActivatedProject(noScores);
    await fundRound1(noScores, [[noScores.donor1, "3"]]);
    await noScores.protocol.write.submitMidReview(
      [1n, "ipfs://mid", hash("empty-scores")],
      { account: noScores.initiator1.account },
    );
    let times = await noScores.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[6]);
    await noScores.protocol.write.finalizeMidScore([1n]);
    assert.equal((await noScores.protocol.read.getProjectCore([1n]))[6], 0);

    const overdue = await deploySystem();
    await createActivatedProject(overdue);
    await fundRound1(overdue, [[overdue.donor1, "3"]]);
    times = await overdue.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[4]);
    await overdue.protocol.write.markMidSubmissionOverdue([1n]);
    const core = await overdue.protocol.read.getProjectCore([1n]);
    assert.equal(core[6], 0);
    assert.equal(core[2], 6);
    await advanceTime(1);
  });
});
