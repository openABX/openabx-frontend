"use client";

import { useWallet } from "@alephium/web3-react";
import { NETWORK } from "@/lib/env";
import { canTransact, claimVesting } from "@/lib/tx";
import { useVestingPosition } from "@/lib/hooks";
import { useTxRunner } from "@/lib/hooks/use-tx-runner";
import { bigintToNumber, formatAmount } from "@/lib/format";
import { TxStatusLine } from "@/components/tx-status-line";
import { cn } from "@/lib/utils";

export function VestingActions() {
  const wallet = useWallet();
  const { data: vesting } = useVestingPosition();
  const { state: submit, runTx } = useTxRunner();

  const writesAllowed = canTransact(NETWORK);
  const isConnected = wallet.connectionStatus === "connected";
  const address =
    wallet.connectionStatus === "connected" ? wallet.account.address : null;
  const isBusy =
    submit.kind === "awaitingSign" ||
    submit.kind === "submitted" ||
    submit.kind === "confirming";

  async function handleClaim() {
    if (!address || !wallet.signer) return;
    await runTx(() => claimVesting(NETWORK, wallet.signer!, address));
  }

  const total = vesting?.totalAbxAtto ?? 0n;
  const claimed = vesting?.claimedAtto ?? 0n;
  const vestedFrac =
    vesting && vesting.durationMs > 0n && vesting.startMs > 0n
      ? Math.min(
          1,
          Math.max(
            0,
            (Date.now() - Number(vesting.startMs)) / Number(vesting.durationMs),
          ),
        )
      : 0;

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Your schedule
      </h3>

      {!writesAllowed && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <strong>Vesting is not live on mainnet.</strong> Probed the four
          unlabeled candidate contracts on 2026-04-24 — none have state
          consistent with a live Vesting contract. The Vesting UI below is
          rendered against testnet / dev-net deployments. Once a mainnet Vesting
          contract goes live, our on-chain observer catches it in the next{" "}
          <span className="font-mono">scripts/observe-protocol-writes.ts</span>{" "}
          run and the gate opens automatically.
        </p>
      )}

      {!isConnected && (
        <div className="rounded-lg border border-dashed border-border bg-[hsl(var(--surface-2))]/50 p-6 text-center text-sm text-muted-foreground">
          Connect your wallet to see your vesting schedule.
        </div>
      )}

      {isConnected && !vesting?.exists && (
        <div className="rounded-lg border border-dashed border-border bg-[hsl(var(--surface-2))]/50 p-6 text-center text-sm text-muted-foreground">
          No schedule yet. Deposit ABD into an auction pool and wait for a
          liquidation to credit you with vesting ABX.
        </div>
      )}

      {isConnected && vesting?.exists && (
        <div className="card space-y-4 p-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Total" value={`${formatAmount(total, 9, 2)} ABX`} />
            <Stat
              label="Claimed"
              value={`${formatAmount(claimed, 9, 2)} ABX`}
            />
            <Stat
              label="Claimable now"
              value={`${formatAmount(vesting.claimableAtto, 9, 2)} ABX`}
              highlight={vesting.claimableAtto > 0n}
            />
            <Stat
              label="Vested %"
              value={`${(vestedFrac * 100).toFixed(1)}%`}
            />
          </div>

          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-[hsl(var(--surface-2))]">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    total > 0n
                      ? (bigintToNumber(claimed, 9) /
                          bigintToNumber(total, 9)) *
                          100
                      : 0,
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Claimed so far shown in the bar. The schedule unlocks linearly
              over 12&nbsp;months; full unlock at vested = 100%.
            </p>
          </div>

          {writesAllowed && vesting.claimableAtto > 0n && (
            <button
              type="button"
              disabled={isBusy}
              onClick={handleClaim}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                !isBusy
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {isBusy
                ? "Signing…"
                : `Claim ${formatAmount(vesting.claimableAtto, 9, 2)} ABX`}
            </button>
          )}
          {!writesAllowed && vesting.claimableAtto > 0n && (
            <p className="text-xs text-warning">
              Mainnet Vesting claim pending method-index observation (see{" "}
              <span className="font-mono">docs/07-mainnet-write-path.md</span>).
            </p>
          )}
        </div>
      )}

      <TxStatusLine state={submit} />
    </section>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-[hsl(var(--surface-2))] p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-lg",
          highlight ? "text-primary" : "",
        )}
      >
        {value}
      </p>
    </div>
  );
}
