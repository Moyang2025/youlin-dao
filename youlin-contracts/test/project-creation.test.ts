import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, parseEther, toBytes } from "viem";

describe("YoulinProtocol project creation", async function () {
  const { viem } = await network.create("hardhat");
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();

  async function deployFixture() {
    const [admin, initiator1, initiator2, initiator3, outsider, projectWallet] =
      wallets;
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

    const reputationRole = await reputation.read.PROTOCOL_ROLE();
    const participationRole = await participation.read.PROTOCOL_ROLE();
    await reputation.write.grantRole([reputationRole, protocol.address]);
    await participation.write.grantRole([participationRole, protocol.address]);
    await reputation.write.bootstrapMint([
      [
        initiator1.account.address,
        initiator2.account.address,
        initiator3.account.address,
      ],
      [parseEther("20"), parseEther("20"), parseEther("20")],
    ]);

    return {
      admin,
      initiator1,
      initiator2,
      initiator3,
      outsider,
      projectWallet,
      reputation,
      participation,
      protocol,
    };
  }

  async function createDraft(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
  ) {
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + 3_600n;
    await fixture.protocol.write.createProjectDraft(
      [
        fixture.projectWallet.account.address,
        parseEther("30"),
        deadline,
        600n,
        [
          fixture.initiator1.account.address,
          fixture.initiator2.account.address,
          fixture.initiator3.account.address,
        ],
        "ipfs://youlin/project-1.json",
        keccak256(toBytes("project-1")),
      ],
      { account: fixture.initiator1.account },
    );
  }

  it("uses the frozen dynamic initiator bounds", async function () {
    const { protocol } = await deployFixture();

    assert.deepEqual(await protocol.read.initiatorBounds([parseEther("30")]), [
      3n,
      3n,
    ]);
    assert.deepEqual(
      await protocol.read.initiatorBounds([parseEther("100")]),
      [3n, 10n],
    );
    assert.deepEqual(
      await protocol.read.initiatorBounds([parseEther("4,000".replace(",", ""))]),
      [4n, 10n],
    );
  });

  it("requires valid unique invitations including the creator", async function () {
    const fixture = await deployFixture();
    const block = await publicClient.getBlock();
    const commonArgs = [
      fixture.projectWallet.account.address,
      parseEther("30"),
      block.timestamp + 3_600n,
      600n,
    ] as const;

    await viem.assertions.revertWithCustomError(
      fixture.protocol.write.createProjectDraft(
        [
          ...commonArgs,
          [
            fixture.initiator1.account.address,
            fixture.initiator2.account.address,
          ],
          "ipfs://youlin/project.json",
          keccak256(toBytes("project")),
        ],
        { account: fixture.initiator1.account },
      ),
      fixture.protocol,
      "InvalidInitiatorCount",
    );

    await viem.assertions.revertWithCustomError(
      fixture.protocol.write.createProjectDraft(
        [
          ...commonArgs,
          [
            fixture.initiator1.account.address,
            fixture.initiator2.account.address,
            fixture.initiator2.account.address,
          ],
          "ipfs://youlin/project.json",
          keccak256(toBytes("project")),
        ],
        { account: fixture.initiator1.account },
      ),
      fixture.protocol,
      "DuplicateInitiator",
    );

    await viem.assertions.revertWithCustomError(
      fixture.protocol.write.createProjectDraft(
        [
          ...commonArgs,
          [
            fixture.initiator2.account.address,
            fixture.initiator3.account.address,
            fixture.outsider.account.address,
          ],
          "ipfs://youlin/project.json",
          keccak256(toBytes("project")),
        ],
        { account: fixture.initiator1.account },
      ),
      fixture.protocol,
      "CreatorMustBeInvited",
    );
  });

  it("locks each initiator's own R and activates only after both thresholds", async function () {
    const fixture = await deployFixture();
    await createDraft(fixture);

    await fixture.protocol.write.acceptInitiation(
      [1n, parseEther("10")],
      { account: fixture.initiator1.account },
    );
    await fixture.protocol.write.acceptInitiation(
      [1n, parseEther("10")],
      { account: fixture.initiator2.account },
    );

    await viem.assertions.revertWithCustomError(
      fixture.protocol.write.activateProject([1n], {
        account: fixture.outsider.account,
      }),
      fixture.protocol,
      "InitiatorCountNotMet",
    );

    await fixture.protocol.write.acceptInitiation(
      [1n, parseEther("10")],
      { account: fixture.initiator3.account },
    );
    await fixture.protocol.write.activateProject([1n], {
      account: fixture.outsider.account,
    });

    const core = await fixture.protocol.read.getProjectCore([1n]);
    assert.equal(core[2], 1);
    assert.equal(
      await fixture.protocol.read.totalInitiatorStake([1n]),
      parseEther("30"),
    );
    assert.equal(
      await fixture.reputation.read.lockedBalanceOf([
        fixture.initiator1.account.address,
      ]),
      parseEther("10"),
    );
    assert.deepEqual(
      await fixture.protocol.read.getInitiatedProjects([
        fixture.initiator1.account.address,
        0n,
        10n,
      ]),
      [1n],
    );
  });

  it("permissionlessly cancels an expired draft and unlocks accepted stakes", async function () {
    const fixture = await deployFixture();
    await createDraft(fixture);
    await fixture.protocol.write.acceptInitiation(
      [1n, parseEther("10")],
      { account: fixture.initiator1.account },
    );
    const times = await fixture.protocol.read.getProjectTimes([1n]);
    const testClient = await viem.getTestClient();
    const block = await publicClient.getBlock();
    await testClient.increaseTime({
      seconds: Number(times[0] - block.timestamp + 1n),
    });
    await testClient.mine({ blocks: 1 });
    await fixture.protocol.write.cancelExpiredDraft([1n], {
      account: fixture.outsider.account,
    });

    assert.equal((await fixture.protocol.read.getProjectCore([1n]))[2], 12);
    assert.equal(
      await fixture.reputation.read.lockedBalanceOf([
        fixture.initiator1.account.address,
      ]),
      0n,
    );
  });
});
