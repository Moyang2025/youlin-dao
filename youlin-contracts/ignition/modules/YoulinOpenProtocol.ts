import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const REPUTATION = "0x3f3C0f177C4076aCb9be40198d9Ff93a74D5a3c3";
const PARTICIPATION = "0xa8B7b596b9ebcA4Eb8BF6d9f95Ef68DcEB758CeF";
const LEGACY_PROJECT_COUNT = 8;

export default buildModule("YoulinOpenProtocolModule", (m) => {
  const admin = m.getAccount(0);
  const reputation = m.contractAt("YoulinReputation", REPUTATION);
  const participation = m.contractAt("YoulinParticipation", PARTICIPATION);

  const protocol = m.contract("YoulinProtocol", [
    admin,
    reputation,
    participation,
    60,
    120,
    120,
    180,
    180,
    1_000_000_000_000_000_000n,
    500_000_000_000_000_000n,
    6_000,
    3,
    LEGACY_PROJECT_COUNT,
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

  m.call(reputation, "grantRole", [reputationProtocolRole, protocol], {
    id: "GrantOpenProtocolReputationRole",
  });
  m.call(participation, "grantRole", [participationProtocolRole, protocol], {
    id: "GrantOpenProtocolParticipationRole",
  });

  return { protocol, reputation, participation };
});
