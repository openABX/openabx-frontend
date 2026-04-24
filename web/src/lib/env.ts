import { isNetwork, type Network } from '@openabx/sdk'

/**
 * Resolve the network from NEXT_PUBLIC_NETWORK. Falls back to 'testnet'.
 * This is read once at module load and never changes in a browser session.
 */
export const NETWORK: Network = (() => {
  const raw = process.env['NEXT_PUBLIC_NETWORK']
  if (raw && isNetwork(raw)) return raw
  return 'testnet'
})()

export const ENABLE_DEV_ROUTES = process.env['NEXT_PUBLIC_ENABLE_DEV_ROUTES'] === 'true'
export const WALLETCONNECT_PROJECT_ID = process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? ''

export function isMainnet(): boolean {
  return NETWORK === 'mainnet'
}
