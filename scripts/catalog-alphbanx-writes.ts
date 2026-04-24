#!/usr/bin/env tsx
/**
 * Scan mainnet for recent AlphBanX write-path transactions and classify them
 * by combining scriptOpt decoding with token-flow analysis.
 *
 * For each tx hitting BorrowerOperations / StakeManager / AuctionManager /
 * LoanManager, we compute:
 *   - `tokenDelta` — net ABD, ABX, ALPH change for the user wallet
 *   - `methodIndex` — target of the single CallExternal in the TxScript that
 *     hits the contract of interest
 *   - `apsApproved` — roughly, the pre-call ApproveAlph / ApproveToken pattern
 *
 * Then we classify by rules:
 *   BorrowerOperations:
 *     ABD +, ALPH - → openLoan / borrowMore
 *     ABD -, ALPH + → repay / closeLoan
 *     ABD - only    → redeem
 *     ALPH +, no token → liquidate (liquidator gets refund)
 *     ALPH - only, no token change → addCollateral / withdrawCollateral
 *   StakeManager:
 *     ABX -         → stake
 *     ABX +         → claimUnstake
 *     ALPH + only   → claim (rewards)
 *     nothing moves, but ABX is approved at 0 → requestUnstake
 *   AuctionManager / AuctionPool:
 *     ABD -, ALPH -approval → deposit
 *     ABD + → withdraw
 *     ALPH + only → claim
 *
 * The output is `references/alphbanx-operation-map.json` — an ordered table
 * per contract of `{methodIndex -> {operation, confidence, sampleTxIds}}`,
 * ready to be hand-reviewed and promoted into the write wiring.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addressFromContractId,
  binToHex,
  codec,
  contractIdFromAddress,
  hexToBinUnsafe,
} from "@alephium/web3";

const BACKEND_URL = "https://backend.mainnet.alephium.org";
const NODE_URL = "https://node.mainnet.alephium.org";
const scriptCodec = codec.script.scriptCodec;

const OUT_PATH = join(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "references",
  "alphbanx-operation-map.json",
);

const ABD_ID_HEX = binToHex(
  contractIdFromAddress("288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K"),
);
const ABX_ID_HEX = binToHex(
  contractIdFromAddress("258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV"),
);

// Contracts we're cataloguing.
interface TargetContract {
  address: string;
  role: string;
  /** Which family of operations to check against. */
  family: "borrower" | "stake" | "auction" | "loan";
}

const TARGETS: TargetContract[] = [
  {
    address: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    role: "borrowerOperations",
    family: "borrower",
  },
  {
    address: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    role: "stakeManager",
    family: "stake",
  },
  {
    address: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    role: "auctionManager",
    family: "auction",
  },
  {
    address: "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
    role: "loanManager",
    family: "loan",
  },
];

// Additional scan sources — the explorer backend indexes txs that list an
// address as an input/output. Some contracts (BorrowerOperations) aren't
// listed on every write that targets them, so we also pull from the token
// contracts whose balances move on every borrow/redeem/deposit/etc.
const SCAN_SOURCES: string[] = [
  "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF", // borrowerOperations
  "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu", // stakeManager
  "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3", // auctionManager
  "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB", // loanManager
  "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K", // ABD token — every borrow+redeem touches this
  "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV", // ABX token — every stake+claim touches this
  // Vesting candidates — scanning these lets us identify which medium-confidence
  // address is the Vesting contract when we see an ABX-out-to-user pattern.
  "24nvcVvScyWY1tJKMepAABwVnAVXP7KsjVrqmc4jAhD11",
  "uHKrQGuTtoRwR6ahAUhwdvrdcg4YVNq3BsVd4frLExLX",
  "vh9fQ2PRGBzSuckm6yE8crpSzVM1frzRhwkWwnFDitfH",
  "22qGq3kq2QMCnX4HwXc9bt2AzRjwoGRmXS4Qoc687rLYf",
  "211mQVddZ3SEv5dZu33E9RAvDFDKPkZdZUkJp6eMEHUxo",
];

const LIMIT = 100; // per-page
const MAX_PAGES = 30; // scan up to 3,000 txs per contract
const TOTAL_BUDGET_MS = 5 * 60_000; // abort after 5 min wall-time

// Keep a set of known addresses so we don't report them as "unknown" callees.
const KNOWN_ADDRESSES = [
  "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K",
  "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV",
  "21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf",
  "2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7",
  "28Nju5bkxygKQp3SEw29jELwgTL4zpJZjwXNgaUzU3otT",
  ...TARGETS.map((t) => t.address),
];
const contractIdByAddress = new Map<string, string>();
const addressByContractId = new Map<string, string>();
for (const addr of KNOWN_ADDRESSES) {
  const id = binToHex(contractIdFromAddress(addr));
  contractIdByAddress.set(addr, id);
  addressByContractId.set(id, addr);
}

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

