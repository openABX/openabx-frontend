// React Query hooks over the reader functions in user-position.ts. Each page
// picks the subset it needs. Invalidation is wired by the tx helper — on
// successful tx the caller invalidates any query whose prefix is 'position'.

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useWallet } from "@alephium/web3-react";
import type { Network } from "@openabx/sdk";
import { NETWORK } from "./env";
import {
  fetchLoanPosition,
  fetchPoolPositions,
  fetchProtocolGlobals,
  fetchStakePosition,
  fetchVestingPosition,
  fetchWalletBalances,
  type LoanPosition,
  type PoolPosition,
  type ProtocolGlobals,
  type StakePosition,
  type VestingPosition,
  type WalletBalances,
  EMPTY_LOAN,
  EMPTY_STAKE,
  EMPTY_VESTING,
} from "./user-position";

export function useProtocolGlobals(): UseQueryResult<ProtocolGlobals> {
  return useQuery({
    queryKey: ["globals", NETWORK],
    queryFn: () => fetchProtocolGlobals(NETWORK),
    refetchInterval: 30_000,
  });
}

function useConnectedAddress(): string | null {
  const wallet = useWallet();
  return wallet.connectionStatus === "connected"
    ? wallet.account.address
    : null;
}

function userQueryEnabled(address: string | null): boolean {
  return address !== null;
}

export function useWalletBalances(): UseQueryResult<WalletBalances | null> {
  const address = useConnectedAddress();
  return useQuery({
    queryKey: ["position", NETWORK, "wallet-balance", address],
    queryFn: () =>
      address ? fetchWalletBalances(NETWORK, address) : Promise.resolve(null),
    enabled: userQueryEnabled(address),
    refetchInterval: 20_000,
  });
}

export function useLoanPosition(): UseQueryResult<LoanPosition> {
  const address = useConnectedAddress();
  return useQuery({
    queryKey: ["position", NETWORK, "loan", address],
    queryFn: () =>
      address
        ? fetchLoanPosition(NETWORK, address)
        : Promise.resolve(EMPTY_LOAN),
    enabled: userQueryEnabled(address),
    refetchInterval: 30_000,
  });
}

export function usePoolPositions(): UseQueryResult<PoolPosition[]> {
  const address = useConnectedAddress();
  return useQuery({
    queryKey: ["position", NETWORK, "pools", address],
    queryFn: () =>
      address ? fetchPoolPositions(NETWORK, address) : Promise.resolve([]),
    enabled: userQueryEnabled(address),
    refetchInterval: 30_000,
  });
}

export function useStakePosition(): UseQueryResult<StakePosition> {
  const address = useConnectedAddress();
  return useQuery({
    queryKey: ["position", NETWORK, "stake", address],
    queryFn: () =>
      address
        ? fetchStakePosition(NETWORK, address)
        : Promise.resolve(EMPTY_STAKE),
    enabled: userQueryEnabled(address),
    refetchInterval: 30_000,
  });
}

export function useVestingPosition(): UseQueryResult<VestingPosition> {
  const address = useConnectedAddress();
  return useQuery({
    queryKey: ["position", NETWORK, "vesting", address],
    queryFn: () =>
      address
        ? fetchVestingPosition(NETWORK, address)
        : Promise.resolve(EMPTY_VESTING),
    enabled: userQueryEnabled(address),
    refetchInterval: 60_000,
  });
}

export function useConnectedNetwork(): Network {
  return NETWORK;
}
