'use client'

import { AlephiumConnectButton, useWallet } from '@alephium/web3-react'
import { AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Thin wrapper around @alephium/web3-react's prebuilt connect button.
 *
 * Includes a help popover about the upstream
 * `@alephium/walletconnect-provider@3.0.3` bug that emits
 * `optionalNamespaces` without `requiredNamespaces` — newer WalletConnect
 * wallet clients reject this with "The proposal does not include a list
 * of required chains". Workaround: use the Alephium Extension Wallet or
 * Desktop Wallet, which don't use WalletConnect at all.
 *
 * The connect button's rendered output depends on wallet-reconnect state
 * that only becomes known post-hydration (different icon / label when a
 * prior session resumes). Rendering it during SSR produces a hydration
 * mismatch, so we defer it to the first client effect.
 */
export function WalletButton() {
  const wallet = useWallet()
  const isConnected = wallet.connectionStatus === 'connected'
  const [showHelp, setShowHelp] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  if (!mounted) {
    // Fixed-size placeholder so the header doesn't shift when the real
    // button mounts. Matches the connect button's rough footprint.
    return (
      <div
        className="inline-flex h-9 w-32 items-center justify-center rounded-md border border-border bg-muted/40 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        …
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <AlephiumConnectButton />
      {!isConnected && (
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Wallet connection help"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Can&rsquo;t connect?
          </button>
          {showHelp && (
            <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-md border border-border bg-background p-3 text-xs shadow-lg">
              <p className="font-medium text-foreground">
                WalletConnect &quot;no required chains&quot;?
              </p>
              <p className="mt-1 text-muted-foreground">
                Upstream bug in{' '}
                <span className="font-mono">
                  @alephium/walletconnect-provider@3.0.3
                </span>{' '}
                — its proposals omit <span className="font-mono">requiredNamespaces</span>,
                which newer wallets reject.
              </p>
              <p className="mt-2 text-muted-foreground">
                <span className="text-foreground">Workaround:</span> install
                the{' '}
                <a
                  href="https://chromewebstore.google.com/detail/alephium-extension-wallet/gdokollfhmnbfckbobkdbakhilldkhcj"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Alephium Extension Wallet
                </a>{' '}
                or{' '}
                <a
                  href="https://alephium.org/#wallets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Desktop Wallet
                </a>
                . Both bypass WalletConnect entirely.
              </p>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="mt-2 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
