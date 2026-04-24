<div align="center">

# OpenABX

**An open-source, clean-room UI for the AlphBanX stablecoin protocol on Alephium.**

Unaffiliated with AlphBanX. Client-only. Hosted on GitHub Pages.

[![CI](https://github.com/openabx/openabx/actions/workflows/ci.yml/badge.svg)](https://github.com/openabx/openabx/actions/workflows/ci.yml)
[![Mainnet address drift](https://github.com/openabx/openabx/actions/workflows/verify-mainnet.yml/badge.svg)](https://github.com/openabx/openabx/actions/workflows/verify-mainnet.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg)](./LICENSE)

[Live site](https://openabx.github.io/openabx/) · [Release notes](./RELEASE-CANDIDATE.md) · [Security](./docs/05-security.md) · [Protocol spec](./docs/00-protocol-spec.md)

</div>

---

## What this is

AlphBanX is a CDP stablecoin protocol on Alephium — borrow **ABD** against **ALPH**, earn by absorbing liquidations in four auction pools, stake **ABX** for a share of every protocol fee. The contracts are live on mainnet.

OpenABX is an independent, MIT-licensed user interface to those same contracts. Everything a user can do at `app.alphbanx.com` — borrow, stake, deposit, redeem — also works here. Every write is **simulated against mainnet state before your wallet signs**, so if it would revert, you see the error instead of signing a failing tx.

**Why it exists:** if the primary UI ever goes offline, OpenABX keeps working. That's the whole pitch.

## What's in the repo

Two artefacts:

1. **Next.js frontend** (`web/`) — 10 routes, fully client-side, deployed as a static bundle to GitHub Pages.
2. **Reference Ralph contracts** (`contracts/`) — 17 contracts, 155 unit tests, **testnet-only**. We do NOT redeploy to mainnet; the reference implementation exists so the spec is executable, not to compete with AlphBanX.

## Mainnet status

| Operation                                        | Status                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| Borrow / repay / close / add+withdraw collateral | ✅ wired, simulation-gated                              |
| Redeem (unified with closeLoan, mi=19)           | ✅ wired                                                |
| Stake / unstake / claim rewards                  | ✅ wired, full drain per claim (see note below)         |
| Auction pool deposit / withdraw / claim          | ✅ wired                                                |
| Liquidate                                        | ⏳ keeper-only — no live sample tx to template from yet |
| Vesting claim                                    | ⏳ AlphBanX hasn't activated Vesting on mainnet         |

13 of 14 operations are live, simulation-verified end-to-end. A daily GitHub Actions cron re-hashes every AlphBanX mainnet contract and auto-opens an incident issue on drift.

**Claim-rewards correctness (2026-04-24).** The AlphBanX `StakeManager.claim` method takes its U256 arg as a hard cap (`transferred = min(arg, realPending)`), not as an ignored hint — confirmed via live simulation-diff against tx `bc74392f…a3a6c`. Earlier OpenABX builds baked the sample-tx value of 5.386 ALPH into the script, silently short-paying any user with more pending than that. Both the displayed pending (now read via a claim-simulation probe) and the claim tx itself (now sends an oversized arg so the contract caps at actual pending) drain fully in one click. Users short-paid by the prior version can simply click Claim again to recover the stuck remainder; no on-chain migration required.

## Pre-audit status

**Do not use the OpenABX reference contracts with real funds.** A self-administered red team found 91 findings, 19 Critical. 11 Criticals are fixed; 8 remain open (snapshot-rebase cluster, CircuitBreaker wiring gap, burn-source bug). Full status in [`audit/00-RED-TEAM-SUMMARY.md`](./audit/00-RED-TEAM-SUMMARY.md).

The **mainnet frontend** is not affected by any of these — we don't deploy those contracts to mainnet. The UI talks to AlphBanX's contracts, whose audit belongs to AlphBanX.

## Quick start

```bash
pnpm i
pnpm typecheck && pnpm lint && pnpm test
pnpm -C web dev                  # http://localhost:3000
```

Default network is `mainnet` (read + write against AlphBanX's live contracts). Set `NEXT_PUBLIC_NETWORK=testnet` to point at our own deployment.

Build a static bundle to match what GitHub Pages serves:

```bash
pnpm -C web build                # output: web/out/
```

## Hosting your own mirror

```bash
git clone https://github.com/openabx/openabx
cd openabx
pnpm i
NEXT_PUBLIC_NETWORK=mainnet pnpm -C web build
# serve web/out/ from any static host
```

Fork, tag, deploy. OpenABX can't push an update to your mirror unless you pull.

## Clean-room discipline

Before any line of code was written:

- No JavaScript source from `app.alphbanx.com` was read.
- No Ralph bytecode has been decompiled.
- Every mainnet write template is built from **publicly observable transactions** — decoded, decompiled never.
- AlphBanX's own source repo has been **intentionally not accessed**.

Every commit message and `CONTRIBUTING.md` reaffirms this discipline.

## Repository layout

```
web/          Next.js 14 frontend — 10 routes, static export
contracts/    17 Ralph contracts, 155 unit tests (testnet-only)
sdk/          TypeScript SDK: network, addresses, ABIs, mainnet templates
scripts/      Operator scripts: verify-mainnet-addresses, observe-alphbanx-writes
.github/      CI + Pages deploy + daily address-drift cron
docs/         Spec, architecture, reward math, security, incident response
audit/        Self-administered red-team audit + remediation status
references/   Published paper, contract address log, operation templates
```

## Where to read next

- [`RELEASE-CANDIDATE.md`](./RELEASE-CANDIDATE.md) — what's in v0.1.0-beta, what's deferred.
- [`docs/05-security.md`](./docs/05-security.md) — threat model, incident-response playbook, drill cadence.
- [`docs/messaging-launch.md`](./docs/messaging-launch.md) — launch copy, moderator FAQ.
- [`docs/00-protocol-spec.md`](./docs/00-protocol-spec.md) — normative spec synthesised from paper + GitBook + on-chain observation.
- [`docs/07-mainnet-write-path.md`](./docs/07-mainnet-write-path.md) — how the mainnet operation templates were built.
- [`references/alphbanx-contract-addresses.md`](./references/alphbanx-contract-addresses.md) — AlphBanX mainnet addresses + testnet set.

## Security

Report vulnerabilities via GitHub Security Advisory or a private issue. See [`docs/05-security.md §Incident response`](./docs/05-security.md#incident-response) for what happens next.

For security issues in **AlphBanX's mainnet contracts**: not our contracts. Report to AlphBanX directly via their Discord / Telegram.

## Acknowledgements

- Zahnentferner, _"BanX: A Hybrid Crypto-Backed and Crypto-Collateralized Stablecoin Protocol"_ (Nov 2024) — foundational design.
- AlphBanX team — for the live mainnet deployment and public GitBook.
- Inference AG — the public audit that gave us the canonical decomposition.
- Liquity Labs — the v1 Stability Pool + SortedTroves patterns.
- Alephium core team — Ralph, SDK, explorer, testnet reliability.
- DIA — ALPH/USD oracle feed.

## License

[MIT](./LICENSE). Fork freely.
