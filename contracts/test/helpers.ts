// Shared test utilities. Keeping these tiny and explicit — the sandboxed
// test-contract API has enough ceremony already.

import { randomBytes } from "node:crypto";
import {
  addressFromContractId,
  binToHex,
  ONE_ALPH,
  stringToHex,
  web3,
} from "@alephium/web3";
import { PrivateKeyWallet } from "@alephium/web3-wallet";
import { testAddress } from "@alephium/web3-test";

const NODE_URL =
  process.env["ALEPHIUM_TEST_NODE_URL"] ?? "https://node.testnet.alephium.org";

export function setupTestProvider(): void {
  web3.setCurrentNodeProvider(NODE_URL, undefined, fetch);
}

/** Deterministic caller address (the canonical `testAddress` from web3-test). */
export const aliceAddress = testAddress;

/** A second, random asset-address caller for access-control tests. */
export const bobAddress = PrivateKeyWallet.Random(0).address;

/** Typical `inputAssets` entry pinning an ALPH balance to an asset address. */
export function inputFrom(
  address: string,
  alph: bigint = ONE_ALPH,
): { address: string; asset: { alphAmount: bigint } } {
  return { address, asset: { alphAmount: alph } };
}

export const hexString = stringToHex;

/** Max U256 — used as the issuance cap for open-ended tokens (ABD). */
export const U256_MAX = 2n ** 256n - 1n;

/** Fixed total supply for ABX: 100,000,000 at 9 decimals. */
export const ABX_TOTAL_SUPPLY = 100_000_000n * 10n ** 9n;

/** 1e18 — the canonical precision scale used throughout the protocol. */
export const PRECISION_1E18 = 10n ** 18n;

/**
 * Generate a test contract id + matching contract address + a token id that
 * equals the contract id (Alephium's convention: token_id == contract_id of
 * the contract that issued it). Use when testing a contract that issues its
 * own fungible token and needs the vault to be pre-populated with that
 * token.
 */
export function fungibleTestContract(): {
  contractId: string;
  contractAddress: string;
  tokenId: string;
} {
  const contractId = binToHex(randomBytes(32));
  const contractAddress = addressFromContractId(contractId);
  return { contractId, contractAddress, tokenId: contractId };
}