async function fetchTxsPage(
  address: string,
  page: number,
): Promise<ExplorerTx[]> {
  const url = `${BACKEND_URL}/addresses/${address}/transactions?page=${page}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return (await res.json()) as ExplorerTx[];
}

async function fetchAllRecent(
  address: string,
  maxPages: number,
  onProgress?: (page: number, total: number) => void,
): Promise<ExplorerTx[]> {
  const all: ExplorerTx[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let batch: ExplorerTx[];
    try {
      batch = await fetchTxsPage(address, page);
    } catch (err) {
      console.warn(`  page ${page} error: ${(err as Error).message}`);
      break;
    }
    if (batch.length === 0) break;
    all.push(...batch);
    onProgress?.(page, all.length);
    if (batch.length < LIMIT) break; // last page reached
    await new Promise((r) => setTimeout(r, 120));
  }
  return all;
}

// Find the one user wallet that was an asset input. Ignore contract inputs.
function userWalletOf(tx: ExplorerTx): string | null {
  const cands = tx.inputs?.filter((i) => !i.contractInput && i.address) ?? [];
  if (cands.length === 0) return null;
  // Use the first unique address — txs typically have one user signer.
  const uniq = [...new Set(cands.map((c) => c.address!))];
  return uniq[0] ?? null;
}

interface TokenDelta {
  alph: bigint;
  abd: bigint;
  abx: bigint;
}

function computeUserDelta(tx: ExplorerTx, user: string): TokenDelta {
  let alph = 0n;
  let abd = 0n;
  let abx = 0n;
  for (const inp of tx.inputs ?? []) {
    if (inp.contractInput) continue;
    if (inp.address !== user) continue;
    alph -= BigInt(inp.attoAlphAmount ?? "0");
    for (const t of inp.tokens ?? []) {
      if (t.id === ABD_ID_HEX) abd -= BigInt(t.amount);
      if (t.id === ABX_ID_HEX) abx -= BigInt(t.amount);
    }
  }
  for (const out of tx.outputs ?? []) {
    if (out.address !== user) continue;
    alph += BigInt(out.attoAlphAmount ?? "0");
    for (const t of out.tokens ?? []) {
      if (t.id === ABD_ID_HEX) abd += BigInt(t.amount);
      if (t.id === ABX_ID_HEX) abx += BigInt(t.amount);
    }
  }
  return { alph, abd, abx };
}

// Extract list of (targetAddress, methodIndex) pairs from a scriptOpt.
function extractCallExternals(
  scriptOpt: string,
): Array<{ address: string; methodIndex: number }> {
  const bytes = hexToBinUnsafe(scriptOpt);
  const script = scriptCodec.decode(bytes);
  const out: Array<{ address: string; methodIndex: number }> = [];
  for (const method of script.methods) {
    let lastBytes: string | null = null;
    for (const ins of method.instrs) {
      if (ins.name === "BytesConst") {
        const v = (ins as { value: unknown }).value;
        lastBytes =
          v instanceof Uint8Array
            ? binToHex(v)
            : typeof v === "string"
              ? v
              : null;
      } else if (ins.name === "CallExternal") {
        if (lastBytes && lastBytes.length === 64) {
          try {
            out.push({
              address: addressFromContractId(lastBytes),
              methodIndex: (ins as { index: number }).index,
            });
          } catch {
            /* ignore invalid */
          }
        }
        lastBytes = null;
      }
    }
  }
  return out;
}

type Operation =
  | "openLoan"
  | "borrowMore"
  | "repay"
  | "closeLoan"
  | "redeem"
  | "liquidate"
  | "addCollateral"
  | "withdrawCollateral"
  | "stake"
  | "requestUnstake"
  | "claimUnstake"
  | "claimRewards"
  | "poolDeposit"
  | "poolWithdraw"
  | "poolClaim"
  | "vestingClaim"
  | "unknown";

const DUST = 10_000_000_000_000_000n; // 0.01 ALPH ignored as gas/dust noise

interface Classification {
  operation: Operation;
  confidence: "high" | "medium" | "low";
  explanation: string;
}

function classify(
  family: TargetContract["family"],
  delta: TokenDelta,
): Classification {
  // Consider ALPH signs with DUST buffer to avoid gas-fee false positives.
  const alphIn = delta.alph > DUST;
  const alphOut = delta.alph < -DUST;
  const abdIn = delta.abd > 0n;
  const abdOut = delta.abd < 0n;
  const abxIn = delta.abx > 0n;
  const abxOut = delta.abx < 0n;

  if (family === "borrower") {
    if (abdIn && alphOut)
      return {
        operation: "openLoan",
        confidence: "high",
        explanation: "ABD minted to user, ALPH collateral out",
      };
    if (abdIn && !alphOut)
      return {
        operation: "borrowMore",
        confidence: "medium",
        explanation: "ABD minted to user, no net ALPH change",
      };
    if (abdOut && alphIn && !abxOut && !abxIn)
      return {
        operation: "closeLoan",
        confidence: "medium",
        explanation: "ABD burned, ALPH collateral returned",
      };
    if (abdOut && alphIn)
      return {
        operation: "redeem",
        confidence: "high",
        explanation: "ABD burned, ALPH received (no loan ownership required)",
      };
    if (abdOut && !alphIn)
      return {
        operation: "repay",
        confidence: "medium",
        explanation: "ABD flowed out, debt reduced",
      };
    if (!abdIn && !abdOut && alphOut)
      return {
        operation: "addCollateral",
        confidence: "medium",
        explanation: "ALPH flowed into loan, no ABD change",
      };
    if (!abdIn && !abdOut && alphIn)
      return {
        operation: "withdrawCollateral",
        confidence: "medium",
        explanation: "ALPH returned to user, no ABD change",
      };
    if (alphIn && !abdIn && !abdOut)
      return {
        operation: "liquidate",
        confidence: "low",
        explanation: "ALPH in, no ABD — candidate liquidate surplus refund",
      };
  } else if (family === "stake") {
    if (abxOut)
      return {
        operation: "stake",
        confidence: "high",
        explanation: "ABX flowed out of user wallet into StakeManager",
      };
    if (abxIn)
      return {
        operation: "claimUnstake",
        confidence: "high",
        explanation: "ABX returned to user wallet",
      };
    if (alphIn)
      return {
        operation: "claimRewards",
        confidence: "medium",
        explanation: "ALPH returned to user, no token move — rewards claim",
      };
    return {
      operation: "requestUnstake",
      confidence: "low",
      explanation: "no token move; candidate requestUnstake (starts cooldown)",
    };
  } else if (family === "auction") {
    if (abdOut)
      return {
        operation: "poolDeposit",
        confidence: "high",
        explanation: "ABD flowed out of user wallet into pool",
      };
    if (abdIn && !alphIn)
      return {
        operation: "poolWithdraw",
        confidence: "high",
        explanation: "ABD returned to user, no ALPH received",
      };
    if (abdIn && alphIn)
      return {
        operation: "poolWithdraw",
        confidence: "medium",
        explanation: "ABD returned + ALPH received — combined withdraw+claim?",
      };
    if (alphIn && !abdIn)
      return {
        operation: "poolClaim",
        confidence: "high",
        explanation: "ALPH returned with no ABD change — pool reward claim",
      };
  }
  return {
    operation: "unknown",
    confidence: "low",
    explanation: `unclassified — Δalph=${delta.alph}, Δabd=${delta.abd}, Δabx=${delta.abx}`,
  };
}

interface MethodClassification {
  operation: Operation;
  confidence: "high" | "medium" | "low";
  count: number;
  sampleTxIds: string[];
  explanation: string;
}

async function main(): Promise<void> {
  const perContract = new Map<
    string, // contract address
    {
      role: string;
      family: TargetContract["family"];
      methods: Map<number, Map<Operation, MethodClassification>>;
    }
  >();

  for (const t of TARGETS) {
    perContract.set(t.address, {
      role: t.role,
      family: t.family,
      methods: new Map(),
    });
  }

  const seenTxHashes = new Set<string>();
  const unknownCallees = new Map<
    string,
    {
      methodIndices: Map<number, number>;
      sampleTxIds: string[];
      userDeltaSignatures: string[];
    }
  >();
  const startedAt = Date.now();
  for (const src of SCAN_SOURCES) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      console.warn(
        `  wall-time budget exhausted — stopping scan at ${src.slice(0, 10)}…`,
      );
      break;
    }
    let txs: ExplorerTx[] = [];
    console.log(`[source ${src.slice(0, 10)}…] paginating…`);
    try {
      txs = await fetchAllRecent(src, MAX_PAGES, (page, total) => {
        if (page % 5 === 0) console.log(`  page ${page}: ${total} txs so far`);
      });
    } catch (err) {
      console.warn(
        `[source ${src.slice(0, 10)}…] fetch error: ${(err as Error).message}`,
      );
      continue;
    }
    console.log(`[source ${src.slice(0, 10)}…] scanning ${txs.length} txs`);

    for (const tx of txs) {
      if (!tx.scriptOpt) continue;
      if (seenTxHashes.has(tx.hash)) continue;
      seenTxHashes.add(tx.hash);

      const user = userWalletOf(tx);
      if (!user) continue;
      const delta = computeUserDelta(tx, user);

      let calls: Array<{ address: string; methodIndex: number }>;
      try {
        calls = extractCallExternals(tx.scriptOpt);
      } catch {
        continue;
      }

      // Track every unknown contract called by a tx — helps us discover
      // Vesting and AuctionPool addresses.
      for (const c of calls) {
        if (
          !addressByContractId.has(binToHex(contractIdFromAddress(c.address)))
        ) {
          const row = unknownCallees.get(c.address) ?? {
            methodIndices: new Map<number, number>(),
            sampleTxIds: [],
            userDeltaSignatures: [] as string[],
          };
          row.methodIndices.set(
            c.methodIndex,
            (row.methodIndices.get(c.methodIndex) ?? 0) + 1,
          );
          if (row.sampleTxIds.length < 5) row.sampleTxIds.push(tx.hash);
          const sig = `Δalph=${delta.alph > 0n ? "+" : delta.alph < 0n ? "-" : "0"} Δabd=${delta.abd > 0n ? "+" : delta.abd < 0n ? "-" : "0"} Δabx=${delta.abx > 0n ? "+" : delta.abx < 0n ? "-" : "0"}`;
          if (
            row.userDeltaSignatures.length < 10 &&
            !row.userDeltaSignatures.includes(sig)
          )
            row.userDeltaSignatures.push(sig);
          unknownCallees.set(c.address, row);
        }
      }

      // Against each target contract: if the script calls it, classify.
      for (const t of TARGETS) {
        const hits = calls.filter((c) => c.address === t.address);
        if (hits.length === 0) continue;
        const primary = hits[hits.length - 1]!;
        const cls = classify(t.family, delta);

        const entry = perContract.get(t.address)!;
        const byMethodIndex =
          entry.methods.get(primary.methodIndex) ??
          new Map<Operation, MethodClassification>();
        const existing = byMethodIndex.get(cls.operation) ?? {
          operation: cls.operation,
          confidence: cls.confidence,
          count: 0,
          sampleTxIds: [],
          explanation: cls.explanation,
        };
        existing.count += 1;
        if (existing.sampleTxIds.length < 3) existing.sampleTxIds.push(tx.hash);
        byMethodIndex.set(cls.operation, existing);
        entry.methods.set(primary.methodIndex, byMethodIndex);
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // Render to JSON
  const output: Record<
    string,
    {
      role: string;
      family: TargetContract["family"];
      methodMap: Record<string, MethodClassification[]>;
    }
  > = {};

  for (const [address, { role, family, methods }] of perContract.entries()) {
    const methodMap: Record<string, MethodClassification[]> = {};
    for (const [idx, byOp] of [...methods.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      // Sort operations by count, highest first.
      const list = [...byOp.values()].sort((a, b) => b.count - a.count);
      methodMap[String(idx)] = list;
    }
    output[address] = { role, family, methodMap };
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${OUT_PATH}`);

  // Console summary: for each (contract, methodIndex), the dominant operation.
  console.log("\n--- Summary (methodIndex → most-likely operation) ---");
  for (const [address, { role, methodMap }] of Object.entries(output)) {
    console.log(`\n${role}  ${address}`);
    for (const [idx, list] of Object.entries(methodMap)) {
      const top = list[0]!;
      console.log(
        `  mi=${idx.padStart(3)}  ${top.operation.padEnd(20)} (${top.confidence}, ${top.count} sample${top.count !== 1 ? "s" : ""})`,
      );
    }
  }

  // Print the top 20 unknown-called contracts. Vesting will appear here once
  // someone claims — look for "Δabx=+" signatures.
  console.log("\n--- Unknown callees surfaced during the scan ---");
  const unknownList = [...unknownCallees.entries()]
    .map(([addr, d]) => ({
      addr,
      total: [...d.methodIndices.values()].reduce((a, b) => a + b, 0),
      methodIndices: d.methodIndices,
      sampleTxIds: d.sampleTxIds,
      deltaSignatures: d.userDeltaSignatures,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
  for (const u of unknownList) {
    const miList = [...u.methodIndices.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([mi, n]) => `${mi}×${n}`)
      .join(", ");
    console.log(
      `  ${u.addr}  (${u.total} calls)  mi=[${miList}]  deltas=${u.deltaSignatures.join(" | ")}`,
    );
  }

  // Persist unknown-callees too.
  const unknownOut = join(
    dirname(new URL(import.meta.url).pathname),
    "..",
    "references",
    "alphbanx-unknown-callees.json",
  );
  writeFileSync(
    unknownOut,
    JSON.stringify(
      unknownList.map((u) => ({
        address: u.addr,
        totalCalls: u.total,
        methodIndices: Object.fromEntries(u.methodIndices),
        sampleTxIds: u.sampleTxIds,
        deltaSignatures: u.deltaSignatures,
      })),
      null,
      2,
    ) + "\n",
  );
  console.log(`\nWrote ${unknownOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Node env placeholder.
void readFileSync;
void NODE_URL;
