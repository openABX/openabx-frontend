# ADR-002: Sorted loans — hint-verified doubly-linked subcontracts

**Status:** accepted (2026-04-22)
**Decider:** Engineering (captured in revised plan + Phase 0 spec §4.1 and §4.6)

## Context

Redemption in AlphBanX burns ABD and force-closes loans starting from the **lowest interest rate**. This requires walking an ordered view of all open loans across 8 interest-rate tiers during the redemption transaction.

Ralph / the sUTXO model has no built-in iteration primitive. Its `Map[K, V]` type is syntactic sugar over subcontracts — each map entry is a separate subcontract with a 0.1 ALPH deposit. There is no `Map.keys()` or `Map.values()` callable from on-chain code. The only way to enumerate subcontracts on-chain is to store explicit links between them.

Options for implementing the sorted structure:

- **A. On-chain linked list, discovery-based.** Each loan subcontract stores `prevId`/`nextId`. Any insertion walks the list on-chain to find the correct insert point. Redemption walks the list on-chain from the head. Simple; expensive.
- **B. On-chain linked list, hint-verified.** Same links, but callers pass `(prevId, nextId)` hints for insertion; the contract only *verifies* the hint (checks that the new loan's key falls between `prev.key` and `next.key`). Redemption similarly takes a hint on the starting node. Cheap on-chain; pushes discovery to an off-chain indexer.
- **C. Off-chain sort, on-chain batch.** Redeemer computes the full traversal off-chain, sends the list of loan IDs + amounts in the tx. Contract applies them in order, verifying each is still redeemable. Compact; fragile (any intervening state change invalidates the batch).
- **D. Tree (red-black / AVL) with on-chain self-balancing.** Stronger worst-case guarantees. Dramatically more complex; no Ralph reference implementation exists.

The LoanManager on AlphBanX mainnet `tpxjsWJSaUh5…` has 7 KB of bytecode and the audit report names `SortedList(ListNode)` as a subcontract — strongly suggesting option B with an explicit list primitive.

## Decision

Adopt **option B: hint-verified doubly-linked list** of loan subcontracts.

- Each loan subcontract stores `{q, ir, t, c, prevId, nextId}`.
- Loans are grouped into `InterestPool(i)` subcontract parents, one per interest tier (so 8 tiers → 8 InterestPools under LoanManager).
- Within an `InterestPool`, loans form a doubly-linked list ordered by a secondary key (default: creation time, FIFO — see ADR-001 open question #7).
- Across pools, redemption traverses by ascending tier: consume all of pool 1 %, then all of 3 %, etc.
- Insertion (OpenLoan, BorrowMore-that-changes-position, Repay-that-changes-position):
  - Caller provides hint `(prevId, nextId)` in the tx.
  - Contract asserts: `prevId.nextId == nextId` (still consecutive); `newKey` falls between `prev.key` and `next.key`; pointer updates.
  - If hint is stale, tx reverts. Caller re-queries the indexer and retries.
- Redemption (`LoanManager.redeem`):
  - Caller provides hint `(startPoolIndex, startLoanId)`.
  - Contract starts at that node, walks `nextId` while consuming `remaining` ABD, spanning pools as needed.
  - Within-pool key-ordering is implicit; across-pool ordering is enforced by the pool indices.
- Deletion (CloseLoan): no hint needed; contract reads `prev.nextId = loan.nextId`, `next.prevId = loan.prevId`, removes the subcontract. O(1).

The **off-chain indexer** (`indexer/` package) maintains:

- Per-pool doubly-linked list state (in SQLite).
- `/hints/insert?q=…&tier=…` → `(prevId, nextId)`.
- `/hints/redeem?amount=…` → `(startPoolIndex, startLoanId)`.
- Recovery: rebuild from `GET /contracts/{LoanManager}/sub-contracts` + `GET /contracts/{InterestPool}/sub-contracts` using the node's enumerability endpoint.

## Consequences

### Positive

- **Cheap on-chain ops.** Insertion is O(1) verification instead of O(N) discovery.
- **Matches Liquity v1 pattern.** A well-understood and battle-tested approach.
- **Matches AlphBanX.** Reduces divergence risk between our testnet deployment and AlphBanX's mainnet.
- **Indexer is a separable concern.** Can be swapped, scaled, or replaced with a community-run alternative without contract changes.

### Negative

- **Frontend needs a running indexer.** Without one, users cannot submit valid txs; UX degrades to "redemption is unavailable."
- **Stale-hint retries.** High-frequency state changes (e.g., during a liquidation cascade) cause hint staleness; users retry. Indexer must keep up.
- **Indexer is trusted for liveness.** A malicious / broken indexer cannot steal funds (hints are verified on-chain), but it can make the UX fail.

### Mitigations

- Ship our own indexer + publish a public endpoint for the mainnet-frontend use case.
- Document the indexer API publicly so community / mirror indexers can spin up.
- Provide an emergency "open-walk" fallback function (O(N) redemption) for edge-cases; gated behind an explicit flag.

## Alternatives considered

### A. Discovery-based on-chain walk

Rejected: gas cost scales linearly with list depth; at 500 loans × 8 tiers, a single redemption could exceed Alephium's per-tx gas budget.

### C. Off-chain sort, on-chain batch

Rejected: a single concurrent state change (someone else opening a loan) invalidates the batch. Would lead to heavy transaction failure rates.

### D. Self-balancing tree

Rejected for v1 on complexity grounds. May be revisited for v2 if redemption frequency grows to where hint staleness is a chronic UX issue.

## Implementation notes

- `contracts/src/loan/SortedList.ral` is a generic primitive. Also used by `Vesting.ral` (per the audit file listing `vesting/Vesting.ral` using `SortedList(ListNode)`).
- Cost of 0.1 ALPH per loan subcontract is refunded on loan close. At $0.05/ALPH = $0.005 per open — trivial.
- **Hint API stability:** the `indexer/` package's HTTP endpoints follow the same versioning as `sdk/` — `/v1/hints/…`.

## References

- `docs/00-protocol-spec.md §4.1, §4.6` — OpenLoan and Redeem effects.
- `docs/01-architecture.md §4` — sorted-list design summary.
- `https://github.com/liquity/dev/blob/main/packages/contracts/contracts/SortedTroves.sol` — conceptual reference (no code copied).
- Alephium node endpoint `/contracts/{addr}/sub-contracts` — enumerates children for indexer recovery.
