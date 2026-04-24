'use client'

import { AlephiumWalletProvider } from '@alephium/web3-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { NETWORK } from '@/lib/env'
import { patchWalletConnectProvider } from '@/lib/wallet-connect-patch'
import { fixedWalletConnectors } from '@/lib/wallet-connectors'
import { ConsentProvider } from '@/components/unaudited-consent-gate'

// Apply the WalletConnect namespace-rejection patch at module load, before
// AlephiumWalletProvider creates any WC connectors. This complements the
// relay URL override in `fixedWalletConnectors` — the relay override is the
// primary fix; the namespace patch is defence-in-depth for wallets that
// validate proposals strictly.
if (typeof window !== 'undefined') {
  patchWalletConnectProvider()
}

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AlephiumWalletProvider
        theme="midnight"
        network={NETWORK}
        connectors={fixedWalletConnectors}
      >
        <ConsentProvider>{children}</ConsentProvider>
      </AlephiumWalletProvider>
    </QueryClientProvider>
  )
}
