"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { getNetworkConfig, resolveAddress } from "@openabx/sdk";
import { NETWORK } from "@/lib/env";
import { canTransactOp, openLoan } from "@/lib/tx";
import { formatAmount, numberToBigint } from "@/lib/format";
import { useLoanPosition, useWalletBalances } from "@/lib/hooks";
import { useTxRunner } from "@/lib/hooks/use-tx-runner";
import { TxStatusLine } from "@/components/tx-status-line";
import { cn } from "@/lib/utils";

// Parameters mirror docs/00-protocol-spec.md §2.
const INTEREST_TIERS = [1, 3, 5, 10, 15, 20, 25, 30] as const;
type InterestTier = (typeof INTEREST_TIERS)[number];

const MINTING_FEE = 0.005;
const MCR = 2.0;
const MIN_LOAN_ABD = 100;

interface CrZone {
  label: string;
  badgeClass: string;
  barClass: string;
}

// Ranges from docs/00-protocol-spec.md §2, CR zones subsection.
function crZone(crPercent: number): CrZone {
  if (crPercent >= 400)
    return {
      label: "Conservative",
      badgeClass: "bg-green-600 text-white",
      barClass: "bg-green-500",
    };
  if (crPercent >= 280)
    return {
      label: "Moderate",
      badgeClass: "bg-emerald-500 text-white",
      barClass: "bg-emerald-400",
    };
  if (crPercent >= 230)
    return {
      label: "Aggressive",
      badgeClass: "bg-amber-500 text-white",
      barClass: "bg-amber-500",
    };
  if (crPercent >= 200)
    return {
      label: "High Risk",
      badgeClass: "bg-orange-600 text-white",
      barClass: "bg-orange-500",
    };
  return {
    label: "Under liquidation threshold",
    badgeClass: "bg-red-600 text-white",
    barClass: "bg-red-600",
  };
}

