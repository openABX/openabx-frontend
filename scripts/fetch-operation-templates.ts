#!/usr/bin/env tsx
/**
 * Fetch a sample scriptOpt for each confirmed (contract, methodIndex, operation)
 * and save its fully-decoded form to references/alphbanx-operation-templates/.
 *
 * These templates are the known-good bytecode patterns used by the web layer
 * to build re-encoded scriptOpts with substituted user inputs — much safer
 * than emitting scripts from scratch because the call-convention, APS
 * approvals, and any pre-fetch helper calls come pre-baked from a
 * real-working transaction.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addressFromContractId,
  binToHex,
  codec,
  hexToBinUnsafe,
} from "@alephium/web3";

const BACKEND_URL = "https://backend.mainnet.alephium.org";
const NODE_URL = "https://node.mainnet.alephium.org";
const OUT_DIR = join(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "references",
  "alphbanx-operation-templates",
);

const scriptCodec = codec.script.scriptCodec;

// Operations we want templates for. Each entry is one sample from
// references/alphbanx-operation-map.json.
const TARGETS: Array<{
  operation: string;
  txId: string;
  contract: string;
  methodIndex: number;
}> = [
  // StakeManager
  {
    operation: "claimRewards",
    contract: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    methodIndex: 33,
    // will be filled from the operation map
    txId: "",
  },
  {
    operation: "stake",
    contract: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    methodIndex: 30,
    txId: "",
  },
  {
    operation: "requestUnstake",
    contract: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    methodIndex: 31,
    txId: "",
  },
  {
    operation: "claimUnstake",
    contract: "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    methodIndex: 32,
    txId: "",
  },
  // AuctionManager
  {
    operation: "poolDeposit",
    contract: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    methodIndex: 36,
    txId: "",
  },
  {
    operation: "poolWithdraw",
    contract: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    methodIndex: 41,
    txId: "",
  },
  {
    operation: "poolClaim40",
    contract: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    methodIndex: 40,
    txId: "",
  },
  {
    operation: "poolClaim42",
    contract: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    methodIndex: 42,
    txId: "",
  },
  // BorrowerOperations
  {
    operation: "openLoan11",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 11,
    txId: "",
  },
  {
    operation: "openLoan12",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 12,
    txId: "",
  },
  {
    operation: "repay",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 10,
    txId: "",
  },
  {
    operation: "addCollateral",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 8,
    txId: "",
  },
  {
    operation: "borrowMoreOrAdd7",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 7,
    txId: "",
  },
  {
    operation: "closeLoan",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 19,
    txId: "",
  },
  {
    operation: "withdrawCollateral",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 20,
    txId: "",
  },
  {
    operation: "redeemCandidate3",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 3,
    txId: "",
  },
  {
    operation: "liquidateCandidate9",
    contract: "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    methodIndex: 9,
    txId: "",
  },
];

interface MapEntry {
  operation: string;
  confidence: string;
  count: number;
  sampleTxIds: string[];
  explanation: string;
}
interface OperationMap {
  [address: string]: {
    role: string;
    family: string;
    methodMap: { [methodIndex: string]: MapEntry[] };
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // Load the operation map to auto-populate txIds.
  const mapPath = join(
    dirname(new URL(import.meta.url).pathname),
    "..",
    "references",
    "alphbanx-operation-map.json",
  );
  const map = JSON.parse(readFileSync(mapPath, "utf-8")) as OperationMap;

  for (const target of TARGETS) {
    const entry = map[target.contract];
    if (!entry) {
      console.warn(
        `  ${target.operation}: no map entry for ${target.contract}`,
      );
      continue;
    }
    const forMi = entry.methodMap[String(target.methodIndex)];
    if (!forMi || forMi.length === 0) {
      console.warn(
        `  ${target.operation}: no samples for ${target.contract} mi=${target.methodIndex}`,
      );
      continue;
    }
    // Prefer an entry whose operation name matches our target where possible.
    const best =
      forMi.find((e) =>
        e.operation
          .toLowerCase()
          .includes(target.operation.toLowerCase().slice(0, 5)),
      ) ?? forMi[0];
    if (!best) continue;
    target.txId = best.sampleTxIds[0] ?? "";
  }

  for (const target of TARGETS) {
    if (!target.txId) {
      console.warn(`  ${target.operation}: no sample txId`);
      continue;
    }
    console.log(
      `\n=== ${target.operation} (mi=${target.methodIndex}) — tx ${target.txId.slice(0, 12)}…`,
    );
    let detailsRes: Response;
    try {
      detailsRes = await fetch(
        `${NODE_URL}/transactions/rich-details/${target.txId}`,
      );
    } catch (err) {
      console.warn(`    fetch error: ${(err as Error).message}`);
      continue;
    }
    if (!detailsRes.ok) {
      console.warn(`    rich-details HTTP ${detailsRes.status}`);
      continue;
    }
    const detail = (await detailsRes.json()) as {
      unsigned: { scriptOpt?: string };
      contractInputs: Array<{ address: string }>;
    };
    const scriptOpt = detail.unsigned.scriptOpt;
    if (!scriptOpt) {
      console.warn("    tx has no scriptOpt");
      continue;
    }

    // Decode into a structured representation we can store.
    let script;
    try {
      script = scriptCodec.decode(hexToBinUnsafe(scriptOpt));
    } catch (err) {
      console.warn(`    decode failed: ${(err as Error).message}`);
      continue;
    }

    const decoded = {
      operation: target.operation,
      contract: target.contract,
      methodIndex: target.methodIndex,
      txId: target.txId,
      scriptOpt,
      contractInputs: detail.contractInputs?.map((c) => c.address) ?? [],
      methods: script.methods.map((m, i) => ({
        index: i,
        argsLength: m.argsLength,
        localsLength: m.localsLength,
        returnLength: m.returnLength,
        instrs: m.instrs.map((ins) => {
          const base: Record<string, unknown> = { name: ins.name };
          const v = (
            ins as {
              value?: unknown;
              index?: number;
              offset?: number;
              selector?: number;
            }
          ).value;
          if ("index" in ins) base["index"] = (ins as { index: number }).index;
          if ("offset" in ins)
            base["offset"] = (ins as { offset: number }).offset;
          if ("selector" in ins)
            base["selector"] = (ins as { selector: number }).selector;
          if (v !== undefined) {
            if (v instanceof Uint8Array) {
              base["valueHex"] = binToHex(v);
              // Best-effort: if 32 bytes, try to decode as a contract address.
              if (v.length === 32) {
                try {
                  base["asAddress"] = addressFromContractId(binToHex(v));
                } catch {
                  // ignore
                }
              }
            } else if (typeof v === "bigint") {
              base["value"] = v.toString();
            } else {
              base["value"] = JSON.parse(
                JSON.stringify(v, (_k, val) =>
                  typeof val === "bigint"
                    ? val.toString()
                    : val instanceof Uint8Array
                      ? binToHex(val)
                      : val,
                ),
              );
            }
          }
          return base;
        }),
      })),
    };

    const outPath = join(OUT_DIR, `${target.operation}.json`);
    writeFileSync(outPath, JSON.stringify(decoded, null, 2) + "\n");
    console.log(`    wrote ${outPath}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
