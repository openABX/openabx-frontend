"use client";

import { useQuery } from "@tanstack/react-query";
import { scanMainnetLoans, type LoanSnapshot } from "@openabx/sdk";
import { NETWORK } from "@/lib/env";
import { useProtocolGlobals } from "@/lib/hooks";

/** Scanner-backed list of active mainnet loans. Polled every 60s. */
export function useLoanScan(limit = 30) {
  const { data: globals } = useProtocolGlobals();
  const priceAtto = globals?.alphUsd1e18 ?? null;
  return useQuery<LoanSnapshot[]>({
    queryKey: ["loan-scan", NETWORK, String(priceAtto), limit],
    queryFn: () => scanMainnetLoans(NETWORK, priceAtto, limit),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: NETWORK === "mainnet" && priceAtto != null,
  });
}
