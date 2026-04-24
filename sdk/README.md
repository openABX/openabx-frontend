# `@openabx/sdk`

TypeScript SDK for OpenABX. Consumed by the Next.js frontend and the indexer.

**Two-network design.** On devnet and testnet the SDK talks to OpenABX's own
clean-room contracts. On mainnet it talks to AlphBanX's already-deployed
contracts — this package ships a separate `abi/alphbanx-mainnet.ts` listing
method indices observed in Phase 0.

## Public API (Phase 1)

- `getClientContext(network)` — returns `{ provider, addresses, isOpenAbxDeployment }`.
- `resolveAddress(network, role)` / `requireAddress(network, role)`.
- `NETWORKS`, `getNetworkConfig(network)`, `isNetwork(x)`.
- `ALPHBANX_MAINNET_METHODS`, `findMainnetMethod(role, label)`.

Typed per-contract clients (LoanManager, AuctionManager, …) land in `src/clients/` during Phase 2.
