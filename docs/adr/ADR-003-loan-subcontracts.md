# ADR-003: Loan-per-subcontract with owner-keyed path

**Status:** accepted (2026-04-22)
**Decider:** Engineering

## Context

The spec mandates "exactly one active loan per wallet" (`docs/00-protocol-spec.md §2`, quoting GitBook). We need a contract layout that (a) makes this structural (not just an assertion), (b) supports the sorted-list insertion/deletion from ADR-002, (c) keeps per-loan state cheap, and (d) works natively with Ralph's subcontract model.

Ralph's subcontract primitives:
- `copyCreateSubContract!(path: ByteVec, bytecode: ByteVec, encoded: ByteVec, init: ByteVec)` creates a child from a template.
- `subContractId!(path: ByteVec)` returns the deterministic child ID as `blake2b(blake2b(parentId ‖ path))`.
- Each subcontract carries a 0.1 ALPH minimum deposit, refundable on destruction.

Per the audit's scope listing `loan/LoanManager.ral (SortedLIst(ListNode), InterestPool, Loan)`, AlphBanX uses subcontracts for `Loan`, `InterestPool`, and the list nodes.

## Decision

- **Loans are subcontracts.** Each open loan is a Ralph subcontract instance created with `copyCreateSubContract!`.
- **Parent:** the loan's `InterestPool(i)` — the pool for the borrower's chosen interest tier. Rationale: the sorted list's scope is per-tier; co-locating the loans under their tier parent makes traversal efficient.
- **Path keying:** `path = toByteVec!(owner)`. This makes the subcontract ID deterministic from the owner address — `subContractId!(toByteVec!(owner))` always returns the same ID.
- **One-loan-per-wallet:** attempts to `copyCreateSubContract!` with a path that already exists will fail. Therefore the invariant is **structurally enforced**, not asserted. There is no need to maintain a separate "hasOpenLoan[user]" map.
- **Multi-tier wrinkle:** because `path = toByteVec!(owner)`, if a borrower closes a loan in tier 5 % and later opens in tier 10 %, the new subcontract is under a different parent (10 % InterestPool), so the `subContractId!` outputs differ. That's fine — the OLD ID has been destroyed. The constraint is enforced at the LoanManager level with a separate `hasOpenLoan: Map[Address, Bool]` at LoanManager scope before delegating into any InterestPool.

### Why not put all loans under the LoanManager directly?

We considered `parent = LoanManager, path = toByteVec!(owner)`. Rejected because: (a) the sorted list is naturally per-tier (ADR-002), so grouping subcontracts by tier makes the traversal parent-local; (b) insertion/deletion within a tier never touches siblings in other tiers, reducing gas; (c) it also means the `SortedList` primitive gets reused per tier without cross-tier contention.

### Why owner as the path (not e.g. a nonce)?

- Enforces "one loan per wallet" structurally.
- Lets anyone (indexer, UI, another contract) deterministically compute a user's loan ID without a table lookup.
- Closing and re-opening is fine: the old subcontract is destroyed and its deposit refunded, so the path frees up for re-use.

## Consequences

### Positive

- **Structural one-per-wallet.** Cannot be bypassed by re-entrancy or logic errors.
- **Deterministic ID.** `subContractId!(toByteVec!(owner))` is pure — the UI can compute it without an RPC call.
- **Per-loan gas bounds.** Each loan has its own asset vault; ALPH collateral, accrued interest, and ABD repayment flow touch only that one child contract.
- **Clean deletion.** Closing a loan destroys the subcontract and refunds its 0.1 ALPH.

### Negative

- **0.1 ALPH deposit per open loan.** Refundable, but still a capital lock. At $0.05/ALPH = $0.005 per loan — trivial.
- **Re-opening overhead.** Each open incurs a `copyCreateSubContract!` gas cost. Users who frequently open/close will pay this repeatedly; infrequent users don't notice.
- **Ralph limitation: subcontracts cannot iterate natively.** This is why ADR-002 uses an explicit linked list. Without it, we couldn't enumerate per-tier loans on-chain.

## Alternatives considered

### A. All loans as entries in a single `Map[Address, Loan]` on LoanManager

Rejected because: (a) Ralph `Map` entries are subcontracts already, so there's no saving; (b) it would lose the per-tier grouping that ADR-002 relies on; (c) it would serialise gas against LoanManager's state for every operation.

### B. Loans as nested struct in LoanManager state

Rejected because: (a) Ralph contract state size is bounded; (b) any operation on any loan would lock the entire LoanManager state; (c) per-loan asset vaults would be impossible.

## Implementation notes

- The initial mutable state encoded into a new Loan subcontract: `(q, ir, t, c, prevId, nextId)`. `prevId`/`nextId` are bytevec-zero for an empty list and updated via the SortedList primitive.
- The LoanManager maintains `hasOpenLoan: Map[Address, Bool]` as a belt-and-suspenders check across tiers.
- Destroying a subcontract returns the 0.1 ALPH deposit to the LoanManager, which forwards it to the owner as part of the CloseLoan transaction.

## References

- `docs.alephium.org/ralph/contracts/` — subcontract semantics.
- `references/alphbanx-audit-inference-ag-2025-04.pdf` p. 6 — scope includes `LoanManager (SortedLIst(ListNode), InterestPool, Loan)` confirming the subcontract composition.
- `docs/00-protocol-spec.md §4.1` — OpenLoan effects.
- `docs/01-architecture.md §1` — contract decomposition.
- ADR-002 — sorted-list design that these subcontracts participate in.
