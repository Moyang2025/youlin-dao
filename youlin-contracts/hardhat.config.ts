import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import "dotenv/config";

const privateKey = process.env.PRIVATE_KEY ?? "";
const etherscanApiKey = process.env.ETHERSCAN_API_KEY ?? "";
const monadTestnetRpcUrl =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const soliditySettings = {
  evmVersion: "prague",
  optimizer: {
    enabled: true,
    runs: 200,
  },
  viaIR: true,
  metadata: {
    bytecodeHash: "ipfs",
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: soliditySettings,
      },
      production: {
        version: "0.8.28",
        settings: soliditySettings,
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      allowUnlimitedContractSize: true,
    },
    monadTestnet: {
      type: "http",
      url: monadTestnetRpcUrl,
      accounts: privateKey ? [privateKey] : [],
      chainId: 10143,
    },
  },
  verify: {
    blockscout: {
      enabled: false,
    },
    etherscan: {
      enabled: true,
      apiKey: etherscanApiKey,
    },
    sourcify: {
      enabled: true,
      apiUrl: "https://sourcify-api-monad.blockvision.org",
    },
  },
  chainDescriptors: {
    10143: {
      name: "MonadTestnet",
      blockExplorers: {
        etherscan: {
          name: "Monadscan",
          url: "https://testnet.monadscan.com",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },
});
