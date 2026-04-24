"use client";

import { useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { NETWORK } from "@/lib/env";
import {
  addCollateral,
  borrowMore,
  canTransactOp,
  closeLoan,
  repay,
  withdrawCollateral,
} from "@/lib/tx";
import { useLoanPosition, useWalletBalances } from "@/lib/hooks";
import { useTxRunner } from "@/lib/hooks/use-tx-runner";
import { bigintToNumber, formatAmount, numberToBigint } from "@/lib/format";
import { TxStatusLine } from "@/components/tx-status-line";
import { cn } from "@/lib/utils";

type ManageAction =
  | "addCollateral"
  | "withdrawCollateral"
  | "borrowMore"
  | "repay";

export function LoanManage() {
  const wallet = useWallet();
  const { data: loan } = useLoanPosition();
  const { data: balances } = useWalletBalances();
  const [action, setAction] = useState<ManageAction>("addCollateral");
  const [amount, setAmount] = useState("");
  const { state: submit, runTx } = useTxRunner();

  // Mainnet enables all four loan-modify operations via the simulate-before-
  // sign path; testnet/devnet enables via typed clients.
  const writesAllowed = canTransactOp(NETWORK, "repay");
  const isConnected = wallet.connectionStatus === "connected";
  const address =
    wallet.connectionStatus === "connected" ? wallet.account.address : null;

  if (!isConnected) return null;
  if (!loan?.exists || !writesAllowed) return null;

  const isBusy =
    submit.kind === "awaitingSign" ||
    submit.kind === "submitted" ||
    submit.kind === "confirming";

  async function runPrimary(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.signer || !address) return;
    const raw = Number(amount) || 0;
    if (raw <= 0) return;
    const decimals =
      action === "addCollateral" || action === "withdrawCollateral" ? 18 : 9;
    const atto = numberToBigint(raw, decimals);
    if (atto <= 0n) return;
    await runTx(async () => {
      switch (action) {
        case "addCollateral":
          return addCollateral(NETWORK, wallet.signer!, atto);
        case "withdrawCollateral":
          return withdrawCollateral(NETWORK, wallet.signer!, atto);
        case "borrowMore":
          return borrowMore(NETWORK, wallet.signer!, atto);
        case "repay":
          return repay(NETWORK, wallet.signer!, address, atto);
      }
    });
    setAmount("");
  }

  async function runClose() {
    if (!wallet.signer || !loan?.exists) return;
    await runTx(() => closeLoan(NETWORK, wallet.signer!, loan.debtAtto));
  }

  const actions: Array<{ id: ManageAction; label: string; unit: string }> = [
    { id: "addCollateral", label: "Add collateral", unit: "ALPH" },
    { id: "withdrawCollateral", label: "Withdraw collateral", unit: "ALPH" },
    { id: "borrowMore", label: "Borrow more", unit: "ABD" },
    { id: "repay", label: "Repay", unit: "ABD" },
  ];

  const activeAction = actions.find((a) => a.id === action)!;

  return (
    <section className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">
        Manage your existing loan
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Collateral"
          value={`${formatAmount(loan.collateralAtto, 18, 4)} ALPH`}
        />
        <Stat label="Debt" value={`${formatAmount(loan.debtAtto, 9, 2)} ABD`} />
        <Stat
          label="Rate"
          value={`${(bigintToNumber(loan.interestRate1e18, 18) * 100).toFixed(0)}% / yr`}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAction(a.id)}
            className={cn(
              "rounded-md border px-3 py-1 text-xs",
              action === a.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/60",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={runPrimary}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1 space-y-1">
          <label
            htmlFor="manage-amount"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            {activeAction.label} amount ({activeAction.unit})
          </label>
          <input
            id="manage-amount"
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          {action === "addCollateral" && balances?.alphAtto != null && (
            <p className="text-xs text-muted-foreground">
              Wallet: {formatAmount(balances.alphAtto, 18, 3)} ALPH
            </p>
          )}
          {action === "repay" && balances?.abdAtto != null && (
            <p className="text-xs text-muted-foreground">
              Wallet: {formatAmount(balances.abdAtto, 9, 2)} ABD
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={isBusy}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
            !isBusy
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
        >
          {isBusy ? "Signing…" : activeAction.label}
        </button>
      </form>

      <button
        type="button"
        onClick={runClose}
        disabled={loan.debtAtto > 0n || isBusy}
        className={cn(
          "rounded-md border px-3 py-2 text-xs",
          loan.debtAtto === 0n && !isBusy
            ? "border-destructive/60 text-destructive hover:bg-destructive/5"
            : "cursor-not-allowed border-border text-muted-foreground",
        )}
        title={
          loan.debtAtto > 0n
            ? "Repay the full debt before closing"
            : "Close loan and withdraw all collateral"
        }
      >
        {isBusy ? "Signing…" : "Close loan"}
      </button>

      <TxStatusLine state={submit} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-[hsl(var(--surface-2))] p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
