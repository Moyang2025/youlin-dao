import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const YoulinModule = buildModule("YoulinModule", (m) => {
  const admin = m.getAccount(0);

  const reputation = m.contract("YoulinReputation", [admin]);
  const participation = m.contract("YoulinParticipation", [
    admin,
    "ipfs://youlin/{id}.json",
  ]);
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
    [reputationProtocolRole, protocol],
    { id: "GrantReputationProtocolRole" },
  );
  m.call(
    participation,
    "grantRole",
    [participationProtocolRole, protocol],
    { id: "GrantParticipationProtocolRole" },
  );

  return { reputation, participation, protocol };
});

export default YoulinModule;
