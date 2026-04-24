// Overrides for @alephium/web3-react's WalletConnect + Desktop Wallet
// connectors. We pass a `relayUrl` via signClientOptions to force the
// official Reown relay — the default @alephium/walletconnect-provider@3.0.3
// uses the archived wss://relay.walletconnect.org, so proposals never
// reach modern wallet apps.
//
// The third and first connectors (injected — Alephium Extension Wallet)
// come from AlephiumWalletProvider's defaults via the partial-merge
// pattern `{ ...defaultConnectors, ...connectors }` inside the provider.

import {
  createDesktopWalletConnector,
  createWalletConnectConnector,
} from '@alephium/web3-react'

const OFFICIAL_REOWN_RELAY = 'wss://relay.walletconnect.com'

const signClientOptions = { relayUrl: OFFICIAL_REOWN_RELAY }

export const fixedWalletConnectors = {
  walletConnect: createWalletConnectConnector(signClientOptions),
  desktopWallet: createDesktopWalletConnector(signClientOptions),
}
