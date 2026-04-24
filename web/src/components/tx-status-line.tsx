"use client";

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { TxRunnerState } from "@/lib/hooks/use-tx-runner";
import { explorerTxUrl } from "@/lib/validation";
import { cn } from "@/lib/utils";

export function TxStatusLine({ state }: { state: TxRunnerState }) {
  if (state.kind === "idle") return null;
  switch (state.kind) {
    case "simulating":
      return (
        <StatusLine tone="info" Icon={Loader2} spin>
          Simulating transaction against mainnet state…
        </StatusLine>
      );
    case "awaitingSign":
      return (
        <StatusLine tone="info" Icon={Loader2} spin>
          Waiting for you to sign in your wallet…
        </StatusLine>
      );
    case "submitted":
      return (
        <StatusLine tone="info" Icon={Clock}>
          Submitted — <TxLink txId={state.txId} />— waiting for block inclusion.
        </StatusLine>
      );
    case "confirming":
      return (
        <StatusLine tone="info" Icon={Loader2} spin>
          In mempool — <TxLink txId={state.txId} />
          {state.confirmations != null
            ? ` (${state.confirmations} confirmations)`
            : ""}
          …
        </StatusLine>
      );
    case "confirmed":
      return (
        <StatusLine tone="success" Icon={CheckCircle2}>
          Confirmed on-chain — <TxLink txId={state.txId} />
        </StatusLine>
      );
    case "error":
      return (
        <StatusLine tone="error" Icon={XCircle}>
          {state.message}
        </StatusLine>
      );
  }
}

function TxLink({ txId }: { txId: string }) {
  return (
    <a
      href={explorerTxUrl(txId)}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono underline-offset-4 hover:underline"
    >
      {txId.slice(0, 8)}…{txId.slice(-4)}
    </a>
  );
}

function StatusLine({
  tone,
  Icon,
  spin,
  children,
}: {
  tone: "info" | "success" | "error";
  Icon: typeof Loader2;
  spin?: boolean;
  children: React.ReactNode;
}) {
  const colors = {
    info: "border-primary/30 bg-primary/10 text-foreground",
    success: "border-primary/40 bg-primary/15 text-primary",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        colors,
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", spin && "animate-spin")}
        aria-hidden="true"
      />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
