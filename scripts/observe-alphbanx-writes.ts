#!/usr/bin/env tsx
/**
 * Observe AlphBanX's on-chain write transactions and decode their scripts.
 *
 * Clean-room compliant: reads public transactions via the official Alephium
 * explorer backend + node API, decodes the TxScript bytecode using the
 * published @alephium/web3 codec (NOT contract bytecode — the TxScript
 * is the signed-by-user payload, already decoded by every block explorer).
 *
 * For each AlphBanX contract of interest we:
 *   1. Fetch the last N transactions that touched it.
 *   2. Decode each tx's scriptOpt into instructions.
 *   3. Identify every `CallExternal(methodIndex)` opcode preceded by a
 *      BytesConst that matches a known AlphBanX contract address.
 *   4. Tally method-index usage per contract.
 *
 * Output: `references/alphbanx-mainnet-methods.json` — a map of
 *   `{contractAddress: {methodIndex: {count, sampleTxIds[]}}}` suitable for
 *   human inspection and later wiring into the SDK write layer.
 *
 * Run: `pnpm tsx scripts/observe-alphbanx-writes.ts`
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  binToHex,
  codec,
  contractIdFromAddress,
  hexToBinUnsafe,
} from "@alephium/web3";
import type {
  Instr,
  Method,
} from "@alephium/web3/dist/_esm/codec/method-codec.js";

const scriptCodec = codec.script.scriptCodec;

const BACKEND_URL = "https://backend.mainnet.alephium.org";
const OUT_PATH = join(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "references",
  "alphbanx-mainnet-methods.json",
);

// Known AlphBanX mainnet contracts (copied from
// references/alphbanx-contract-addresses.md). Medium-confidence addresses are
// included so the observer can report their method-index usage alongside,
// which accelerates disambiguation.
const CONTRACTS: Array<{
  address: string;
  role: string;
  confidence: "high" | "medium";
}> = [
  {
    address: "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
    role: "loanManager",
    confidence: "high",
  },
  {
    address: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    role: "auctionManager",
    confidence: "high",
  },
  {
    address: "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K",
    role: "abdToken",
    confidence: "high",
  },
  {
    address: "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV",
    role: "abxToken",
    confidence: "high",
  },
  {
    address: "21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf",
    role: "platformSettings",
    confidence: "high",
  },
  {
    address: "2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7",
    role: "diaAlphPriceAdapter",
    confidence: "high",
  },
  {
    address: "28Nju5bkxygKQp3SEw29jELwgTL4zpJZjwXNgaUzU3otT",
    role: "abdPriceOracle",
    confidence: "high",
  },
  {
    address: "22qGq3kq2QMCnX4HwXc9bt2AzRjwoGRmXS4Qoc687rLYf",
    role: "unknown-1178b (likely BorrowerOperations)",
    confidence: "medium",
  },
  {
    address: "24nvcVvScyWY1tJKMepAABwVnAVXP7KsjVrqmc4jAhD11",
    role: "unknown-2574b",
    confidence: "medium",
  },
  {
    address: "uHKrQGuTtoRwR6ahAUhwdvrdcg4YVNq3BsVd4frLExLX",
    role: "unknown-1988b",
    confidence: "medium",
  },
  {
    address: "vh9fQ2PRGBzSuckm6yE8crpSzVM1frzRhwkWwnFDitfH",
    role: "unknown-450b",
    confidence: "medium",
  },
  {
    address: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    role: "unknown-4968b",
    confidence: "medium",
  },
  // Newly discovered from decoding scriptOpts — see
  // references/alphbanx-contract-addresses.md follow-ups.
  {
    address: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    role: "seen-in-loan-txs (candidate BorrowerOperations/LoanHelper)",
    confidence: "medium",
  },
  {
    address: "211mQVddZ3SEv5dZu33E9RAvDFDKPkZdZUkJp6eMEHUxo",
    role: "seen-in-loan-scripts (purpose TBD)",
    confidence: "medium",
  },
];

// Build address → {role, contractIdHex}, for fast hex-match inside instr
// decoding.
const contractIdToRole = new Map<string, { role: string; address: string }>();
for (const c of CONTRACTS) {
  try {
    const idHex = binToHex(contractIdFromAddress(c.address));
    contractIdToRole.set(idHex, { role: c.role, address: c.address });
  } catch {
    // unreachable for valid addresses
  }
}

interface ExplorerTx {
  hash: string;
  scriptOpt?: string;
  inputs?: Array<{ address?: string }>;
}

async function fetchTxsFor(
  address: string,
  page = 1,
  limit = 50,
): Promise<ExplorerTx[]> {
  const url = `${BACKEND_URL}/addresses/${address}/transactions?page=${page}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} — HTTP ${res.status}`);
  return (await res.json()) as ExplorerTx[];
}

interface MethodUsage {
  count: number;
  sampleTxIds: string[];
  argPattern?: string;
}

/**
 * Walk a script's instructions and identify `CallExternal(methodIndex)` events
 * where the contract id being called has been pushed to the stack just before
 * via a `BytesConst` (32-byte value matching a known AlphBanX contract id).
 *
 * The logic: the stack-based VM is linear inside a method. The most recently
 * pushed BytesConst opcode before a CallExternal is (in the typical compiled
 * form) the target contract id. This is a heuristic — the user's Ralph source
 * could have spilled intermediate values through locals — but it catches the
 * common case.
 */
