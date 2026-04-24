#!/usr/bin/env tsx
/**
 * Scan BorrowerOperations + LoanManager activity to separate redeem /
 * liquidate from repay / closeLoan. Distinguishing rule:
 *
 *   In redeem / liquidate, the TARGETED Loan sub-contract is NOT the
 *   signer's own. In repay / closeLoan, the targeted Loan sub IS the
 *   signer's.
 *
 * We:
 *   1. Pull recent LoanManager + BorrowerOperations txs.
 *   2. For each tx with a `scriptOpt` that calls BorrowerOperations:
 *      a. Decode the script, find the CallExternal(miX) on BorrowerOps.
 *      b. Compute the signer's own Loan sub id via LoanManager.mi=23.
 *      c. Compare vs the Loan sub-contract referenced in contractInputs.
 *      d. If mismatch → the op targets someone else's loan = redeem/liquidate.
 *   3. Classify further by token flow:
 *      - ABD-out, ALPH-in for signer → redeem
 *      - no ABD movement, permissionless caller → liquidate
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addressFromContractId,
  binToHex,
  codec,
  contractIdFromAddress,
  hexToBinUnsafe,
} from "@alephium/web3";

const BACKEND = "https://backend.mainnet.alephium.org";
const NODE = "https://node.mainnet.alephium.org";
const LOAN_MANAGER = "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB";
const BORROWER_OPS = "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF";
const BO_ID_HEX = binToHex(contractIdFromAddress(BORROWER_OPS));
const ABD_ID_HEX =
  "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500";

const scriptCodec = codec.script.scriptCodec;

interface ExplorerTx {
  hash: string;
  timestamp: number;
  scriptOpt?: string;
  inputs?: Array<{
    address?: string;
    contractInput: boolean;
    attoAlphAmount?: string;
    tokens?: Array<{ id: string; amount: string }>;
  }>;
  outputs?: Array<{
    type: string;
    address: string;
    attoAlphAmount?: string;
    tokens?: Array<{ id: string; amount: string }>;
  }>;
}

async function fetchTxs(addr: string, pages: number): Promise<ExplorerTx[]> {
  const all: ExplorerTx[] = [];
  for (let p = 1; p <= pages; p++) {
    const r = await fetch(
      `${BACKEND}/addresses/${addr}/transactions?page=${p}&limit=100`,
    );
    if (!r.ok) break;
    const batch = (await r.json()) as ExplorerTx[];
    all.push(...batch);
    if (batch.length < 100) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return all;
}

async function getSignerLoanId(signer: string): Promise<string | null> {
  const r = await fetch(`${NODE}/contracts/call-contract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group: 0,
      address: LOAN_MANAGER,
      methodIndex: 23,
      args: [{ type: "Address", value: signer }],
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    type: string;
    returns?: Array<{ type: string; value: string }>;
  };
  if (j.type !== "CallContractSucceeded") return null;
  const v = j.returns?.[0]?.value;
  return v && v.length === 64 ? v : null;
}

/**
 * Extract (methodIndex, loanSubId) pair from a scriptOpt — assuming the
 * script's structure is: push args, push contract id (32-byte BytesConst),
 * CallExternal(bo_mi). If the script pre-pushes a Loan sub id before the
 * BO call, that id is the "targeted loan".
 */
function extractBoCall(
  scriptOpt: string,
): { mi: number; loanId: string | null } | null {
  try {
    const script = scriptCodec.decode(hexToBinUnsafe(scriptOpt));
    for (const m of script.methods) {
      const bytesPushes: string[] = [];
      for (const ins of m.instrs) {
        if (ins.name === "BytesConst") {
          const v = (ins as { value?: unknown }).value;
          const hex =
            v instanceof Uint8Array
              ? binToHex(v)
              : typeof v === "string"
                ? v
                : "";
          if (hex.length === 64) bytesPushes.push(hex);
        } else if (ins.name === "CallExternal") {
          const mi = (ins as { index: number }).index;
          const target = bytesPushes[bytesPushes.length - 1] ?? null;
          if (target === BO_ID_HEX) {
            // The Loan sub id is the PENULTIMATE 32-byte push (the arg
            // before BO_ID). If only 1 bytes push, no loan arg (likely
            // closeLoan taking no args).
            const loanId = bytesPushes[bytesPushes.length - 2] ?? null;
            return { mi, loanId };
          }
        }
      }
    }
  } catch {
    /* skip */
  }
  return null;
}

