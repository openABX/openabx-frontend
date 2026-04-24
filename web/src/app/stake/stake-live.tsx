"use client";

import { useEffect, useState } from "react";
import { getNetworkConfig, resolveAddress } from "@openabx/sdk";
import { NETWORK } from "@/lib/env";

interface SnapshotState {
  abxTotalSupply: number | null;
  abxSymbol: string | null;
  abdTotalSupply: number | null;
  ambdTotalInPools: number | null;
  priceUsdPerAlph: number | null;
  lastUpdatedMs: number | null;
  error: string | null;
}

const ABD_SCALE = 1_000_000_000;
const ABX_SCALE = 1_000_000_000;
const PRECISION = 1_000_000_000_000_000_000;

// Mainnet AuctionManager mutable-field layout, pinned 2026-04-23 by direct
// on-chain inspection of 29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3:
//   mut[0]=loan/position counter
//   mut[1..4]=pool discount BPS (5/10/15/20 × 1e15)
//   mut[5]=aggregate ABD in pools  ← THIS IS WHAT WE WANT
//   mut[6..8]=P/S snapshot factors
const MAINNET_AUCTION_MGR_TVL_INDEX = 5;

// ABD/ABX mainnet layout (verified): mut[0]=admin/mintAuthority Address,
// mut[1]=totalSupply U256.
const TOKEN_TOTAL_SUPPLY_INDEX = 1;

function hexToUtf8(hex: string): string {
  try {
    return Buffer.from(hex, "hex").toString("utf-8").replace(/\0/g, "");
  } catch {
    return hex;
  }
}

function decodeTokenSupply(
  mutFields: Array<{ type: string; value: string }>,
  scale: number,
): number | null {
  const slot = mutFields[TOKEN_TOTAL_SUPPLY_INDEX];
  if (!slot || slot.type !== "U256") return null;
  const v = BigInt(slot.value);
  // Sanity bound: a sensible totalSupply lives in [1, 10^30]. If we drift to a
  // contract whose mut[1] is something else (a paused-flag at 0/1, a
  // PRECISION-scaled rate, etc.), refuse to display rather than silently lie.
  if (v < 1n || v > 1_000_000_000_000_000_000_000_000_000_000n) return null;
  return Number(v) / scale;
}

function decodeAuctionMgrTvl(
  network: typeof NETWORK,
  mutFields: Array<{ type: string; value: string }>,
): number | null {
  if (network === "mainnet") {
    const slot = mutFields[MAINNET_AUCTION_MGR_TVL_INDEX];
    if (!slot || slot.type !== "U256") return null;
    return Number(BigInt(slot.value)) / ABD_SCALE;
  }
  // Off-mainnet: testnet/devnet AuctionManager is OpenABX's clean-room
  // contract, which deliberately doesn't ship to those networks today (testnet
  // is GitBook-published address book only, no AuctionManager). Return null
  // until we actually deploy.
  return null;
}

