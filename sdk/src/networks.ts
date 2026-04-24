// Supported networks for OpenABX. Drives both on-chain calls and address resolution.

export const NETWORKS = ['devnet', 'testnet', 'mainnet'] as const
export type Network = (typeof NETWORKS)[number]

export function isNetwork(x: unknown): x is Network {
  return typeof x === 'string' && (NETWORKS as readonly string[]).includes(x)
}

export interface NetworkConfig {
  readonly name: Network
  readonly nodeUrl: string
  readonly backendUrl: string
  readonly networkId: number
  readonly confirmations: number
  /** True if the deployed contracts are OpenABX's clean-room implementation. */
  readonly isOpenAbxDeployment: boolean
}

const DEFAULTS: Record<Network, NetworkConfig> = {
  devnet: {
    name: 'devnet',
    nodeUrl: 'http://127.0.0.1:22973',
    backendUrl: 'http://127.0.0.1:22973',
    networkId: 4,
    confirmations: 1,
    isOpenAbxDeployment: true,
  },
  testnet: {
    name: 'testnet',
    nodeUrl: 'https://node.testnet.alephium.org',
    backendUrl: 'https://backend.testnet.alephium.org',
    networkId: 1,
    confirmations: 2,
    isOpenAbxDeployment: true,
  },
  mainnet: {
    name: 'mainnet',
    // On mainnet we talk to AlphBanX's existing contracts. We did not deploy them.
    nodeUrl: 'https://node.mainnet.alephium.org',
    backendUrl: 'https://backend.mainnet.alephium.org',
    networkId: 0,
    confirmations: 3,
    isOpenAbxDeployment: false,
  },
}

export function getNetworkConfig(network: Network): NetworkConfig {
  return DEFAULTS[network]
}
