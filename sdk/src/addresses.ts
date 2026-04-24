// Per-network contract address inventory.
//
// testnet addresses come from the GitBook smart-contract-addresses page
// (confirmed 2026-04-22 by GET /contracts/{addr}/state against
// node.testnet.alephium.org v4.5.1).
//
// mainnet addresses derived during Phase 0 by walking on-chain state from the
// Alephium token-list entries for ABD and ABX. See
// references/alphbanx-contract-addresses.md for the full provenance trail and
// confidence ratings. Medium-confidence mainnet roles (StakeManager, Vesting,
// BorrowerOperations) remain unlabeled until Phase 1 can call into them and
// observe signatures.
//
// devnet addresses are populated at `pnpm deploy:devnet` time into
// contracts/deployments/devnet.json; this module reads that file at runtime
// when `network === 'devnet'`. See `loadDevnetAddresses`.

import type { Network } from "./networks";

export type ContractRole =
  | "abdToken"
  | "abxToken"
  | "loanManager"
  | "borrowerOperations"
  | "auctionManager"
  | "auctionPool5"
  | "auctionPool10"
  | "auctionPool15"
  | "auctionPool20"
  | "stakeManager"
  | "vesting"
  | "platformSettings"
  | "diaAlphPriceAdapter"
  | "abdPriceOracle"
  | "circuitBreaker"
  | "admin";

export type AddressBook = Partial<Record<ContractRole, string>>;

const TESTNET_ADDRESSES: AddressBook = {
  loanManager: "26y5AztUG2ka985W1qYzHjvd2CocDjfSGJQm9TqmiGhE7",
  borrowerOperations: "26wzoN8h59CNgc11nFqsQx5BEQhq3LC8acnGMjqJjQrhu",
  abdToken: "2AEnwNzccQ3ymXLkEKqnk8Tr3pLbEoYzBtKwsiRRoy79y",
  abdPriceOracle: "wtL6PCHvbpgu3uyDzqeeg7GDSBS4U54X1mj8Bmzxd1ZH",
  diaAlphPriceAdapter: "2APkRx4AkYnHxQHp2cEUeCQgB2QGKzjwkHx9vY68XSHps",
  // Not yet deployed to AlphBanX testnet as of 2026-04-22 (per GitBook):
  // abxToken, auctionManager, stakeManager, vesting, platformSettings
};

const MAINNET_ADDRESSES: AddressBook = {
  // High-confidence (verified 2026-04-22)
  abdToken: "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K",
  abxToken: "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV",
  loanManager: "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
  auctionManager: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
  platformSettings: "21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf",
  diaAlphPriceAdapter: "2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7",
  abdPriceOracle: "28Nju5bkxygKQp3SEw29jELwgTL4zpJZjwXNgaUzU3otT",
  admin: "1Fcq1KfXTVj3EyxncDgTmtrQzDWGWF5sXKojXZYDdxoho",
  // High-confidence (derived 2026-04-23 by observing user-originating
  // transactions via scripts/observe-alphbanx-writes.ts — 87 txs call this
  // address with method indices matching a BorrowerOperations-shaped API).
  borrowerOperations: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
  // High-confidence (derived 2026-04-23 by live decoding of a user-confirmed
  // stake tx, 9838896456fa957b8fb9f12f3c7adabe707e05c597fd8537d01d613ba7e4580d:
  // APS-approved ABX + ALPH flowed here via CallExternal[30]; per-user
  // subcontract lookup at method 23; minimal-deposit query at method 28.
  // See docs/07-mainnet-write-path.md for method-index table).
  stakeManager: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
  // High-confidence per-tier AuctionPool sub-contract addresses, discovered
  // 2026-04-24 via `AuctionManager.mi=30(tierBps/100) → ByteVec` (returns the
  // pool sub id). Cross-verified by reading each pool's asset + mut state.
  auctionPool5: "2ACCN5Tctta3CADpZxuVd2eV8iV7tUoNTX3uzw31gGbuh",
  auctionPool10: "2BSx7P6xZug8JsjmjCKPdiSowZQWapAktHn8a3VFoAPuR",
  auctionPool15: "28BeXPu7nTUgriWSHbN1NkGG9Zm3xmyZqfKWZkLXi79dy",
  auctionPool20: "vLsZf6pkDAUkmvrViDtZJqKCPNAnXKZ1Uwo6cAqNijjV",
  // Medium-confidence — role partially-observed, method indices collected in
  // references/alphbanx-mainnet-methods.json. NOT exported yet until the
  // role is confirmed:
  //   24nvcVvScyWY1tJKMepAABwVnAVXP7KsjVrqmc4jAhD11   (2574 bytes; candidate Vesting)
  //   uHKrQGuTtoRwR6ahAUhwdvrdcg4YVNq3BsVd4frLExLX   (1988 bytes; candidate Vesting)
  //   vh9fQ2PRGBzSuckm6yE8crpSzVM1frzRhwkWwnFDitfH   (450 bytes; small helper)
  //   22qGq3kq2QMCnX4HwXc9bt2AzRjwoGRmXS4Qoc687rLYf   (1178 bytes; possibly internal helper)
  //   211mQVddZ3SEv5dZu33E9RAvDFDKPkZdZUkJp6eMEHUxo   (seen in auction+loan scripts)
};

let devnetCache: AddressBook | null = null;

function loadDevnetAddresses(): AddressBook {
  if (devnetCache !== null) return devnetCache;
  // In the browser, static config must be baked at build time. At Phase 1 the
  // devnet deploy script writes contracts/deployments/devnet.json; higher-level
  // packages set this via setDevnetAddresses() before calling resolve().
  devnetCache = {};
  return devnetCache;
}

/**
 * Explicitly overwrite the devnet address map. Called by deploy scripts and by
 * test fixtures. Does NOT affect testnet or mainnet maps.
 */
export function setDevnetAddresses(addresses: AddressBook): void {
  devnetCache = { ...addresses };
}

export function resolveAddresses(network: Network): AddressBook {
  switch (network) {
    case "devnet":
      return loadDevnetAddresses();
    case "testnet":
      return TESTNET_ADDRESSES;
    case "mainnet":
      return MAINNET_ADDRESSES;
  }
}

export function resolveAddress(
  network: Network,
  role: ContractRole,
): string | undefined {
  return resolveAddresses(network)[role];
}

/**
 * Throwing variant for code paths that cannot meaningfully proceed without the
 * address (e.g., a "place a bid" UI flow).
 */
export function requireAddress(network: Network, role: ContractRole): string {
  const addr = resolveAddress(network, role);
  if (!addr) {
    throw new Error(
      `OpenABX SDK: ${role} has no known address on ${network}. If this is devnet, ` +
        "ensure the deploy script ran and called setDevnetAddresses. " +
        "If testnet/mainnet, this role may not yet be identified — see " +
        "references/alphbanx-contract-addresses.md.",
    );
  }
  return addr;
}
