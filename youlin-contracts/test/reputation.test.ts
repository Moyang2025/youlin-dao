import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther, zeroAddress } from "viem";

describe("YoulinReputation", async function () {
  const { viem } = await network.create("hardhat");
  const wallets = await viem.getWalletClients();

  it("keeps locked R in total balance while reducing available R", async function () {
    const [admin, alice] = wallets;
    const reputation = await viem.deployContract("YoulinReputation", [
      admin.account.address,
    ]);
    const role = await reputation.read.PROTOCOL_ROLE();

    await reputation.write.grantRole([role, admin.account.address]);
    await reputation.write.bootstrapMint(
      [[alice.account.address], [parseEther("10")]],
    );
    await reputation.write.lockByProtocol(
      [alice.account.address, parseEther("4"), 1n],
    );

    assert.equal(
      await reputation.read.balanceOf([alice.account.address]),
      parseEther("10"),
    );
    assert.equal(
      await reputation.read.lockedBalanceOf([alice.account.address]),
      parseEther("4"),
    );
    assert.equal(
      await reputation.read.availableBalanceOf([alice.account.address]),
      parseEther("6"),
    );

    await reputation.write.unlockByProtocol(
      [alice.account.address, parseEther("1"), 1n],
    );
    assert.equal(
      await reputation.read.availableBalanceOf([alice.account.address]),
      parseEther("7"),
    );
  });

  it("rejects user transfers and transferFrom", async function () {
    const [admin, alice, bob] = wallets;
    const reputation = await viem.deployContract("YoulinReputation", [
      admin.account.address,
    ]);
    await reputation.write.bootstrapMint(
      [[alice.account.address], [parseEther("2")]],
    );

    await viem.assertions.revertWithCustomError(
      reputation.write.transfer([bob.account.address, 1n], {
        account: alice.account,
      }),
      reputation,
      "NonTransferable",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.transferFrom(
        [alice.account.address, bob.account.address, 1n],
        { account: bob.account },
      ),
      reputation,
      "NonTransferable",
    );
  });

  it("burns and reallocates only locked R while preserving reallocation supply", async function () {
    const [admin, alice, bob] = wallets;
    const reputation = await viem.deployContract("YoulinReputation", [
      admin.account.address,
    ]);
    const role = await reputation.read.PROTOCOL_ROLE();
    await reputation.write.grantRole([role, admin.account.address]);
    await reputation.write.bootstrapMint(
      [[alice.account.address], [parseEther("10")]],
    );
    await reputation.write.lockByProtocol(
      [alice.account.address, parseEther("8"), 7n],
    );

    await reputation.write.burnLockedByProtocol(
      [alice.account.address, parseEther("2"), 7n],
    );
    assert.equal(await reputation.read.totalSupply(), parseEther("8"));

    await reputation.write.reallocateLockedByProtocol(
      [alice.account.address, bob.account.address, parseEther("3"), 7n],
    );
    assert.equal(await reputation.read.totalSupply(), parseEther("8"));
    assert.equal(
      await reputation.read.balanceOf([bob.account.address]),
      parseEther("3"),
    );
    assert.equal(
      await reputation.read.lockedBalanceOf([alice.account.address]),
      parseEther("3"),
    );
  });

  it("permanently closes bootstrap minting", async function () {
    const [admin, alice] = wallets;
    const reputation = await viem.deployContract("YoulinReputation", [
      admin.account.address,
    ]);
    await reputation.write.closeBootstrap();

    await viem.assertions.revertWithCustomError(
      reputation.write.bootstrapMint(
        [[alice.account.address], [parseEther("1")]],
      ),
      reputation,
      "BootstrapAlreadyClosed",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.closeBootstrap(),
      reputation,
      "BootstrapAlreadyClosed",
    );
  });

  it("rejects invalid mint, lock, consume and reallocation inputs", async function () {
    const [admin, alice] = wallets;
    await assert.rejects(
      viem.deployContract("YoulinReputation", [zeroAddress]),
    );
    const reputation = await viem.deployContract("YoulinReputation", [
      admin.account.address,
    ]);
    const role = await reputation.read.PROTOCOL_ROLE();
    await reputation.write.grantRole([role, admin.account.address]);

    await viem.assertions.revertWithCustomError(
      reputation.write.bootstrapMint([[alice.account.address], []]),
      reputation,
      "ArrayLengthMismatch",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.bootstrapMint([[zeroAddress], [parseEther("1")]]),
      reputation,
      "ZeroAddress",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.bootstrapMint([[alice.account.address], [0n]]),
      reputation,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.mintByProtocol([zeroAddress, 1n, 0, 0n]),
      reputation,
      "ZeroAddress",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.mintByProtocol([alice.account.address, 0n, 0, 0n]),
      reputation,
      "ZeroAmount",
    );
    await reputation.write.bootstrapMint(
      [[alice.account.address], [parseEther("1")]],
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.lockByProtocol([alice.account.address, 0n, 1n]),
      reputation,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.lockByProtocol([
        alice.account.address,
        parseEther("2"),
        1n,
      ]),
      reputation,
      "InsufficientAvailableReputation",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.unlockByProtocol([alice.account.address, 0n, 1n]),
      reputation,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.unlockByProtocol([alice.account.address, 1n, 1n]),
      reputation,
      "InsufficientLockedReputation",
    );
    await viem.assertions.revertWithCustomError(
      reputation.write.reallocateLockedByProtocol([
        alice.account.address,
        zeroAddress,
        1n,
        1n,
      ]),
      reputation,
      "ZeroAddress",
    );
  });
});