function analyzeMethod(
  instrs: Instr[],
  usage: Map<string, Map<number, MethodUsage>>,
  txId: string,
): void {
  let lastBytesConstHex: string | null = null;
  const argStack: string[] = []; // simple arg-type trace

  for (const ins of instrs) {
    switch (ins.name) {
      case "BytesConst": {
        const hex =
          typeof ins.value === "string"
            ? ins.value
            : binToHex(ins.value as unknown as Uint8Array);
        lastBytesConstHex = hex;
        argStack.push(`Bytes(${hex.length / 2})`);
        break;
      }
      case "U256Const":
      case "U256Const0":
      case "U256Const1":
      case "U256Const2":
      case "U256Const3":
      case "U256Const4":
      case "U256Const5":
      case "LoadLocal":
      case "LoadMutField":
      case "LoadImmField":
      case "CallerAddress":
      case "TxId":
      case "BlockTimeStamp":
      case "MinimalContractDeposit":
        argStack.push(ins.name);
        break;
      case "AddressConst":
        argStack.push("AddressConst");
        break;
      case "CallExternal": {
        if (lastBytesConstHex) {
          const match = contractIdToRole.get(lastBytesConstHex);
          if (match) {
            const byContract =
              usage.get(match.address) ?? new Map<number, MethodUsage>();
            const entry = byContract.get(ins.index) ?? {
              count: 0,
              sampleTxIds: [],
            };
            entry.count += 1;
            if (entry.sampleTxIds.length < 5) entry.sampleTxIds.push(txId);
            entry.argPattern = argStack.slice(-6).join(",");
            byContract.set(ins.index, entry);
            usage.set(match.address, byContract);
          }
        }
        lastBytesConstHex = null;
        argStack.length = 0;
        break;
      }
      default:
        // Ignore everything else — stack tracking is heuristic anyway.
        break;
    }
  }
}

async function main(): Promise<void> {
  const usage = new Map<string, Map<number, MethodUsage>>();

  for (const c of CONTRACTS) {
    try {
      const txs = await fetchTxsFor(c.address, 1, 50);
      console.log(
        `[${c.role} @ ${c.address.slice(0, 8)}…] ${txs.length} tx(s)`,
      );
      for (const tx of txs) {
        if (!tx.scriptOpt) continue;
        try {
          const bytes = hexToBinUnsafe(tx.scriptOpt);
          const script = scriptCodec.decode(bytes);
          for (const method of script.methods as Method[]) {
            analyzeMethod(method.instrs, usage, tx.hash);
          }
        } catch (err) {
          // Skip txs whose scriptOpt we can't decode.
          if (process.env["DEBUG"])
            console.warn(
              `  decode failed on ${tx.hash.slice(0, 8)}: ${
                (err as Error).message
              }`,
            );
        }
      }
    } catch (err) {
      console.warn(
        `[${c.role} @ ${c.address.slice(0, 8)}…] fetch error: ${
          (err as Error).message
        }`,
      );
    }
    // polite delay
    await new Promise((r) => setTimeout(r, 200));
  }

  // Convert to stable JSON shape
  const output: Record<
    string,
    { role: string; methods: Record<string, MethodUsage> }
  > = {};
  for (const c of CONTRACTS) {
    const byIndex = usage.get(c.address);
    if (!byIndex) continue;
    const methods: Record<string, MethodUsage> = {};
    for (const [idx, u] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
      methods[String(idx)] = u;
    }
    output[c.address] = { role: c.role, methods };
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${OUT_PATH}`);
  for (const [addr, { role, methods }] of Object.entries(output)) {
    const idxList = Object.keys(methods).join(", ");
    console.log(`  ${role} (${addr.slice(0, 12)}…): methods used [${idxList}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// Keep readFileSync import alive — scripts/ is a JS env, not bundler-stripped.
void readFileSync;
