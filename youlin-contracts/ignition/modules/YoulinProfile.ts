import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const YoulinProfileModule = buildModule("YoulinProfileModule", (m) => {
  const profileRegistry = m.contract("YoulinProfileRegistry");
  return { profileRegistry };
});

export default YoulinProfileModule;
