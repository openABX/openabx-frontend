// Scanner that surfaces active AlphBanX loans on mainnet — for the
// /liquidate candidate list and the /redeem target picker. Walks recent
// transactions to discover borrower addresses, then for each borrower
// fetches their Loan sub-contract state and computes CR.
//
// This is intentionally bounded (20 recent txs × 1 lookup per borrower)
// so it doesn't hammer the node. Run as a background refresh every 60s on
// the /liquidate or /redeem pages.

import {
  addressFromContractId,
  binToHex,
  contractIdFromAddress,
} from "@alephium/web3";
import { getNetworkConfig, type Network } from "../networks";
import { resolveAddress } from "../addresses";

const BACKEND = "https://backend.mainnet.alephium.org";

export interface LoanSnapshot {
  owner: string;
  loanAddress: string;
  collateralAlphAtto: bigint;
  debtAbdAtto: bigint;
  interestRatePercent: number;
  /** CR in basis points: 20000 = 200% (the MCR threshold). */
  crBps: number | null;
  /** Convenience: true if debt > 0 AND CR < MCR (200%). */
  liquidatable: boolean;
}

interface ExplorerTx {
  hash: string;
  inputs?: Array<{ address?: string; contractInput: boolean }>;
}

async function fetchRecentBorrowers(
  nodeUrl: string,
  loanManagerAddress: string,
  limit: number,
): Promise<Set<string>> {
  void nodeUrl;
  try {
    const res = await fetch(
      `${BACKEND}/addresses/${loanManagerAddress}/transactions?page=1&limit=${limit}`,
    );
    if (!res.ok) return new Set();
    const txs = (await res.json()) as ExplorerTx[];
    const borrowers = new Set<string>();
    for (const tx of txs) {
      for (const inp of tx.inputs ?? []) {
        if (!inp.contractInput && inp.address) borrowers.add(inp.address);
      }
    }
    return borrowers;
  } catch {
    return new Set();
  }
}

async function fetchLoanSnapshotFor(
  nodeUrl: string,
  loanManagerAddress: string,
  borrower: string,
  alphUsd1e18: bigint | null,
): Promise<LoanSnapshot | null> {
  try {
    // LoanManager.mi=23(address) → user's Loan sub id
    const body = JSON.stringify({
      group: 0,
      address: loanManagerAddress,
      methodIndex: 23,
      args: [{ type: "Address", value: borrower }],
    });
    const res = await fetch(`${nodeUrl}/contracts/call-contract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      type: string;
      returns?: Array<{ type: string; value: string }>;
    };
    if (json.type !== "CallContractSucceeded") return null;
    const idHex = json.returns?.[0]?.value;
    if (!idHex || idHex.length !== 64) return null;
    const loanAddress = addressFromContractId(idHex);

    const stateRes = await fetch(`${nodeUrl}/contracts/${loanAddress}/state`);
    if (!stateRes.ok) return null;
    const state = (await stateRes.json()) as {
      mutFields: Array<{ type: string; value: string }>;
    };
    const u256 = (i: number): bigint =>
      state.mutFields[i]?.type === "U256"
        ? BigInt(state.mutFields[i]!.value)
        : 0n;
    const rate = Number(u256(1));
    const collateral = u256(3);
    const debt = u256(4);

    let crBps: number | null = null;
    let liquidatable = false;
    if (debt > 0n && alphUsd1e18 && alphUsd1e18 > 0n) {
      // collateral is atto-ALPH (×1e18), price is USD/ALPH ×1e18, debt is
      // atto-ABD (×1e9) and 1 ABD targets $1:
      //   collUsd × 1e18 = collateral × price / 1e18
      //   debtUsd × 1e18 = debt × 1e9
      //   CR_bps = collUsd × 10000 / debtUsd
      const ONE_E18 = 1_000_000_000_000_000_000n;
      const collUsd1e18 = (collateral * alphUsd1e18) / ONE_E18;
      const debtUsd1e18 = debt * 1_000_000_000n;
      if (debtUsd1e18 > 0n) {
        const raw = (collUsd1e18 * 10_000n) / debtUsd1e18;
        crBps = raw > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(raw);
      }
      liquidatable = crBps != null && crBps < 20_000;
    }

    return {
      owner: borrower,
      loanAddress,
      collateralAlphAtto: collateral,
      debtAbdAtto: debt,
      interestRatePercent: rate,
      crBps,
      liquidatable,
    };
  } catch {
    return null;
  }
}

/**
 * Scan up to `limit` recent borrowers; return their current snapshots.
 * Useful for the /liquidate and /redeem target pickers. Expensive (many
 * HTTP round-trips); cache at the UI layer.
 */
export async function scanMainnetLoans(
  network: Network,
  alphUsd1e18: bigint | null,
  limit = 30,
): Promise<LoanSnapshot[]> {
  const lm = resolveAddress(network, "loanManager");
  if (!lm) return [];
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const borrowers = await fetchRecentBorrowers(nodeUrl, lm, limit);
  const results: LoanSnapshot[] = [];
  for (const b of borrowers) {
    const s = await fetchLoanSnapshotFor(nodeUrl, lm, b, alphUsd1e18);
    if (s && s.debtAbdAtto > 0n) results.push(s);
  }
  return results;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _keepAlive = { binToHex, contractIdFromAddress };
