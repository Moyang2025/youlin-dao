import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { zeroAddress } from "viem";

describe("YoulinParticipation", async function () {
  const { viem } = await network.create("hardhat");
  const wallets = await viem.getWalletClients();

  it("mints at most one P per account and project", async function () {
    const [admin, alice] = wallets;
    const participation = await viem.deployContract("YoulinParticipation", [
      admin.account.address,
      "ipfs://youlin/{id}.json",
    ]);
    const role = await participation.read.PROTOCOL_ROLE();
    await participation.write.grantRole([role, admin.account.address]);

    await participation.write.mint([alice.account.address, 1n]);
    await participation.write.mint([alice.account.address, 1n]);

    assert.equal(
      await participation.read.balanceOf([alice.account.address, 1n]),
      1n,
    );
    assert.equal(
      await participation.read.hasCredential([alice.account.address, 1n]),
      true,
    );
  });

  it("rejects single and batch transfers", async function () {
    const [admin, alice, bob] = wallets;
    const participation = await viem.deployContract("YoulinParticipation", [
      admin.account.address,
      "",
    ]);
    const role = await participation.read.PROTOCOL_ROLE();
    await participation.write.grantRole([role, admin.account.address]);
    await participation.write.mint([alice.account.address, 1n]);

    await viem.assertions.revertWithCustomError(
      participation.write.safeTransferFrom(
        [alice.account.address, bob.account.address, 1n, 1n, "0x"],
        { account: alice.account },
      ),
      participation,
      "NonTransferable",
    );
    await viem.assertions.revertWithCustomError(
      participation.write.safeBatchTransferFrom(
        [alice.account.address, bob.account.address, [1n], [1n], "0x"],
        { account: alice.account },
      ),
      participation,
      "NonTransferable",
    );
  });

  it("rejects zero addresses and reports supported interfaces", async function () {
    const [admin] = wallets;
    await assert.rejects(
      viem.deployContract("YoulinParticipation", [
        zeroAddress,
        "ipfs://youlin/{id}.json",
      ]),
    );
    const participation = await viem.deployContract("YoulinParticipation", [
      admin.account.address,
      "ipfs://youlin/{id}.json",
    ]);
    const role = await participation.read.PROTOCOL_ROLE();
    await participation.write.grantRole([role, admin.account.address]);
    await viem.assertions.revertWithCustomError(
      participation.write.mint([zeroAddress, 1n]),
      participation,
      "ZeroAddress",
    );
    assert.equal(await participation.read.supportsInterface(["0xd9b67a26"]), true);
  });
});
