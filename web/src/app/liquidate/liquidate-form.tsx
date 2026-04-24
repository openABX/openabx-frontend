"use client";

import { useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { NETWORK } from "@/lib/env";
import { canTransact, liquidate } from "@/lib/tx";
import { useProtocolGlobals } from "@/lib/hooks";
import { useLoanScan } from "@/lib/hooks/use-loan-scan";
import { useTxRunner } from "@/lib/hooks/use-tx-runner";
import { bigintToNumber, formatAmount } from "@/lib/format";
import { explorerAddressUrl, validateUserAddress } from "@/lib/validation";
import { TxStatusLine } from "@/components/tx-status-line";
import { cn } from "@/lib/utils";

export function LiquidateForm() {
  const [targetOwner, setTargetOwner] = useState("");
  const { state: submit, runTx } = useTxRunner();

  const wallet = useWallet();
  const { data: globals } = useProtocolGlobals();
  const { data: loans, isFetching: scanning } = useLoanScan(30);

  const isConnected = wallet.connectionStatus === "connected";
  const writesAllowed = canTransact(NETWORK);
  const isBusy =
    submit.kind === "awaitingSign" ||
    submit.kind === "submitted" ||
    submit.kind === "confirming";

  const priceUsd = globals?.alphUsd1e18
    ? bigintToNumber(globals.alphUsd1e18, 18)
    : null;

  const liquidatable = (loans ?? []).filter((l) => l.liquidatable);
  const atRisk = (loans ?? [])
    .filter((l) => !l.liquidatable && l.crBps != null && l.crBps < 25_000)
    .sort((a, b) => (a.crBps ?? Infinity) - (b.crBps ?? Infinity))
    .slice(0, 5);

  const addrValidation = validateUserAddress(targetOwner);
  const canSubmit =
    isConnected && writesAllowed && addrValidation.ok && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !wallet.signer || !addrValidation.ok) return;
    await runTx(() =>
      liquidate(NETWORK, wallet.signer!, addrValidation.address),
    );
  }

  async function handleLiquidateOne(owner: string) {
    if (!isConnected || !wallet.signer) return;
    const v = validateUserAddress(owner);
    if (!v.ok) return;
    setTargetOwner(v.address);
    await runTx(() => liquidate(NETWORK, wallet.signer!, v.address));
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-3">
        <InfoCard label="MCR" value="200%" note="liquidates below this CR" />
        <InfoCard
          label="ALPH / USD"
          value={priceUsd != null ? `$${priceUsd.toFixed(6)}` : "—"}
          note="DIA feed"
        />
        <InfoCard
          label="Discount cascade"
          value="5 → 10 → 15 → 20 %"
          note="pools bid in order"
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Liquidatable loans{" "}
            {scanning && (
              <span className="ml-2 text-xs opacity-60">scanning…</span>
            )}
          </h3>
          <span className="text-xs text-muted-foreground">
            {loans?.length ?? 0} active loans scanned
          </span>
        </div>

        {liquidatable.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-[hsl(var(--surface-2))]/50 p-4 text-sm text-muted-foreground">
            No loans currently below the 200% MCR. The scanner walks the 30 most
            recent LoanManager-touching addresses; lower-CR loans may exist
            outside this window.
          </p>
        ) : (
          <ul className="space-y-2">
            {liquidatable.map((l) => (
              <li
                key={l.owner}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <div>
                  <p className="font-mono text-xs">{l.owner}</p>
                  <p className="text-xs text-muted-foreground">
                    coll{" "}
                    <span className="font-mono">
                      {formatAmount(l.collateralAlphAtto, 18, 2)} ALPH
                    </span>{" "}
                    · debt{" "}
                    <span className="font-mono">
                      {formatAmount(l.debtAbdAtto, 9, 2)} ABD
                    </span>{" "}
                    · CR{" "}
                    <span className="font-mono text-destructive">
                      {l.crBps != null ? (l.crBps / 100).toFixed(1) + "%" : "—"}
                    </span>
                  </p>
                </div>
                {writesAllowed ? (
                  <button
                    type="button"
                    disabled={!isConnected || isBusy}
                    onClick={() => handleLiquidateOne(l.owner)}
                    className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    Liquidate
                  </button>
                ) : (
                  <a
                    href={explorerAddressUrl(l.owner)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    Inspect ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        {atRisk.length > 0 && (
          <details className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <summary className="cursor-pointer font-medium">
              {atRisk.length} near-MCR loans (200–250 %) — watchlist
            </summary>
            <ul className="mt-2 space-y-1">
              {atRisk.map((l) => (
                <li key={l.owner} className="flex justify-between gap-2">
                  <span className="font-mono">{l.owner.slice(0, 16)}…</span>
                  <span className="font-mono">
                    {l.crBps != null ? (l.crBps / 100).toFixed(1) + "%" : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {!writesAllowed && (
        <section className="card space-y-3 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Keeper tooling required
          </h3>
          <p className="text-sm text-muted-foreground">
            OpenABX does not yet ship a mainnet{" "}
            <span className="font-mono">liquidate</span> write path. The
            LoanManager method index for liquidation has not yet been observable
            on-chain (no liquidation tx has occurred on mainnet since launch —
            every active loan is above the 200 % MCR). Once the first
            liquidation lands, we catalogue the template and enable the button
            on this page.
          </p>
          <p className="text-sm text-muted-foreground">
            Running a keeper today? Build the liquidation script directly
            against LoanManager{" "}
            <span className="font-mono">
              tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB
            </span>{" "}
            — we ship a live watchlist above so you can find at-risk loans and
            monitor when they cross the threshold.
          </p>
        </section>
      )}

      {writesAllowed && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Liquidate by address
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <input
                id="target"
                type="text"
                value={targetOwner}
                onChange={(e) => setTargetOwner(e.target.value)}
                placeholder="1Abc… — paste an Alephium address"
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                Simulation verifies CR &lt; 200% before submission; healthy
                loans throw a readable error instead of signing a doomed tx.
              </p>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                canSubmit
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {isBusy ? "Signing…" : "Liquidate"}
            </button>
            <TxStatusLine state={submit} />
          </form>
        </section>
      )}

      <section className="space-y-2 rounded-lg border border-dashed border-border bg-[hsl(var(--surface-2))]/50 p-4 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          How it works
        </h3>
        <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
          <li>
            You call <span className="font-mono">liquidate(owner)</span> against
            the target loan.
          </li>
          <li>
            LoanManager reads the oracle, verifies CR &lt; 200%, and forwards
            debt + collateral to AuctionManager.
          </li>
          <li>
            AuctionManager walks the four pools (5 → 10 → 15 → 20 %). Each
            absorbs as much debt as its ABD can cover, at a discount.
          </li>
          <li>
            Any surplus ALPH refunds back to the loan owner. The loan closes.
          </li>
        </ol>
      </section>
    </div>
  );
}

function InfoCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-mono text-xl text-primary">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
