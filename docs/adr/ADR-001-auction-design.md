# ADR-001: Auction design — four discrete discount pools

**Status:** accepted (2026-04-22)
**Decider:** Project owner (user-level decision captured in revised plan)

## Context

The Zahnentferner protocol paper `references/alphbanx-protocol-paper.pdf` describes the auction-side liquidity mechanism as a **continuous bid book**: every auction bid `b` carries its own requested discount `d(b)` and its own ABD amount `q(b)`; bids are stored in a single sorted list `𝓑` ordered by requested discount; liquidations walk `𝓑` from lowest discount upward.

The AlphBanX GitBook, live app (`/auction` page), and on-chain mainnet state all implement a **four-pool** architecture instead: four discrete `AuctionPool` subcontracts at 5 %, 10 %, 15 %, 20 % discount. Depositors pick a pool; within a pool, everyone shares liquidation proceeds proportionally via P/S snapshot math. Liquidations walk the four pools lowest-discount-first.

The audit report's adversarial scenario list confirms the pool-based design: "Place bids with a high discount rate to be preferred over bids with a lower discount rate" (inter-pool priority); "Place bids to be preferred over other bids of the same discount rate created earlier" (within-pool ordering). The verbatim on-chain mutable fields of the `AuctionManager` at `29YL53te…` encode exactly four bid fees `[0.5 %, 1 %, 1.5 %, 2 %]` matching the four tiers.

## Decision

OpenABX implements the **four-pool** design.

- `AuctionManager` parent contract.
- Four `AuctionPool` subcontracts at fixed discounts 5 / 10 / 15 / 20 %.
- Per-pool P/S snapshot accounting (Liquity stability-pool pattern).
- Liquidation cascade: try pool 0 first; if insufficient ABD, cascade to pool 1; etc.
- Per-pool successful-bid fees 0.5 / 1 / 1.5 / 2 %.

The paper's continuous bid-book is explicitly **considered and rejected**.

## Consequences

### Positive

- **Matches live app and user expectation.** The live `/auction` UI exposes exactly these four pools as first-class choices; depositors are used to this model.
- **Matches on-chain behaviour.** Any future migration or interop with AlphBanX's mainnet contracts is simpler with the same architecture.
- **Proven pattern.** Liquity v1's Stability Pool is battle-tested; the P/S math has been audited at scale.
- **Gas-efficient.** One ABD deposit in a pool is O(1) on-chain (update share snapshot); no list insertion.
- **Low cognitive load.** Depositors pick a discount once; they don't need to micro-manage individual bids.

### Negative

- **Capital inefficiency vs bid book.** A user willing to take 17 % discount is forced to the 20 % bucket (overpaid) or the 15 % bucket (risking mismatch). A continuous bid book would let them state 17 % exactly.
- **Divergence from paper.** OpenABX cannot claim "faithful implementation of the Zahnentferner protocol paper" — it is a faithful implementation of the AlphBanX _product_, which diverges from the paper.
- **Discrete discontinuities.** Capital flows will cluster at the 4 tier boundaries; fee revenue is concentrated in whichever tier is currently matched.

### Mitigations for the negatives

- Document clearly in `docs/00-protocol-spec.md §8` that this is a deliberate deviation from the paper.
- Allow governance to add/remove/adjust pool tiers in a future version (v2 scope).
- Do not claim paper fidelity in marketing copy.

## Alternatives considered

### A. Continuous bid book (per paper §2.4.9–2.4.11)

- Single `BidBook` contract holding a sorted list of `Bid` subcontracts.
- Liquidations walk the list lowest-discount-first, consuming bids partially or fully.
- **Rejected because:** the live AlphBanX app implements pools; matching the live product was the user's binding constraint. Also: a bid-book requires TWO sorted lists (loans by `ir`, bids by `d(b)`), doubling the indexer + hint-verification complexity.

### B. Hybrid — bid book on-chain, pool UI

- On-chain: continuous bids per paper.
- Frontend: four pool buttons as quick-fill presets that create bids at 5/10/15/20 %.
- **Rejected because:** user receipts and dashboard stats would not match AlphBanX terminology; a depositor who used our UI and later switched to `app.alphbanx.com` would see a completely different mental model. Breaks the "single source of truth = live app" decision.

## Open questions (tracked in `docs/00-protocol-spec.md §7 NEEDS_HUMAN_CONFIRMATION`)

- **#4**: Partial-liquidation policy when all four pools combined have insufficient ABD. Default: revert (anyone can retry). Alternatives: partial-fill to available; fall through to open market / direct-buy fallback.
- **#6**: Within-pool ordering when a single liquidation partially fills a pool's capacity — FIFO by deposit or pro-rata snapshot. Default: pro-rata via P/S snapshot (stateless, Liquity-style). FIFO would be closer to the audit's "earlier bid preferred" scenario language but is much harder on gas.

## References

- `references/alphbanx-protocol-paper.pdf` §2.4.9–2.4.12.
- `references/alphbanx-audit-inference-ag-2025-04.pdf` p. 11 ("Adversarial scenarios").
- `https://alphbanx.gitbook.io/alphbanx/auction-pools-and-liquidations`.
- Liquity v1 Stability Pool: `https://github.com/liquity/dev/blob/main/packages/contracts/contracts/StabilityPool.sol` (conceptual reference; zero source copying).
- On-chain confirmation: `POST /contracts/call-contract` to `29YL53te…` with `methodIndex 0` returns ByteVec `"AuctionManager"`; `mutFields[1..4]` decode to `[0.5 %, 1 %, 1.5 %, 2 %]`.
