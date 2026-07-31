import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keccak256, parseEther, toBytes } from "viem";
import {
  advanceTime,
  deployGenesisTreasury,
  deploySystem,
  publicClient,
  viem,
  type TestSystem,
  type TestWallet,
} from "./helpers.js";

const proposalURI = "ipfs://youlin/genesis/proposal-1.json";
const proposalHash = keccak256(toBytes("genesis proposal 1"));

async function donate(
  genesis: Awaited<ReturnType<typeof deployGenesisTreasury>>,
  donor: TestWallet,
  amount: string,
) {
  await genesis.write.donate([], {
    account: donor.account,
    value: parseEther(amount),
  });
}

async function createProposal(
  system: TestSystem,
  genesis: Awaited<ReturnType<typeof deployGenesisTreasury>>,
  amount = "1",
) {
  await genesis.write.createProposal(
    [
      system.projectWallet.account.address,
      parseEther(amount),
      proposalURI,
      proposalHash,
    ],
    { account: system.donor1.account },
  );
}

describe("YoulinGenesisTreasury", function () {
  it("holds MON and immediately mints genesis P and equal R", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    const beforeR = await system.reputation.read.balanceOf([
      system.donor1.account.address,
    ]);

    await donate(genesis, system.donor1, "0.1");

    assert.equal(
      await publicClient.getBalance({ address: genesis.address }),
      parseEther("0.1"),
    );
    assert.equal(
      await genesis.read.cumulativeDonationOf([system.donor1.account.address]),
      parseEther("0.1"),
    );
    assert.equal(await genesis.read.totalDonated(), parseEther("0.1"));
    assert.equal(await genesis.read.donorCount(), 1n);
    assert.equal(
      await system.reputation.read.balanceOf([system.donor1.account.address]),
      beforeR + parseEther("0.1"),
    );
    assert.equal(
      await system.participation.read.hasCredential([
        system.donor1.account.address,
        await genesis.read.GENESIS_PROJECT_ID(),
      ]),
      true,
    );
  });

  it("enforces the cumulative 100 R address cap and rejects untracked transfers", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "99.9");
    await donate(genesis, system.donor1, "0.1");

    await viem.assertions.revertWithCustomError(
      genesis.write.donate([], {
        account: system.donor1.account,
        value: 1n,
      }),
      genesis,
      "DonationCapExceeded",
    );
    await viem.assertions.revertWithCustomError(
      system.donor2.sendTransaction({
        to: genesis.address,
        value: parseEther("0.1"),
      }),
      genesis,
      "UseDonateFunction",
    );
  });

  it("uses the protocol ln(1 + donation) weighting and makes 100 MON about twice 10 MON", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    const tenWeight = await genesis.read.donationWeight([parseEther("10")]);
    const hundredWeight = await genesis.read.donationWeight([parseEther("100")]);
    const ratioBps = (hundredWeight * 10_000n) / tenWeight;

    assert.ok(ratioBps >= 19_200n);
    assert.ok(ratioBps <= 19_300n);
  });

  it("snapshots cumulative donation so later donations cannot change an existing vote", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "1");
    await donate(genesis, system.donor2, "1");
    await donate(genesis, system.donor3, "1");
    await createProposal(system, genesis, "1");
    const proposal = await genesis.read.getProposal([1n]);
    const snapshotVersion = proposal[3];

    await donate(genesis, system.donor2, "9");

    assert.equal(
      await genesis.read.donationAtVersion([
        system.donor2.account.address,
        snapshotVersion,
      ]),
      parseEther("1"),
    );
    await genesis.write.vote([1n, true], { account: system.donor2.account });
    const afterVote = await genesis.read.getProposal([1n]);
    assert.equal(
      afterVote[6],
      await genesis.read.donationWeight([parseEther("1")]),
    );
  });

  it("ignores inactive donors and passes with at least three cast votes at 66% support weight", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "10");
    await donate(genesis, system.donor2, "10");
    await donate(genesis, system.donor3, "10");
    await donate(genesis, system.donor4, "100");
    await createProposal(system, genesis, "1");

    await genesis.write.vote([1n, true], { account: system.donor1.account });
    await genesis.write.vote([1n, true], { account: system.donor2.account });
    await genesis.write.vote([1n, true], { account: system.donor3.account });
    await advanceTime(121);
    await genesis.write.finalizeProposal([1n]);

    const proposal = await genesis.read.getProposal([1n]);
    assert.equal(proposal[9], true);
    assert.equal(proposal[5], 3n);
    assert.equal(await genesis.read.cumulativeDonationOf([
      system.donor4.account.address,
    ]), parseEther("100"));
  });

  it("counts explicit reject weight and fails below the 66% cast-weight threshold", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "1");
    await donate(genesis, system.donor2, "1");
    await donate(genesis, system.donor3, "10");
    await createProposal(system, genesis, "1");

    await genesis.write.vote([1n, true], { account: system.donor1.account });
    await genesis.write.vote([1n, true], { account: system.donor2.account });
    await genesis.write.vote([1n, false], { account: system.donor3.account });
    await advanceTime(121);
    await genesis.write.finalizeProposal([1n]);

    const proposal = await genesis.read.getProposal([1n]);
    assert.equal(proposal[9], false);
    assert.equal(await genesis.read.reservedBalance(), 0n);
  });

  it("requires at least three actual voters even when all cast weight supports", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "1");
    await donate(genesis, system.donor2, "1");
    await donate(genesis, system.donor3, "1");
    await createProposal(system, genesis, "1");

    await genesis.write.vote([1n, true], { account: system.donor1.account });
    await genesis.write.vote([1n, true], { account: system.donor2.account });
    await advanceTime(121);
    await genesis.write.finalizeProposal([1n]);

    assert.equal((await genesis.read.getProposal([1n]))[9], false);
  });

  it("reserves proposal funds and executes an approved transfer exactly once", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "1");
    await donate(genesis, system.donor2, "1");
    await donate(genesis, system.donor3, "1");
    await createProposal(system, genesis, "2");

    assert.equal(await genesis.read.reservedBalance(), parseEther("2"));
    assert.equal(await genesis.read.availableBalance(), parseEther("1"));
    await viem.assertions.revertWithCustomError(
      genesis.write.createProposal(
        [
          system.projectWallet.account.address,
          parseEther("2"),
          proposalURI,
          proposalHash,
        ],
        { account: system.donor2.account },
      ),
      genesis,
      "InsufficientUnreservedBalance",
    );

    for (const donor of [system.donor1, system.donor2, system.donor3]) {
      await genesis.write.vote([1n, true], { account: donor.account });
    }
    await advanceTime(121);
    await genesis.write.finalizeProposal([1n]);
    await viem.assertions.revertWithCustomError(
      genesis.write.createProposal(
        [
          system.projectWallet.account.address,
          parseEther("0.1"),
          proposalURI,
          proposalHash,
        ],
        { account: system.donor1.account },
      ),
      genesis,
      "ActiveProposalExists",
    );

    const before = await publicClient.getBalance({
      address: system.projectWallet.account.address,
    });
    await genesis.write.executeProposal([1n]);
    const after = await publicClient.getBalance({
      address: system.projectWallet.account.address,
    });
    assert.equal(after - before, parseEther("2"));
    assert.equal(await genesis.read.reservedBalance(), 0n);

    await viem.assertions.revertWithCustomError(
      genesis.write.executeProposal([1n]),
      genesis,
      "AlreadyExecuted",
    );
  });

  it("allows only the proposer to cancel a proposal before any vote", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "1");
    await createProposal(system, genesis, "0.5");

    await viem.assertions.revertWithCustomError(
      genesis.write.cancelProposal([1n], { account: system.donor2.account }),
      genesis,
      "NotProposer",
    );
    await genesis.write.cancelProposal([1n], {
      account: system.donor1.account,
    });
    assert.equal(await genesis.read.reservedBalance(), 0n);
    assert.equal((await genesis.read.getProposal([1n]))[11], true);
  });

  it("enforces snapshot eligibility, one vote, deadlines, and donor-only proposals", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await donate(genesis, system.donor1, "1");
    await donate(genesis, system.donor2, "1");
    await donate(genesis, system.donor3, "1");
    await createProposal(system, genesis, "1");

    await viem.assertions.revertWithCustomError(
      genesis.write.createProposal(
        [
          system.projectWallet.account.address,
          parseEther("0.1"),
          proposalURI,
          proposalHash,
        ],
        { account: system.challenger1.account },
      ),
      genesis,
      "NotDonor",
    );

    await donate(genesis, system.donor4, "1");
    await viem.assertions.revertWithCustomError(
      genesis.write.vote([1n, true], { account: system.donor4.account }),
      genesis,
      "NotEligibleAtSnapshot",
    );
    await genesis.write.vote([1n, true], { account: system.donor1.account });
    await viem.assertions.revertWithCustomError(
      genesis.write.vote([1n, false], { account: system.donor1.account }),
      genesis,
      "AlreadyVoted",
    );
    await advanceTime(121);
    await viem.assertions.revertWithCustomError(
      genesis.write.vote([1n, true], { account: system.donor2.account }),
      genesis,
      "VotingClosed",
    );
  });

  it("lets the admin pause activity and adjust future cap and voting duration without withdrawing", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await genesis.write.setPerAddressCap([parseEther("200")]);
    await genesis.write.setVotingDuration([300n]);
    assert.equal(await genesis.read.perAddressCap(), parseEther("200"));
    assert.equal(await genesis.read.votingDuration(), 300n);

    await genesis.write.pause();
    await viem.assertions.revertWithCustomError(
      genesis.write.donate([], {
        account: system.donor1.account,
        value: parseEther("1"),
      }),
      genesis,
      "EnforcedPause",
    );
    await genesis.write.unpause();
    await donate(genesis, system.donor1, "1");
    await genesis.write.setPerAddressCap([parseEther("0.5")]);
    await viem.assertions.revertWithCustomError(
      genesis.write.donate([], {
        account: system.donor1.account,
        value: 1n,
      }),
      genesis,
      "DonationCapExceeded",
    );
  });

  it("covers zero values, malformed proposals, premature actions and finalized guards", async function () {
    const system = await deploySystem();
    const genesis = await deployGenesisTreasury(system);
    await viem.assertions.revertWithCustomError(
      genesis.write.donate([], {
        account: system.donor1.account,
        value: 0n,
      }),
      genesis,
      "ZeroAmount",
    );
    await donate(genesis, system.donor1, "1");
    await donate(genesis, system.donor2, "1");
    await donate(genesis, system.donor3, "1");

    const valid = [
      system.projectWallet.account.address,
      parseEther("0.5"),
      proposalURI,
      proposalHash,
    ] as const;
    const invalidRows = [
      [
        "ZeroAddress",
        [
          "0x0000000000000000000000000000000000000000",
          valid[1],
          valid[2],
          valid[3],
        ],
      ],
      ["ZeroAmount", [valid[0], 0n, valid[2], valid[3]]],
      ["EmptyURI", [valid[0], valid[1], "", valid[3]]],
      [
        "EmptyHash",
        [
          valid[0],
          valid[1],
          valid[2],
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ],
      ],
    ] as const;
    for (const [errorName, args] of invalidRows) {
      await viem.assertions.revertWithCustomError(
        genesis.write.createProposal(args, {
          account: system.donor1.account,
        }),
        genesis,
        errorName,
      );
    }

    await createProposal(system, genesis, "0.5");
    await viem.assertions.revertWithCustomError(
      genesis.write.finalizeProposal([1n]),
      genesis,
      "VotingStillOpen",
    );
    await viem.assertions.revertWithCustomError(
      genesis.write.executeProposal([1n]),
      genesis,
      "VotingStillOpen",
    );
    await genesis.write.vote([1n, true], { account: system.donor1.account });
    await viem.assertions.revertWithCustomError(
      genesis.write.cancelProposal([1n], { account: system.donor1.account }),
      genesis,
      "VotesAlreadyCast",
    );
    await advanceTime(121);
    await genesis.write.finalizeProposal([1n]);
    await viem.assertions.revertWithCustomError(
      genesis.write.vote([1n, true], { account: system.donor2.account }),
      genesis,
      "AlreadyFinalized",
    );
    await viem.assertions.revertWithCustomError(
      genesis.write.finalizeProposal([1n]),
      genesis,
      "AlreadyFinalized",
    );
    await viem.assertions.revertWithCustomError(
      genesis.write.executeProposal([1n]),
      genesis,
      "ProposalDidNotPass",
    );
    await viem.assertions.revertWithCustomError(
      genesis.read.getProposal([2n]),
      genesis,
      "ProposalNotFound",
    );
    await viem.assertions.revertWithCustomError(
      genesis.write.setPerAddressCap([0n]),
      genesis,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      genesis.write.setVotingDuration([59n]),
      genesis,
      "InvalidVotingDuration",
    );
  });
});
