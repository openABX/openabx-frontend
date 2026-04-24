// Tx confirmation polling. After a signAndSubmit returns a txId, poll the
// node's /transactions/status endpoint until we see confirmed or timed-out.

import type { Network } from "@openabx/sdk";
import { getNetworkConfig } from "@openabx/sdk";

export type TxStatusKind =
  | "unconfirmed"
  | "confirmed"
  | "mempool"
  | "error"
  | "timeout";

export interface TxStatus {
  kind: TxStatusKind;
  confirmations?: number;
  blockHash?: string;
  error?: string;
}

interface NodeTxStatus {
  type: string;
  chainConfirmations?: number;
  blockHash?: string;
  fromGroupConfirmations?: number;
  toGroupConfirmations?: number;
}

/**
 * Poll txId until confirmed or `opts.timeoutMs` elapses. Invokes `onUpdate`
 * on every status change so the UI can render "submitted → mempool →
 * confirmed".
 */
export async function pollTxStatus(
  network: Network,
  txId: string,
  opts: {
    onUpdate?: (s: TxStatus) => void;
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<TxStatus> {
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const start = Date.now();
  let lastKind: TxStatusKind | "" = "";
  opts.onUpdate?.({ kind: "unconfirmed" });

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(
        `${nodeUrl}/transactions/status?txId=${encodeURIComponent(txId)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as NodeTxStatus;
        let kind: TxStatusKind = "unconfirmed";
        if (data.type === "Confirmed") kind = "confirmed";
        else if (data.type === "MemPooled") kind = "mempool";
        else if (data.type === "TxNotFound") kind = "unconfirmed";
        else kind = "unconfirmed";

        const status: TxStatus = {
          kind,
          confirmations: Math.min(
            data.chainConfirmations ?? 0,
            data.fromGroupConfirmations ?? data.chainConfirmations ?? 0,
          ),
          blockHash: data.blockHash,
        };
        if (kind !== lastKind) {
          opts.onUpdate?.(status);
          lastKind = kind;
        }
        if (kind === "confirmed") return status;
      }
    } catch {
      /* ignore, keep polling */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const timeout: TxStatus = { kind: "timeout" };
  opts.onUpdate?.(timeout);
  return timeout;
}
