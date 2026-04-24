# `@openabx/web`

Next.js 14 App Router frontend for OpenABX. Wallet connect works against any
supported Alephium network; real protocol pages (Dashboard, Borrow, Auction,
Stake, Vesting) land in Phase 6.

## Commands

```
pnpm dev         # localhost:3000
pnpm build
pnpm start
pnpm typecheck
pnpm lint
```

## Environment

```
NEXT_PUBLIC_NETWORK=devnet|testnet|mainnet     # default: testnet
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...       # optional
NEXT_PUBLIC_ENABLE_DEV_ROUTES=false            # /dev/* routes gated on this
NEXT_PUBLIC_INDEXER_URL=http://127.0.0.1:4000
```

When `NEXT_PUBLIC_NETWORK=mainnet`, the layout renders a persistent banner
reminding users the app calls third-party contracts we did not deploy or audit.

## Stack

- Next.js 14 App Router, TS strict.
- Tailwind CSS + shadcn/ui primitives.
- `@alephium/web3-react` for wallet + provider context.
- `@tanstack/react-query` for on-chain reads.
