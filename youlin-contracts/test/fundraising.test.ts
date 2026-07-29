import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEther } from "viem";
import {
  advanceAfter,
  createActivatedProject,
  deploySystem,
  donateRound2,
  fundRound1,
  publicClient,
  submitMidAndFinalize,
  viem,
} from "./helpers.js";

describe("YoulinProtocol fundraising", function () {
  it("escrows round one, mints P, and releases donation R only after success", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);

    await system.protocol.write.donateRound1([1n], {
      account: system.donor1.account,
      value: parseEther("1"),
    });
    assert.equal(
      await publicClient.getBalance({ address: system.protocol.address }),
      parseEther("1"),
    );
    assert.equal(
      await system.participation.read.hasCredential([
        system.donor1.account.address,
        1n,
      ]),
      true,
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1DonationReputation([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "Round1NotCompleted",
    );

    await system.protocol.write.donateRound1([1n], {
      account: system.donor2.account,
      value: parseEther("2"),
    });
    await system.protocol.write.claimRound1DonationReputation([1n], {
      account: system.donor1.account,
    });
    assert.equal(
      await system.reputation.read.balanceOf([system.donor1.account.address]),
      parseEther("101"),
    );
    await viem.assertions.revertWithCustomError(
      system.protocol.write.claimRound1DonationReputation([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "ReputationAlreadyClaimed",
    );
  });

  it("keeps failed-project P while refunding MON and never issuing donation R", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await system.protocol.write.donateRound1([1n], {
      account: system.donor1.account,
      value: parseEther("1"),
    });

    const times = await system.protocol.read.getProjectTimes([1n]);
    await advanceAfter(times[0]);
    await system.protocol.write.markRound1Failed([1n]);
    await system.protocol.write.refundRound1([1n], {
      account: system.donor1.account,
    });

    assert.equal(
      await publicClient.getBalance({ address: system.protocol.address }),
      0n,
    );
    assert.equal(
      await system.participation.read.hasCredential([
        system.donor1.account.address,
        1n,
      ]),
      true,
    );
    assert.equal(
      await system.reputation.read.balanceOf([system.donor1.account.address]),
      parseEther("100"),
    );
    for (const initiator of system.initiators) {
      assert.equal(
        await system.reputation.read.lockedBalanceOf([initiator.account.address]),
        0n,
      );
    }
    await viem.assertions.revertWithCustomError(
      system.protocol.write.refundRound1([1n], {
        account: system.donor1.account,
      }),
      system.protocol,
      "RefundAlreadyClaimed",
    );
  });

  it("sends round two MON to the immutable project wallet in the same transaction", async function () {
    const system = await deploySystem();
    await createActivatedProject(system);
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);

    const before = await publicClient.getBalance({
      address: system.projectWallet.account.address,
    });
    await donateRound2(system, [[system.donor4, "3"]]);
    const after = await publicClient.getBalance({
      address: system.projectWallet.account.address,
    });

    assert.equal(after - before, parseEther("3"));
    assert.equal(
      await publicClient.getBalance({ address: system.protocol.address }),
      parseEther("3"),
    );
    assert.equal(
      await system.reputation.read.balanceOf([system.donor4.account.address]),
      parseEther("103"),
    );
    const core = await system.protocol.read.getProjectCore([1n]);
    assert.equal(core[2], 6);
  });

  it("rolls back round two accounting, P and R if the project wallet rejects MON", async function () {
    const system = await deploySystem();
    const rejectingWallet = await viem.deployContract("RejectEther");
    const block = await publicClient.getBlock();

    await system.protocol.write.createProjectDraft(
      [
        rejectingWallet.address,
        parseEther("6"),
        block.timestamp + 10_000n,
        1_800n,
        system.initiators.map((wallet) => wallet.account.address),
        "ipfs://youlin/rejecting.json",
        "0x1111111111111111111111111111111111111111111111111111111111111111",
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
    await fundRound1(system, [[system.donor1, "3"]]);
    await submitMidAndFinalize(system, [[system.donor1, 8]]);

    await viem.assertions.revertWithCustomError(
      system.protocol.write.donateRound2([1n], {
        account: system.donor4.account,
        value: parseEther("1"),
      }),
      system.protocol,
      "NativeTransferFailed",
    );
    assert.equal(
      await system.protocol.read.round2DonationOf([
        1n,
        system.donor4.account.address,
      ]),
      0n,
    );
    assert.equal(
      await system.participation.read.hasCredential([
        system.donor4.account.address,
        1n,
      ]),
      false,
    );
    assert.equal(
      await system.reputation.read.balanceOf([system.donor4.account.address]),
      parseEther("100"),
    );
  });
});
