#!/usr/bin/env tsx
/**
 * Daily mainnet-address watchdog.
 *
 * Re-fetches the bytecode of every mainnet address our frontend points at
 * and compares the codeHash to the Phase-0 snapshot baked into
 * `BASELINES` below. On any mismatch, the script exits non-zero and
 * prints a clear error — intended to run in GitHub Actions on a cron
 * schedule so the mainnet frontend can be halted before anyone signs a
 * transaction against an upgraded-under-us AlphBanX contract.
 *
 * To update baselines after a legitimate upstream upgrade: re-run the
 * Phase-0 state-walk (see references/alphbanx-contract-addresses.md §9),
 * review each codeHash manually, then edit BASELINES + commit.
 */

const NODE_URL = "https://node.mainnet.alephium.org";

interface Baseline {
  address: string;
  role: string;
  codeHash: string;
}

const BASELINES: Baseline[] = [
  {
    address: "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K",
    role: "ABD Token",
    codeHash:
      "df072c61d3234452cdf90024a30ff6663db8f840aca64669941d30d82d9e6906",
  },
  {
    address: "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV",
    role: "ABX Token",
    codeHash:
      "0ac1a499bf773f8aefc895e13569fe58d7386912f182bc818bb22022a682f296",
  },
  {
    address: "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
    role: "LoanManager",
    codeHash:
      "c7c9dcd33919f02173362b33417eed70afdc6fffb1c254bf560123ef5a99cedc",
  },
  {
    address: "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    role: "AuctionManager",
    codeHash:
      "035535107ed47e0458df6e7313d88154b17181a95eed070a398d1de0c1065a2a",
  },
  {
    address: "2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7",
    role: "DIAAlphPriceAdapter",
    codeHash:
      "54ae42d3b1a7dde12ab95308845d4412c57b07048351e937b1cc18488d3788d5",
  },
  {
    address: "28Nju5bkxygKQp3SEw29jELwgTL4zpJZjwXNgaUzU3otT",
    role: "AbdPriceOracle",
    codeHash:
      "8144226f143d8e1a795cbc91a3101cbb7e2524e85730f6cfaa41bdc90239dd55",
  },
  {
    address: "21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf",
    role: "PlatformSettings",
    codeHash:
      "5392a356e4966c757cb7a1b8de71fd7640cd0149f24261863220b49c93921ba4",
  },
];

interface ContractState {
  codeHash: string;
  bytecode: string;
}

async function fetchCodeHash(address: string): Promise<string> {
  const res = await fetch(`${NODE_URL}/contracts/${address}/state`);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${address}`);
  const state = (await res.json()) as ContractState;
  return state.codeHash;
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const okRows: string[] = [];

  for (const base of BASELINES) {
    try {
      const current = await fetchCodeHash(base.address);
      if (current !== base.codeHash) {
        errors.push(
          `MISMATCH ${base.role} (${base.address}):\n` +
            `  baseline: ${base.codeHash}\n` +
            `  current:  ${current}`,
        );
      } else {
        okRows.push(`OK       ${base.role.padEnd(20)} ${base.address}`);
      }
    } catch (err) {
      errors.push(
        `ERROR ${base.role} (${base.address}): ${(err as Error).message}`,
      );
    }
  }

  for (const row of okRows) console.log(row);

  if (errors.length > 0) {
    console.error(`\n=== ${errors.length} issue(s) ===\n`);
    for (const e of errors) console.error(e + "\n");
    process.exit(1);
  }
  console.log(`\nAll ${BASELINES.length} mainnet addresses match baseline.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
