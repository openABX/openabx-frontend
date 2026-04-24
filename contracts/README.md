# `@openabx/contracts`

Ralph smart contracts for OpenABX. Ships TypeScript artefacts consumed by `@openabx/sdk`.

## Commands

```
pnpm compile            # Ralph → artifacts/ts/
pnpm test               # Ralph unit tests (uses sandboxed test-contract; no devnet needed for pure calls)
pnpm devnet:start       # start Alephium devnet container/binary
pnpm deploy:devnet      # deploy everything to local devnet
pnpm deploy:testnet     # deploy to Alephium testnet (requires TESTNET_PRIVATE_KEYS env)
```

## Layout

```
contracts/           # Ralph sources (*.ral)
artifacts/           # generated; gitignored
test/                # TypeScript unit tests via @alephium/web3-test
scripts/             # deploy scripts per alephium.config.ts networks
alephium.config.ts   # toolchain config
```

## Clean-room note

No code in this workspace is derived from the AlphBanX source repository. See root `CONTRIBUTING.md`.
