// High-level client factory. Routes calls to the right ABI/address source
// based on the selected network. Thin on purpose — most of the heavy lifting
// lives in typed per-contract clients that will be generated in Phase 2 from
// @openabx/contracts's artifacts.

import { NodeProvider, web3 } from '@alephium/web3'
import { getNetworkConfig, type Network } from './networks'
import { resolveAddresses, type AddressBook, type ContractRole } from './addresses'

export interface ClientContext {
  readonly network: Network
  readonly provider: NodeProvider
  readonly addresses: AddressBook
  /**
   * True when we are talking to our own clean-room OpenABX contracts. On
   * mainnet this is false — the frontend is a third-party UI over AlphBanX's
   * deployed contracts.
   */
  readonly isOpenAbxDeployment: boolean
}

let cached: ClientContext | null = null

/**
 * Build or return the shared client context for a given network. Idempotent.
 * Typed per-contract clients (LoanManager, AuctionManager, etc.) will accept a
 * ClientContext and route reads/writes through `provider` + `addresses`.
 */
export function getClientContext(network: Network, fetchImpl?: typeof fetch): ClientContext {
  if (cached && cached.network === network) return cached

  const cfg = getNetworkConfig(network)
  const provider = new NodeProvider(cfg.nodeUrl, undefined, fetchImpl)
  web3.setCurrentNodeProvider(provider)

  cached = {
    network,
    provider,
    addresses: resolveAddresses(network),
    isOpenAbxDeployment: cfg.isOpenAbxDeployment,
  }
  return cached
}

export function clearClientContext(): void {
  cached = null
}

/** Convenience getter — throws if the address for `role` is not known. */
export function getContractAddress(ctx: ClientContext, role: ContractRole): string {
  const addr = ctx.addresses[role]
  if (!addr) {
    throw new Error(
      `OpenABX SDK: ${role} has no address on ${ctx.network}. See resolveAddress().`,
    )
  }
  return addr
}