function useStakeSnapshot(refreshMs = 30_000): SnapshotState {
  const abdAddr = resolveAddress(NETWORK, "abdToken");
  const abxAddr = resolveAddress(NETWORK, "abxToken");
  const auctionManagerAddr = resolveAddress(NETWORK, "auctionManager");
  const oracleAddr = resolveAddress(NETWORK, "diaAlphPriceAdapter");
  const nodeUrl = getNetworkConfig(NETWORK).nodeUrl;

  const [state, setState] = useState<SnapshotState>({
    abxTotalSupply: null,
    abxSymbol: null,
    abdTotalSupply: null,
    ambdTotalInPools: null,
    priceUsdPerAlph: null,
    lastUpdatedMs: null,
    error: null,
  });

  useEffect(() => {
    if (!abdAddr || !abxAddr || !oracleAddr) {
      setState((s) => ({
        ...s,
        error: `Required addresses missing on ${NETWORK} (need abdToken, abxToken, oracle)`,
      }));
      return;
    }
    let cancelled = false;

    async function fetchOnce(): Promise<void> {
      try {
        const [abdRes, abxRes, oracleRes, amRes] = await Promise.all([
          fetch(`${nodeUrl}/contracts/${abdAddr}/state`),
          fetch(`${nodeUrl}/contracts/${abxAddr}/state`),
          fetch(`${nodeUrl}/contracts/call-contract`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              group: 0,
              address: oracleAddr,
              methodIndex: 1,
            }),
          }),
          auctionManagerAddr
            ? fetch(`${nodeUrl}/contracts/${auctionManagerAddr}/state`)
            : Promise.resolve(null),
        ]);
        if (!abdRes.ok) throw new Error(`ABD HTTP ${abdRes.status}`);
        if (!abxRes.ok) throw new Error(`ABX HTTP ${abxRes.status}`);
        if (!oracleRes.ok) throw new Error(`oracle HTTP ${oracleRes.status}`);

        const abd = (await abdRes.json()) as {
          mutFields: Array<{ type: string; value: string }>;
        };
        const abx = (await abxRes.json()) as {
          immFields: Array<{ type: string; value: string }>;
          mutFields: Array<{ type: string; value: string }>;
        };
        const oracle = (await oracleRes.json()) as {
          type: string;
          returns?: Array<{ type: string; value: string }>;
        };

        const abdTotalSupply = decodeTokenSupply(abd.mutFields, ABD_SCALE);
        const abxTotalSupply = decodeTokenSupply(abx.mutFields, ABX_SCALE);
        const symbol = abx.immFields[0]?.value
          ? hexToUtf8(abx.immFields[0].value)
          : null;

        const oraclePrice =
          oracle.type === "CallContractSucceeded" &&
          oracle.returns?.[0]?.type === "U256"
            ? Number(BigInt(oracle.returns[0].value)) / PRECISION
            : null;

        let poolTotal: number | null = null;
        if (amRes && amRes.ok) {
          const am = (await amRes.json()) as {
            mutFields: Array<{ type: string; value: string }>;
          };
          poolTotal = decodeAuctionMgrTvl(NETWORK, am.mutFields);
        }

        if (!cancelled) {
          setState({
            abxSymbol: symbol,
            abxTotalSupply,
            abdTotalSupply,
            ambdTotalInPools: poolTotal,
            priceUsdPerAlph: oraclePrice,
            lastUpdatedMs: Date.now(),
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled)
          setState((s) => ({ ...s, error: (err as Error).message }));
      }
    }

    fetchOnce();
    const timer = setInterval(fetchOnce, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [abdAddr, abxAddr, auctionManagerAddr, oracleAddr, nodeUrl, refreshMs]);

  return state;
}

export function StakeLive() {
  const {
    abxTotalSupply,
    abxSymbol,
    abdTotalSupply,
    ambdTotalInPools,
    priceUsdPerAlph,
    lastUpdatedMs,
    error,
  } = useStakeSnapshot();

  // Spec §2.1: k = Σpools_abd / totalSupply(ABD). k goes to stakers; (1-k) to
  // auction-pool bidders. Both numerator and denominator are read live; if
  // either is unavailable we render an em-dash rather than fabricate a number.
  const stakerSharePct =
    ambdTotalInPools != null && abdTotalSupply != null && abdTotalSupply > 0
      ? Math.min(1, ambdTotalInPools / abdTotalSupply)
      : null;
  const bidderSharePct = stakerSharePct != null ? 1 - stakerSharePct : null;

  // F-08 mitigation: visually mark the price as stale if the last successful
  // refresh was >2× the polling interval ago.
  const isStale = lastUpdatedMs != null && Date.now() - lastUpdatedMs > 60_000;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-4">
        <Card label="ABX circulating" valueMono>
          {abxTotalSupply != null
            ? abxTotalSupply.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })
            : "—"}
          <span className="ml-1 text-sm text-muted-foreground">
            {abxSymbol ?? "ABX"}
          </span>
        </Card>
        <Card label="ALPH / USD">
          <span
            className={
              isStale
                ? "font-mono text-2xl text-muted-foreground line-through"
                : "font-mono text-2xl text-primary"
            }
          >
            {priceUsdPerAlph != null ? `$${priceUsdPerAlph.toFixed(6)}` : "—"}
          </span>
          {isStale && (
            <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs text-warning">
              stale
            </span>
          )}
        </Card>
        <Card label="ABD in pools" valueMono>
          {ambdTotalInPools != null
            ? ambdTotalInPools.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })
            : "—"}
          <span className="ml-1 text-sm text-muted-foreground">ABD</span>
          <p className="text-xs text-muted-foreground">
            {abdTotalSupply != null
              ? `of ${abdTotalSupply.toLocaleString("en-US", { maximumFractionDigits: 2 })} ABD supply`
              : "supply unknown"}
          </p>
        </Card>
        <Card label="Fee share → stakers">
          <span className="font-mono text-2xl text-primary">
            {stakerSharePct != null
              ? `${(stakerSharePct * 100).toFixed(1)}%`
              : "—"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {bidderSharePct != null
              ? `bidders get ${(bidderSharePct * 100).toFixed(1)}%`
              : "k = Σpools / supply(ABD)"}
          </span>
        </Card>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {error}
        </div>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How the fee split works
        </h3>
        <div className="card p-4 text-sm">
          <p>
            Every time a borrower pays a minting / borrowing / liquidation fee,
            the resulting ALPH is split in two:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <span className="font-mono">(1 − k)</span> goes to auction-pool
              depositors, pro-rata within each pool.
            </li>
            <li>
              <span className="font-mono">k</span> goes to ABX stakers, pro-rata
              to staked ABX.
            </li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            When more ABD is sitting idle in the pools, stakers earn a larger
            share &mdash; the system pays stakers for carrying the fee burden
            instead of the pools.
          </p>
        </div>
      </section>
    </div>
  );
}

interface CardProps {
  label: string;
  children: React.ReactNode;
  valueMono?: boolean;
}
function Card({ label, children, valueMono }: CardProps) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className={valueMono ? "mt-2 font-mono text-2xl" : "mt-2 text-2xl"}>
        {children}
      </div>
    </div>
  );
}