function tokenDelta(
  tx: ExplorerTx,
  addr: string,
): { abd: bigint; alph: bigint } {
  let abd = 0n;
  let alph = 0n;
  for (const inp of tx.inputs ?? []) {
    if (inp.contractInput || inp.address !== addr) continue;
    alph -= BigInt(inp.attoAlphAmount ?? "0");
    for (const t of inp.tokens ?? [])
      if (t.id === ABD_ID_HEX) abd -= BigInt(t.amount);
  }
  for (const o of tx.outputs ?? []) {
    if (o.address !== addr) continue;
    alph += BigInt(o.attoAlphAmount ?? "0");
    for (const t of o.tokens ?? [])
      if (t.id === ABD_ID_HEX) abd += BigInt(t.amount);
  }
  return { abd, alph };
}

async function main(): Promise<void> {
  console.log("Pulling LoanManager + BorrowerOperations txs…");
  const lmTxs = await fetchTxs(LOAN_MANAGER, 5);
  const boTxs = await fetchTxs(BORROWER_OPS, 3);
  const txsByHash = new Map<string, ExplorerTx>();
  for (const t of [...lmTxs, ...boTxs]) txsByHash.set(t.hash, t);
  console.log(`  ${txsByHash.size} unique txs`);

  const loanIdCache = new Map<string, string | null>();

  interface Observation {
    txId: string;
    signer: string;
    mi: number;
    classification: string;
    delta: { abd: string; alph: string };
    targetedLoanId: string;
    signersOwnLoanId: string | null;
  }

  const observations: Observation[] = [];

  for (const tx of txsByHash.values()) {
    if (!tx.scriptOpt) continue;
    const signer = tx.inputs?.find(
      (i) => !i.contractInput && i.address,
    )?.address;
    if (!signer) continue;
    const call = extractBoCall(tx.scriptOpt);
    if (!call) continue;

    if (!loanIdCache.has(signer)) {
      loanIdCache.set(signer, await getSignerLoanId(signer));
      await new Promise((r) => setTimeout(r, 60));
    }
    const signerOwnLoan = loanIdCache.get(signer) ?? null;
    const delta = tokenDelta(tx, signer);
    const ownLoan = signerOwnLoan === call.loanId;
    const abdOut = delta.abd < 0n;
    const alphIn = delta.alph > 10_000_000_000_000_000n; // > 0.01 ALPH ignoring gas

    let cls: string;
    if (call.mi === 11 || call.mi === 12) cls = "openLoan";
    else if (abdOut && alphIn && !ownLoan) cls = "redeem (cross-loan)";
    else if (abdOut && ownLoan) cls = "repay";
    else if (!abdOut && !alphIn && !ownLoan) cls = "liquidate?";
    else if (alphIn && !abdOut && ownLoan)
      cls = "closeLoan / withdrawCollateral";
    else cls = "unknown";

    observations.push({
      txId: tx.hash,
      signer,
      mi: call.mi,
      classification: cls,
      delta: { abd: delta.abd.toString(), alph: delta.alph.toString() },
      targetedLoanId: call.loanId ?? "none",
      signersOwnLoanId: signerOwnLoan,
    });
  }

  // Tally: mi → classification distribution
  const tally: Record<number, Record<string, number>> = {};
  for (const o of observations) {
    tally[o.mi] ??= {};
    tally[o.mi]![o.classification] = (tally[o.mi]![o.classification] ?? 0) + 1;
  }
  console.log("\n--- mi → classification distribution ---");
  for (const mi of Object.keys(tally).sort((a, b) => +a - +b)) {
    console.log(`  mi=${mi}:`);
    for (const [cls, n] of Object.entries(tally[+mi]!)) {
      console.log(`    ${cls}: ${n}`);
    }
  }

  // Surface candidate redeem + liquidate tx ids per mi
  console.log("\n--- Sample txs per classification ---");
  const bests: Record<string, Observation[]> = {};
  for (const o of observations) {
    bests[o.classification] ??= [];
    if (bests[o.classification]!.length < 3) bests[o.classification]!.push(o);
  }
  for (const [cls, arr] of Object.entries(bests)) {
    console.log(`  ${cls}:`);
    for (const o of arr) {
      console.log(
        `    tx=${o.txId.slice(0, 14)}… mi=${o.mi} signer=${o.signer.slice(
          0,
          14,
        )}… targetsOwn=${o.signersOwnLoanId === o.targetedLoanId} Δabd=${o.delta.abd} Δalph=${o.delta.alph}`,
      );
    }
  }

  const outPath = join(
    dirname(new URL(import.meta.url).pathname),
    "..",
    "references",
    "redeem-liquidate-scan.json",
  );
  writeFileSync(outPath, JSON.stringify(observations, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
  void addressFromContractId;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