function formatUsd(value: number, fractionDigits = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Plain useState + useEffect price fetch. Deliberately NOT using useQuery
 * here — the read surface is tiny (one number, one refresh cadence), we
 * do not need the cache, and the direct fetch keeps the component's
 * dependency graph flat. /dev/tokens exercises useQuery at a larger scope
 * for the ABD/ABX/PlatformSettings reads.
 */
interface PriceState {
  price: number | null;
  lastUpdatedMs: number | null;
  isLoading: boolean;
  error: Error | null;
}

function useAlphPrice(refreshMs = 30_000): PriceState {
  const adapter = resolveAddress(NETWORK, "diaAlphPriceAdapter");
  const nodeUrl = getNetworkConfig(NETWORK).nodeUrl;
  const [state, setState] = useState<PriceState>({
    price: null,
    lastUpdatedMs: null,
    isLoading: !!adapter,
    error: null,
  });

  useEffect(() => {
    if (!adapter) {
      setState({
        price: null,
        lastUpdatedMs: null,
        isLoading: false,
        error: null,
      });
      return;
    }
    let cancelled = false;

    async function fetchOnce(): Promise<void> {
      try {
        const res = await fetch(`${nodeUrl}/contracts/call-contract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group: 0, address: adapter, methodIndex: 1 }),
        });
        if (!res.ok) throw new Error(`oracle HTTP ${res.status}`);
        const result = (await res.json()) as {
          type: string;
          returns?: Array<{ type: string; value: string }>;
        };
        if (result.type !== "CallContractSucceeded" || !result.returns) {
          throw new Error(`oracle call failed: ${result.type}`);
        }
        const v = result.returns[0];
        if (!v || v.type !== "U256") throw new Error("unexpected return type");
        const price = Number(BigInt(v.value)) / 1e18;
        if (!cancelled)
          setState({
            price,
            lastUpdatedMs: Date.now(),
            isLoading: false,
            error: null,
          });
      } catch (err) {
        if (!cancelled)
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: err as Error,
          }));
      }
    }

    fetchOnce();
    const timer = setInterval(fetchOnce, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adapter, nodeUrl, refreshMs]);

  return state;
}

// Map the eight UI tiers to their 1e18-scaled on-chain values (per spec §2).
const TIER_TO_RATE_1E18: Record<InterestTier, bigint> = {
  1: 10_000_000_000_000_000n,
  3: 30_000_000_000_000_000n,
  5: 50_000_000_000_000_000n,
  10: 100_000_000_000_000_000n,
  15: 150_000_000_000_000_000n,
  20: 200_000_000_000_000_000n,
  25: 250_000_000_000_000_000n,
  30: 300_000_000_000_000_000n,
};

export function BorrowForm() {
  const [collateralAlph, setCollateralAlph] = useState<string>("1000");
  const [borrowAbd, setBorrowAbd] = useState<string>("100");
  const [tier, setTier] = useState<InterestTier>(5);
  const [maxHint, setMaxHint] = useState<string | null>(null);
  const { state: submit, runTx } = useTxRunner();

  const wallet = useWallet();
  const { data: loan } = useLoanPosition();
  const { data: balances } = useWalletBalances();

  const {
    price: priceUsdPerAlph,
    lastUpdatedMs,
    isLoading,
    error,
  } = useAlphPrice();
  // F-08: mark the displayed price as stale if the last successful refresh
  // was >2× the polling interval ago (60s). Submission is gated separately
  // on metrics.valid so a stale price also yields valid=false through its
  // effect on the CR computation.
  const isPriceStale =
    lastUpdatedMs != null && Date.now() - lastUpdatedMs > 60_000;

  const metrics = useMemo(() => {
    const collNum = Number(collateralAlph) || 0;
    const debtNum = Number(borrowAbd) || 0;
    const p = priceUsdPerAlph ?? 0;
    if (p === 0) return null;

    const collateralUsd = collNum * p;
    const feeUsd = debtNum * MINTING_FEE;
    const feeAlph = feeUsd / p;
    const netCollateralAlph = Math.max(0, collNum - feeAlph);
    const netCollateralUsd = netCollateralAlph * p;
    const crPercent =
      debtNum > 0 ? (netCollateralUsd / debtNum) * 100 : Infinity;
    const liquidationPriceUsdPerAlph =
      netCollateralAlph > 0 ? (debtNum * MCR) / netCollateralAlph : 0;

    const maxBorrowAtMcr =
      debtNum > 0 ? collateralUsd / MCR : collateralUsd / MCR;
    const valid =
      collNum > 0 &&
      debtNum >= MIN_LOAN_ABD &&
      crPercent >= MCR * 100 &&
      feeAlph < collNum;

    return {
      collateralUsd,
      feeUsd,
      feeAlph,
      netCollateralAlph,
      netCollateralUsd,
      crPercent,
      liquidationPriceUsdPerAlph,
      maxBorrowAtMcr,
      valid,
    };
  }, [collateralAlph, borrowAbd, priceUsdPerAlph]);

  const zone =
    metrics && isFinite(metrics.crPercent) ? crZone(metrics.crPercent) : null;

  const onMax = () => {
    const p = priceUsdPerAlph ?? 0;
    const collNum = Number(collateralAlph) || 0;
    if (p === 0 || collNum === 0) {
      setMaxHint(null);
      return;
    }
    // Max borrow ≈ collateral_value_USD / (MCR + feeRate). The fee itself
    // reduces collateral, so we solve for the fixed point.
    //
    // Nudge ~0.05% below the exact solution so that, after we round the
    // output to 2 decimals for the input control, we land comfortably
    // above 200% CR rather than falling to 199.99%.
    const maxWithFee = (collNum * p) / (MCR + MINTING_FEE);
    const safetyMargin = 0.9995;
    const candidate = maxWithFee * safetyMargin;
    if (candidate < MIN_LOAN_ABD) {
      // F-07: Don't auto-fill a value that the form will reject. Surface a
      // hint that explains how much collateral the user would need to mint
      // the minimum loan, instead of silently producing an invalid form.
      const requiredCollateral = (MIN_LOAN_ABD * (MCR + MINTING_FEE)) / p;
      setMaxHint(
        `Need ≥ ${requiredCollateral.toFixed(0)} ALPH at the current price ` +
          `to borrow the ${MIN_LOAN_ABD}-ABD minimum.`,
      );
      return;
    }
    setMaxHint(null);
    setBorrowAbd(candidate.toFixed(2));
  };

  const isConnected = wallet.connectionStatus === "connected";
  const walletAlphAtto = balances?.alphAtto ?? null;
  const writesAllowed = canTransactOp(NETWORK, "openLoan");

  const isBusy =
    submit.kind === "awaitingSign" ||
    submit.kind === "submitted" ||
    submit.kind === "confirming";

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!writesAllowed || !isConnected || !wallet.signer || !metrics?.valid)
      return;
    const collAtto = numberToBigint(Number(collateralAlph) || 0, 18);
    const debtAtto = numberToBigint(Number(borrowAbd) || 0, 9);
    if (collAtto <= 0n || debtAtto <= 0n) return;
    await runTx(() =>
      openLoan(NETWORK, wallet.signer!, {
        collateralAlphAtto: collAtto,
        borrowAbdAtto: debtAtto,
        interestRate1e18: TIER_TO_RATE_1E18[tier],
      }),
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Form side */}
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="collateral">
            Collateral
            <span className="ml-1 text-muted-foreground">(ALPH)</span>
          </label>
          <input
            id="collateral"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={collateralAlph}
            onChange={(e) => setCollateralAlph(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          {metrics && (
            <p className="text-xs text-muted-foreground">
              Worth{" "}
              <span className="font-mono">
                ${formatUsd(metrics.collateralUsd, 2)}
              </span>{" "}
              at the current oracle price.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <label className="text-sm font-medium" htmlFor="borrow">
              Borrow
              <span className="ml-1 text-muted-foreground">(ABD)</span>
            </label>
            <button
              type="button"
              onClick={onMax}
              className="text-xs text-primary underline underline-offset-4 hover:text-primary/80"
            >
              Max at 200% CR
            </button>
          </div>
          <input
            id="borrow"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={borrowAbd}
            onChange={(e) => setBorrowAbd(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">
            Minimum loan size: <span className="font-mono">{MIN_LOAN_ABD}</span>{" "}
            ABD.
          </p>
          {maxHint && <p className="text-xs text-warning">{maxHint}</p>}
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Interest rate</legend>
          <div className="grid grid-cols-4 gap-2">
            {INTEREST_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={cn(
                  "rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors",
                  tier === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/60",
                )}
              >
                {t}%
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Lower rates are redeemed first when ABD holders redeem against the
            protocol. Higher rates reduce your exposure to forced redemption but
            cost more over time.
          </p>
        </fieldset>

        {writesAllowed && (
          <button
            type="submit"
            disabled={!metrics?.valid || !isConnected || isBusy}
            className={cn(
              "w-full rounded-md px-4 py-3 text-sm font-semibold transition-colors",
              metrics?.valid && isConnected && !isBusy
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {isBusy
              ? "Signing transaction…"
              : !isConnected
                ? "Connect wallet to open loan"
                : !metrics?.valid
                  ? "Invalid: adjust inputs"
                  : loan?.exists
                    ? "You already have an open loan"
                    : "Open loan"}
          </button>
        )}
        <TxStatusLine state={submit} />
        {isConnected && walletAlphAtto != null && (
          <p className="text-xs text-muted-foreground">
            Wallet balance:{" "}
            <span className="font-mono">
              {formatAmount(walletAlphAtto, 18, 3)}
            </span>{" "}
            ALPH /{" "}
            <span className="font-mono">
              {formatAmount(balances?.abdAtto ?? null, 9, 2)}
            </span>{" "}
            ABD
          </p>
        )}
      </form>

      {/* Preview side */}
      <aside className="card space-y-6 p-6">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Oracle price
          </h3>
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {error && (
            <p className="text-sm text-destructive">
              Oracle error: {(error as Error).message}
            </p>
          )}
          {priceUsdPerAlph != null && (
            <p
              className={cn(
                "font-mono text-2xl",
                isPriceStale
                  ? "text-muted-foreground line-through"
                  : "text-primary",
              )}
            >
              ${priceUsdPerAlph.toFixed(6)}{" "}
              <span className="text-sm text-muted-foreground">/ ALPH</span>
              {isPriceStale && (
                <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 align-middle text-xs text-warning">
                  stale
                </span>
              )}
            </p>
          )}
        </section>

        {metrics && isFinite(metrics.crPercent) && zone && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Collateralization ratio
            </h3>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-3xl">
                {metrics.crPercent.toFixed(2)}%
              </span>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
                  zone.badgeClass,
                )}
              >
                {zone.label}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className={cn("h-2 rounded-full transition-all", zone.barClass)}
                style={{
                  width: `${Math.min(100, (metrics.crPercent / 500) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Zones: Conservative ≥ 400 %, Moderate 280&ndash;400 %, Aggressive
              230&ndash;280 %, High Risk 200&ndash;230 %, Liquidation &lt; 200
              %.
            </p>
          </section>
        )}

        {metrics && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fees and liquidation
            </h3>
            <dl className="grid grid-cols-[16ch_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Minting fee (0.5 %)</dt>
              <dd className="font-mono">
                {metrics.feeAlph.toFixed(4)} ALPH{" "}
                <span className="text-muted-foreground">
                  (${formatUsd(metrics.feeUsd)})
                </span>
              </dd>
              <dt className="text-muted-foreground">Net collateral</dt>
              <dd className="font-mono">
                {metrics.netCollateralAlph.toFixed(4)} ALPH{" "}
                <span className="text-muted-foreground">
                  (${formatUsd(metrics.netCollateralUsd)})
                </span>
              </dd>
              <dt className="text-muted-foreground">Liquidation price</dt>
              <dd className="font-mono">
                $
                {metrics.liquidationPriceUsdPerAlph > 0
                  ? metrics.liquidationPriceUsdPerAlph.toFixed(6)
                  : "—"}{" "}
                <span className="text-muted-foreground">/ ALPH</span>
              </dd>
              <dt className="text-muted-foreground">Tier interest / yr</dt>
              <dd className="font-mono">
                {tier}% ({((Number(borrowAbd) || 0) * (tier / 100)).toFixed(2)}{" "}
                ABD / year){" "}
              </dd>
            </dl>
            {!metrics.valid && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                {Number(collateralAlph) <= 0
                  ? "Enter a positive collateral amount."
                  : Number(borrowAbd) <= 0
                    ? `Enter a borrow amount of at least ${MIN_LOAN_ABD} ABD.`
                    : Number(borrowAbd) < MIN_LOAN_ABD
                      ? `Below minimum loan size of ${MIN_LOAN_ABD} ABD.`
                      : metrics.crPercent < MCR * 100
                        ? "CR is below the 200 % minimum. Add collateral or reduce the borrow amount."
                        : metrics.feeAlph >= Number(collateralAlph)
                          ? "Minting fee exceeds collateral. Increase collateral or reduce borrow."
                          : "Form not valid yet."}
              </p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
