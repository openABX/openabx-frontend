"use client";

import { useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { NETWORK } from "@/lib/env";
import {
  canTransactOp,
  claimFromPool,
  depositToPool,
  withdrawFromPool,
  type PoolTier,
} from "@/lib/tx";
import { usePoolPositions, useWalletBalances } from "@/lib/hooks";
import { useTxRunner } from "@/lib/hooks/use-tx-runner";
import { formatAmount, numberToBigint } from "@/lib/format";
import { TxStatusLine } from "@/components/tx-status-line";
import { cn } from "@/lib/utils";

const TIERS: Array<{
  bps: PoolTier;
  discount: number;
  feeBps: number;
  accent: string;
}> = [
  { bps: 500, discount: 5, feeBps: 50, accent: "text-green-600" },
  { bps: 1000, discount: 10, feeBps: 100, accent: "text-emerald-500" },
  { bps: 1500, discount: 15, feeBps: 150, accent: "text-amber-500" },
  { bps: 2000, discount: 20, feeBps: 200, accent: "text-orange-500" },
];

type Action = "deposit" | "withdraw";

export function AuctionActions() {
  const wallet = useWallet();
  const { data: pools } = usePoolPositions();
  const { data: balances } = useWalletBalances();
  const [amounts, setAmounts] = useState<Record<PoolTier, string>>({
    500: "",
    1000: "",
    1500: "",
    2000: "",
  });
  const [modes, setModes] = useState<Record<PoolTier, Action>>({
    500: "deposit",
    1000: "deposit",
    1500: "deposit",
    2000: "deposit",
  });
  const { state: submit, runTx } = useTxRunner();

  const depositAllowed = canTransactOp(NETWORK, "poolDeposit");
  const withdrawAllowed = canTransactOp(NETWORK, "poolWithdraw");
  const claimAllowed = canTransactOp(NETWORK, "poolClaim");
  const writesAllowed = depositAllowed || withdrawAllowed || claimAllowed;
  const isConnected = wallet.connectionStatus === "connected";
  const isBusy =
    submit.kind === "awaitingSign" ||
    submit.kind === "submitted" ||
    submit.kind === "confirming";

  // Audit fix H4: surface deposits whose tier OpenABX could not decode.
  // We will not let users route deposit/withdraw/claim at a guessed tier
  // — the warning directs them to AlphBanX's UI for that position.
  const undetermined = (pools ?? []).find(
    (p) => p.tierUndetermined && p.abdAtto > 0n,
  );

  async function runAction(bps: PoolTier, action: Action | "claim") {
    if (!isConnected || !wallet.signer) return;
    if (action === "claim") {
      const pos = pools?.find((p) => p.discountBps === bps);
      const claim = pos?.claimableAlphAtto ?? 0n;
      // Guard at the call site: the SDK throws on <= 0n, but bouncing here
      // means the user gets the explanatory tx-error toast instead of an
      // exception with no recovery. The UI also only renders the Claim
      // button when claimable > 0, so this should be unreachable in
      // practice; left as defence-in-depth.
      if (claim <= 0n) return;
      await runTx(() => claimFromPool(NETWORK, wallet.signer!, bps, claim));
      return;
    }
    const raw = Number(amounts[bps]) || 0;
    if (raw <= 0) return;
    const atto = numberToBigint(raw, 9);
    if (atto <= 0n) return;
    await runTx(() =>
      action === "deposit"
        ? depositToPool(NETWORK, wallet.signer!, bps, atto)
        : withdrawFromPool(NETWORK, wallet.signer!, bps, atto),
    );
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Deposit, withdraw, claim
      </h3>
      {undetermined && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <p className="font-medium">
            We detected an auction-pool deposit of{" "}
            <span className="font-mono">
              {formatAmount(undetermined.abdAtto, 9, 2)} ABD
            </span>{" "}
            in your wallet&rsquo;s pool sub-contract, but could not decode its
            tier from on-chain state.
          </p>
          <p className="mt-1 text-warning/90">
            OpenABX will not route deposit / withdraw / claim against an unknown
            tier — please manage this position from{" "}
            <a
              href="https://app.alphbanx.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline-offset-2 hover:underline"
            >
              app.alphbanx.com
            </a>{" "}
            and file an issue at{" "}
            <a
              href="https://github.com/openABX/openABX-frontend/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline-offset-2 hover:underline"
            >
              github.com/openABX/openABX-frontend/issues
            </a>{" "}
            so we can pin the tier-detection slot.
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => {
          // H4: filter out undetermined-tier placeholder so we don't
          // misattribute the deposit to the 500-bps card. The banner
          // above carries that surfacing.
          const pool = pools?.find(
            (p) => p.discountBps === tier.bps && !p.tierUndetermined,
          );
          const mode = modes[tier.bps];

          return (
            <div key={tier.bps} className="card flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <h4 className={cn("text-lg font-semibold", tier.accent)}>
                  {tier.discount}% pool
                </h4>
                <span className="text-xs text-muted-foreground">
                  fee {(tier.feeBps / 100).toFixed(1)}%
                </span>
              </div>
              {pool && (
                <div className="rounded-md border border-border/50 bg-[hsl(var(--surface-2))] p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your deposit</span>
                    <span className="font-mono">
                      {formatAmount(pool.abdAtto, 9, 2)} ABD
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Claimable</span>
                    <span className="font-mono">
                      {formatAmount(pool.claimableAlphAtto, 18, 4)} ALPH
                    </span>
                  </div>
                </div>
              )}
              {writesAllowed ? (
                <>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={!depositAllowed}
                      onClick={() =>
                        setModes((m) => ({ ...m, [tier.bps]: "deposit" }))
                      }
                      className={cn(
                        "flex-1 rounded-md border px-2 py-1 text-xs",
                        mode === "deposit"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary/60",
                        !depositAllowed && "cursor-not-allowed opacity-50",
                      )}
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      disabled={!withdrawAllowed}
                      onClick={() =>
                        withdrawAllowed &&
                        setModes((m) => ({ ...m, [tier.bps]: "withdraw" }))
                      }
                      className={cn(
                        "flex-1 rounded-md border px-2 py-1 text-xs",
                        mode === "withdraw"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary/60",
                        !withdrawAllowed && "cursor-not-allowed opacity-50",
                      )}
                      title={!withdrawAllowed ? "Mainnet withdraw pending" : ""}
                    >
                      Withdraw
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amounts[tier.bps]}
                    onChange={(e) =>
                      setAmounts((a) => ({
                        ...a,
                        [tier.bps]: e.target.value,
                      }))
                    }
                    placeholder={
                      mode === "deposit"
                        ? `ABD (max ${formatAmount(
                            balances?.abdAtto ?? null,
                            9,
                            2,
                          )})`
                        : "ABD to withdraw"
                    }
                    className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    disabled={!isConnected || isBusy}
                    onClick={() => runAction(tier.bps, mode)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isConnected && !isBusy
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "cursor-not-allowed bg-muted text-muted-foreground",
                    )}
                  >
                    {isBusy
                      ? "Signing…"
                      : !isConnected
                        ? "Connect wallet"
                        : mode === "deposit"
                          ? "Deposit"
                          : "Withdraw"}
                  </button>
                  {claimAllowed && (pool?.claimableAlphAtto ?? 0n) > 0n && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => runAction(tier.bps, "claim")}
                      className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/15"
                    >
                      Claim {formatAmount(pool?.claimableAlphAtto ?? 0n, 18, 4)}{" "}
                      ALPH
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-auto cursor-not-allowed rounded-md bg-muted px-3 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  Mainnet write pending
                </button>
              )}
            </div>
          );
        })}
      </div>
      <TxStatusLine state={submit} />
    </section>
  );
}
