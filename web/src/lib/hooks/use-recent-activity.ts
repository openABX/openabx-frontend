"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@alephium/web3-react";
import { getNetworkConfig } from "@openabx/sdk";
import { NETWORK } from "@/lib/env";

export type ActivityKind =
  | "openLoan"
  | "repay"
  | "addCollateral"
  | "withdrawCollateral"
  | "closeLoan"
  | "redeem"
  | "stake"
  | "unstake"
  | "claim"
  | "poolDeposit"
  | "poolWithdraw"
  | "poolClaim"
  | "other";

export interface ActivityEntry {
  txId: string;
  timestamp: number;
  kind: ActivityKind;
  alphDelta: bigint;
  abdDelta: bigint;
  abxDelta: bigint;
}

interface ExplorerTx {
  hash: string;
  timestamp: number;
  inputs?: Array<{
    address?: string;
    contractInput: boolean;
    attoAlphAmount?: string;
    tokens?: Array<{ id: string; amount: string }>;
  }>;
  outputs?: Array<{
    type: string;
    address: string;
    attoAlphAmount?: string;
    tokens?: Array<{ id: string; amount: string }>;
  }>;
}

// Token IDs on mainnet (derived via contractIdFromAddress).
const ABD_ID =
  "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500";
const ABX_ID =
  "9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00";

function classify(
  alphDelta: bigint,
  abdDelta: bigint,
  abxDelta: bigint,
): ActivityKind {
  // Heuristic: inspect signed token deltas to label the tx for the user.
  // This is display-only — if we mis-classify, the txId still links to the
  // explorer where the truth lives.
  if (abxDelta > 0n && abdDelta === 0n && alphDelta < 0n) return "stake";
  if (abxDelta < 0n && abdDelta === 0n) return "unstake";
  if (abxDelta === 0n && abdDelta > 0n && alphDelta < 0n) return "openLoan";
  if (abxDelta === 0n && abdDelta < 0n && alphDelta < 0n) return "repay";
  if (abxDelta === 0n && abdDelta === 0n && alphDelta < 0n)
    return "addCollateral";
  if (abxDelta === 0n && abdDelta === 0n && alphDelta > 0n)
    return "withdrawCollateral";
  if (abxDelta === 0n && abdDelta > 0n && alphDelta > 0n) return "closeLoan";
  if (abxDelta === 0n && abdDelta < 0n && alphDelta > 0n) return "redeem";
  if (abxDelta > 0n || alphDelta > 0n) return "claim";
  return "other";
}

export function useRecentActivity() {
  const wallet = useWallet();
  const address =
    wallet.connectionStatus === "connected" ? wallet.account.address : null;
  const backend = getNetworkConfig(NETWORK).backendUrl;

  return useQuery({
    queryKey: ["recent-activity", NETWORK, address],
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ActivityEntry[]> => {
      if (!address) return [];
      const res = await fetch(
        `${backend}/addresses/${address}/transactions?page=1&limit=10`,
      );
      if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
      const txs = (await res.json()) as ExplorerTx[];

      return txs.map((tx) => {
        let alphDelta = 0n;
        let abdDelta = 0n;
        let abxDelta = 0n;
        for (const inp of tx.inputs ?? []) {
          if (inp.contractInput || inp.address !== address) continue;
          alphDelta -= BigInt(inp.attoAlphAmount ?? "0");
          for (const t of inp.tokens ?? []) {
            if (t.id === ABD_ID) abdDelta -= BigInt(t.amount);
            else if (t.id === ABX_ID) abxDelta -= BigInt(t.amount);
          }
        }
        for (const o of tx.outputs ?? []) {
          if (o.address !== address) continue;
          alphDelta += BigInt(o.attoAlphAmount ?? "0");
          for (const t of o.tokens ?? []) {
            if (t.id === ABD_ID) abdDelta += BigInt(t.amount);
            else if (t.id === ABX_ID) abxDelta += BigInt(t.amount);
          }
        }
        return {
          txId: tx.hash,
          timestamp: tx.timestamp,
          kind: classify(alphDelta, abdDelta, abxDelta),
          alphDelta,
          abdDelta,
          abxDelta,
        };
      });
    },
  });
}
