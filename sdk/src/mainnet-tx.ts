// Low-level mainnet write-path builder. Produces TxScript bytecode that calls
// AlphBanX's mainnet contracts by explicit (address, methodIndex, args). Used
// by @openabx/web once a mainnet method-index → operation mapping is
// confirmed from on-chain observation (see docs/07-mainnet-write-path.md).
//
// This module intentionally exports raw primitives rather than named
// operations ("openLoan", "repay", ...) — those names will be wired in once
// we've confirmed each method index via simulation against a real tx. Until
// then, unsafe-looking primitives are the honest API.
//
// Submission path: consumers use @alephium/web3's SignerProvider to sign and
// submit the produced bytecode. This module never talks to a wallet directly.

import type { SignerProvider } from "@alephium/web3";
import {
  binToHex,
  codec,
  contractIdFromAddress,
  hexToBinUnsafe,
} from "@alephium/web3";

/** Argument variants for an external method call. */
export type MainnetArg =
  | { type: "u256"; value: bigint }
  | { type: "address"; value: string } // base58 address
  | { type: "bytes"; value: string } // hex
  | { type: "boolean"; value: boolean };

/** APS approval inputs for the script call. */
export interface MainnetApproval {
  /** atto-ALPH amount to approve into the contract (0 = none). */
  alphAtto?: bigint;
  /** tokens the script approves into the contract. */
  tokens?: Array<{ idHex: string; amount: bigint }>;
}

export interface BuildMainnetCallInput {
  /** Base58 contract address of the target. */
  contractAddress: string;
  /** Method index inside the target contract. */
  methodIndex: number;
  /** Arguments pushed to the stack in order. */
  args: MainnetArg[];
  /** APS approval set. */
  approvals?: MainnetApproval;
}

/**
 * Encode a TxScript that makes a single CallExternal to the target contract.
 *
 * Emits (roughly) the same bytecode shape the compiler produces for
 *
 *   CallContract(targetAddress).method{sender -> ALPH: a, token: t}(args...)
 *
 * inside a Ralph @TxScript. Callers MUST confirm the (contract, methodIndex,
 * arg types) mapping against an observed tx via /contracts/call-tx-script
 * before wiring this into a user-facing button.
 *
 * NOTE: this function intentionally lives in `@openabx/sdk` rather than in
 * `web/` so the indexer + e2e fixtures can reuse it for simulation tests.
 */
export function buildMainnetCallBytecode(
  _input: BuildMainnetCallInput,
): string {
  // Implementation lands alongside the per-method wiring PRs
  // (docs/07-mainnet-write-path.md §"remaining work"). The skeleton below
  // documents the shape; throwing until the full encoder lands is safer than
  // shipping a partial builder that might emit incorrect APS approvals.
  throw new Error(
    "buildMainnetCallBytecode not yet implemented — see " +
      "docs/07-mainnet-write-path.md for the enablement plan. Until then, " +
      "mainnet writes are disabled in the frontend by canTransact(network).",
  );
}

/**
 * Convenience: submit a built mainnet TxScript via a SignerProvider. Thin
 * wrapper so higher-level helpers can be one-liners once buildMainnetCallBytecode
 * lands.
 */
export async function submitMainnetCall(
  signer: SignerProvider,
  input: BuildMainnetCallInput,
  attoAlphAmount: bigint = 0n,
): Promise<{ txId: string }> {
  const account = await signer.getSelectedAccount();
  const bytecode = buildMainnetCallBytecode(input);
  const res = await signer.signAndSubmitExecuteScriptTx({
    signerAddress: account.address,
    bytecode,
    attoAlphAmount: attoAlphAmount.toString(),
    tokens: (input.approvals?.tokens ?? []).map((t) => ({
      id: t.idHex,
      amount: t.amount.toString(),
    })),
  });
  return { txId: res.txId };
}

// Exposed for validation + future unit tests.
export const __internal = {
  scriptCodec: codec.script.scriptCodec,
  contractIdFromAddress: (addr: string): string =>
    binToHex(contractIdFromAddress(addr)),
  hexToBin: hexToBinUnsafe,
};
