import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { viem, wallets } from "./helpers.js";

async function deployRegistry() {
  return viem.deployContract("YoulinProfileRegistry");
}

describe("YoulinProfileRegistry", () => {
  it("lets each wallet create and read its own UTF-8 profile", async () => {
    const registry = await deployRegistry();
    const [, alice] = wallets;
    await registry.write.setProfile(
      ["小邻", "https://example.com/alice.png", "关注社区教育与公共空间。"],
      { account: alice.account },
    );

    const profile = await registry.read.getProfile([alice.account.address]);
    assert.equal(profile[0], "小邻");
    assert.equal(profile[1], "https://example.com/alice.png");
    assert.equal(profile[2], "关注社区教育与公共空间。");
    assert.equal(profile[4], true);
    assert.ok(profile[3] > 0n);
  });

  it("isolates profiles by msg.sender and permits duplicate nicknames", async () => {
    const registry = await deployRegistry();
    const [, alice, bob] = wallets;
    await registry.write.setProfile(["邻友", "", "Alice"], {
      account: alice.account,
    });
    await registry.write.setProfile(["邻友", "", "Bob"], {
      account: bob.account,
    });

    assert.equal((await registry.read.getProfile([alice.account.address]))[2], "Alice");
    assert.equal((await registry.read.getProfile([bob.account.address]))[2], "Bob");
  });

  it("updates an existing profile without affecting another account", async () => {
    const registry = await deployRegistry();
    const [, alice, bob] = wallets;
    await registry.write.setProfile(["Alice", "", "v1"], {
      account: alice.account,
    });
    await registry.write.setProfile(["Bob", "", "stable"], {
      account: bob.account,
    });
    await registry.write.setProfile(["Alice v2", "ipfs://avatar", "v2"], {
      account: alice.account,
    });

    const aliceProfile = await registry.read.getProfile([alice.account.address]);
    const bobProfile = await registry.read.getProfile([bob.account.address]);
    assert.deepEqual(aliceProfile.slice(0, 3), ["Alice v2", "ipfs://avatar", "v2"]);
    assert.equal(bobProfile[2], "stable");
  });

  it("allows an owner to clear their own profile", async () => {
    const registry = await deployRegistry();
    const [, alice] = wallets;
    await registry.write.setProfile(["Alice", "", "bio"], {
      account: alice.account,
    });
    await registry.write.clearProfile({ account: alice.account });

    assert.deepEqual(await registry.read.getProfile([alice.account.address]), [
      "",
      "",
      "",
      0n,
      false,
    ]);
    await assert.rejects(
      registry.write.clearProfile({ account: alice.account }),
      /ProfileNotFound/,
    );
  });

  it("rejects an entirely empty profile", async () => {
    const registry = await deployRegistry();
    await assert.rejects(registry.write.setProfile(["", "", ""]), /EmptyProfile/);
  });

  it("enforces byte limits for nickname, avatar URI and bio", async () => {
    const registry = await deployRegistry();
    await assert.rejects(
      registry.write.setProfile(["a".repeat(65), "", ""]),
      /FieldTooLong/,
    );
    await assert.rejects(
      registry.write.setProfile(["Alice", "a".repeat(513), ""]),
      /FieldTooLong/,
    );
    await assert.rejects(
      registry.write.setProfile(["Alice", "", "你".repeat(171)]),
      /FieldTooLong/,
    );
    await registry.write.setProfile(["a".repeat(64), "a".repeat(512), "a".repeat(512)]);
  });
});
