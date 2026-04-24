'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchMainnetPoolsTvl, type MainnetPoolTvl } from '@openabx/sdk'
import { NETWORK } from '@/lib/env'

export function usePoolsTvl() {
  return useQuery<MainnetPoolTvl[]>({
    queryKey: ['pools-tvl', NETWORK],
    queryFn: () => fetchMainnetPoolsTvl(NETWORK),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: NETWORK === 'mainnet',
  })
}
