import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const YoulinGenesisModule = buildModule("YoulinGenesisModule", (m) => {
  const admin = m.getAccount(0);
  const reputationAddress = m.getParameter(
    "reputationAddress",
    "0x3f3C0f177C4076aCb9be40198d9Ff93a74D5a3c3",
  );
  const participationAddress = m.getParameter(
    "participationAddress",
    "0xa8B7b596b9ebcA4Eb8BF6d9f95Ef68DcEB758CeF",
  );
  const votingDuration = m.getParameter("votingDuration", 600);
  const perAddressCap = m.getParameter(
    "perAddressCap",
    100_000_000_000_000_000_000n,
  );

  const reputation = m.contractAt(
    "YoulinReputation",
    reputationAddress,
  );
  const participation = m.contractAt(
    "YoulinParticipation",
    participationAddress,
  );
  const genesisTreasury = m.contract("YoulinGenesisTreasury", [
    admin,
    reputation,
    participation,
    votingDuration,
    perAddressCap,
  ]);

  const reputationProtocolRole = m.staticCall(
    reputation,
    "PROTOCOL_ROLE",
    [],
  );
  const participationProtocolRole = m.staticCall(
    participation,
    "PROTOCOL_ROLE",
    [],
  );

  m.call(
    reputation,
    "grantRole",
    [reputationProtocolRole, genesisTreasury],
    { id: "GrantGenesisReputationProtocolRole" },
  );
  m.call(
    participation,
    "grantRole",
    [participationProtocolRole, genesisTreasury],
    { id: "GrantGenesisParticipationProtocolRole" },
  );

  return { genesisTreasury, reputation, participation };
});

export default YoulinGenesisModule;
