import { Configuration } from "@alephium/cli";

// OpenABX contract toolchain configuration.
// Pinned to @alephium/cli v3.0.3 (post-Danube hard fork, 2025-07-15).

const configuration: Configuration = {
  sourceDir: "contracts",
  artifactDir: "artifacts",
  networks: {
    devnet: {
      nodeUrl: "http://127.0.0.1:22973",
      networkId: 4,
      privateKeys: [
        // Well-known test key; produced by `alephium devnet start`. NEVER use on testnet or mainnet.
        "a642942e67258589cd2b1822c631506632db5a12aabcf413604e785300d762a5",
      ],
      confirmations: 1,
      settings: {},
    },
    testnet: {
      nodeUrl: "https://node.testnet.alephium.org",
      networkId: 1,
      privateKeys: process.env.TESTNET_PRIVATE_KEYS?.split(",") ?? [],
      confirmations: 2,
      settings: {},
    },
    mainnet: {
      // We do NOT deploy contracts to mainnet — AlphBanX's are already there.
      // This entry exists only so deploy scripts fail loudly rather than silently.
      nodeUrl: "https://node.mainnet.alephium.org",
      networkId: 0,
      privateKeys: [],
      confirmations: 3,
      settings: {},
    },
  },
  compilerOptions: {
    errorOnWarnings: true,
    ignoreUnusedConstantsWarnings: false,
  },
};

export default configuration;
