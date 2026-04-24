# OpenABX execution plan

**Version:** Phase 0, 2026-04-22. Revised at the end of each phase.

Phase numbering and scope match `openabx_plan.md` and the revised plan at `/Users/dmayk/.claude/plans/audit-the-plan-and-smooth-donut.md`. This document translates them into concrete exit gates and effort estimates.

---

## Overview

| Phase | Name                                                          | Status                  | Calendar estimate | Gated by           |
| ----- | ------------------------------------------------------------- | ----------------------- | ----------------- | ------------------ |
| 0     | Spec + architecture + live-app inventory + address extraction | **in review** (this PR) | —                 | Human review       |
| 0.5   | ABI compat decision                                           | pending                 | 0.5 day           | Phase 0 sign-off   |
| 1     | Monorepo scaffold + CI                                        | pending                 | 2–3 days          | Phase 0.5 decision |
| 2     | Tokens + oracle + circuit breaker                             | pending                 | 4–5 days          | Phase 1 green      |
| 3     | Loan lifecycle + sorted list + indexer                        | pending                 | 7–10 days         | Phase 2 green      |
| 4     | Auction pools + liquidation + redemption + 30-day fuzz        | pending                 | 10–14 days        | Phase 3 green      |
| 5     | Staking + vesting + governance                                | pending                 | 5–7 days          | Phase 4 green      |
| 6     | Frontend (5 pages, 2-network SDK)                             | pending                 | 10–14 days        | Phase 5 green      |
| 7     | Docs + testnet deploy + Vercel mainnet UI                     | pending                 | 4–5 days          | Phase 6 green      |

**Total estimate:** 42–58 engineer-days for a single full-time engineer. Scale with parallelism during Phase 6 (UI) and Phase 4 (contracts + fuzz).

---

## Phase 0 — exit checklist

- [x] `references/alphbanx-contract-addresses.md` with 7 high-confidence + 5 medium-confidence mainnet addresses and all 6 published testnet addresses, plus the admin EOA.
- [x] `docs/00-protocol-spec.md` with §1 live-app inventory (5 pages confirmed), §2 parameter table (20+ rows, all with source citations), §4 operations (14 named), §5 invariants (12 listed), §6 formulas (6 canonical), §7 NEEDS_HUMAN_CONFIRMATION (10 blockers + 3 non-blockers), §8 deviation log (7 items), §9 reproducibility trail.
- [x] `docs/01-architecture.md` with contract decomposition (9 top + 8 sub), Mermaid diagram, APS cookbook (3 examples), two-network SDK design, governance stance, circuit-breaker policy, indexer sketch, fuzz-harness sketch.
- [x] ADR-001, ADR-002, ADR-003 committed.
- [x] `references/alphbanx-audit-inference-ag-2025-04.pdf` read in full (35 pages).
- [x] Live-app screenshots captured (5 routes).
- [ ] **Human review of all of the above.** No Phase 1 work begins until this is signed off.

---

## Phase 0.5 — ABI compat decision (0.5 day)

**Question:** can our Ralph implementation's method indices match AlphBanX's mainnet contracts 1-for-1, letting the frontend use a single ABI?

**Observation (Phase 0 data):** method index 0 on the mainnet `AuctionManager` returns the string `"AuctionManager"`. Method index 0 on `LoanManager` returns `"LoanManager"`. Other contracts return empty bytevecs or specific fields. The pattern suggests method indices are **ordered by source code**, which we cannot reproduce without reading AlphBanX source (forbidden).

**Decision:** ship two ABIs.

- Testnet network → our ABI, generated from our Ralph compile.
- Mainnet network → an observed ABI in `sdk/src/abi/alphbanx-mainnet.ts`, hand-curated from network-traffic observation during Phase 0 + on-demand additions during Phase 6. Each method index recorded with: `(contractAddr, methodIndex, observedReturnType, observedFromCall)` plus the date of observation.

**Artefact:** append a section "ABI inventory" to `references/alphbanx-contract-addresses.md` that lists every discovered `(contract, methodIndex) → signature` tuple, with provenance. This table grows every time Phase 6 needs a new method.

**Exit:** decision recorded + starter ABI file committed with at least the 4 methods already observed in Phase 0 (LoanManager#0 name, AuctionManager#0 name, DIA#0 inverse-price, DIA#1 ALPH/USD).

---

## Phase 1 — Monorepo scaffold (2–3 days)

**Deliverables:**

- `pnpm-workspace.yaml` + six workspaces: `contracts/`, `web/`, `sdk/`, `e2e/`, `indexer/`, `docs/`.
- `contracts/` with `@alephium/cli` v3.0.3 wired; `alephium.config.ts`; a `contracts/src/hello.ral` that compiles.
- `sdk/` with a typed stub and a `getClient(network, role)` factory backed by `addresses.ts` and `abi/`.
- `web/` = `npx create-next-app@14` (App Router, TS strict, Tailwind, shadcn/ui). `NEXT_PUBLIC_NETWORK` env wiring. Wallet connect button via `@alephium/web3-react` that works against devnet.
- `e2e/` = Playwright skeleton with one test ("page renders").
- `indexer/` = Node.js skeleton with a `pnpm dev` that polls the node and prints events.
- `.github/workflows/ci.yml`: lint + typecheck + `alephium compile` + `alephium test` + `vitest` + `next build` + Playwright smoke, all green.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE (MIT)`, `.env.example`, `.nvmrc` pinning Node 20, `.editorconfig`, `.husky/` pre-commit hook.

**Exit gate:** fresh clone → `pnpm i && pnpm dev:devnet` → local Next page with a working wallet-connect button at `http://localhost:3000`. CI green on first PR.

---

## Phase 2 — Tokens + oracle + circuit breaker (4–5 days)

**Contracts:**

- `ABDToken.ral`, `ABXToken.ral` (APS-native; no ERC-20 allowance surface).
- `DIAAlphPriceAdapter.ral` — thin wrapper calling DIA xMarket with `getValue("ALPH/USD")`; returns `(price: U256, timestamp: U256)`.
- `ABDPriceOracle.ral` — constant 1e18 return value.
- `PlatformSettings.ral` — admin + references; settable only by admin (single-sig on devnet/testnet, timelock on "mainnet-ready" variant).
- `CircuitBreaker.ral` — `paused: Bool` + `pauser: Address`. Oracle-staleness auto-halt.

**Tests (Ralph unit, in `contracts/test/`):**

- Mint/burn authority checks (only LoanManager can mint ABD; only Vesting/AuctionFarming can move ABX reserve; etc.).
- Oracle value propagation (set mock DIA registry, assert adapter returns same value).
- Circuit breaker halts all operations it is wired into.

**SDK additions:** typed clients for each, address resolution for devnet.

**Frontend:** `/dev/tokens` page (gated by `NEXT_PUBLIC_ENABLE_DEV_ROUTES=true`) lets you mint test ABD on devnet via the connected wallet.

**Exit gate:** 100 % of oracle/token methods covered by Ralph tests. Devnet mint works via UI.

---

## Phase 3 — Loan lifecycle + sorted list + indexer (7–10 days)

**Contracts:**

- `SortedList.ral` + `ListNode.ral` — generic primitive. Unit-tested in isolation.
- `LoanManager.ral` + per-tier `InterestPool.ral` + per-borrower `Loan.ral`.
- `BorrowerOperations.ral` — user-facing router.

**Behaviour:**

- OpenLoan / BorrowMore / Repay / AddCollateral / WithdrawCollateral / CloseLoan / AccrueInterest — per `docs/00-protocol-spec.md §4`.
- One loan per wallet enforced via `subContractId!(toByteVec!(owner))`.
- Interest accrual at 6-hour quantisation; settled on every interaction.
- Insertion and deletion from sorted list use off-chain hints.

**Indexer:**

- Subscribes to Loan-contract events (Created, Adjusted, Closed) and AccrueInterest events.
- Maintains the cross-tier ascending-`ir` redemption view + within-tier secondary-key order.
- Exposes `/hints/insert` and `/hints/redeem` HTTP endpoints.

**Tests:**

- Ralph unit: every state transition + property tests for CR math (10k random input combinations).
- Fuzz stub: 1 simulated day, 10 loans, price RNG, asserting the 12 invariants from spec §5.
- Indexer tests: replay a recorded devnet trace; compare indexer's view to the ground truth from `GET /contracts/{addr}/sub-contracts`.
- Playwright E2E: "open → adjust → close a loan" on devnet, balances verified by direct node reads.

**Exit gate:** E2E passes; invariants hold across 1 simulated day (nightly-only test) + 10k Ralph property runs.

---

## Phase 4 — Auction + liquidation + redemption + 30-day fuzz (10–14 days)

**Contracts:**

- `AuctionManager.ral` + per-tier `AuctionPool.ral` + per-user `Bid.ral` + per-wallet `Bidder.ral`.
- `AuctionFarming.ral` — emits ABX to pool depositors, routes to Vesting for 12-mo linear unlock.

**Behaviour:**

- DepositToPool / WithdrawFromPool (0.5 % closing bid fee) / ClaimDiscountedAlph / ClaimFarmRewards.
- Liquidation cascade: pool 0 → pool 1 → … ; reverts if combined insufficient (default per §7 item #4).
- Redemption: burn ABD, traverse sorted loans lowest-tier first, 1.5 % fee rebated to force-closed borrower.
- Dynamic fee split: `k = Σ_pools_abd / totalSupply(abd)`; `(1−k)` to pool depositors, `k` to ABX stakers (index not yet wired — stakers ALPH bucket accrues into a sink for Phase 5).

**Fuzz harness (the big one):**

- `tests/fuzz/market.ts`: 30-day simulated market. Variables: 50 borrowers, prices geometric-Brownian on `[$0.01, $1]`, random actions per block chosen from {OpenLoan, BorrowMore, Repay, Withdraw, AddCollateral, Deposit, Withdraw, Liquidate, Redeem} weighted to produce actual liquidations.
- Gate: 0 invariant violations, 0 stuck funds, reward sums within 1e-12 relative tolerance.
- Nightly CI only; PR CI runs 1 simulated day with 10 borrowers.

**Reference Python simulator (`tests/fixtures/sim.py`):** parallel implementation in Python used as a property-test oracle — every fuzz seed compares Ralph and Python outputs.

**Exit gate:** fuzz green; Playwright "bid → watch a simulated liquidation → claim discounted ALPH" flow on devnet.

---

## Phase 5 — Staking + vesting + governance (5–7 days)

**Contracts:**

- `StakeManager.ral` + `Staker.ral` + `LockInfo.ral`. 14-day unstake cooldown. Rewards paid in ALPH via index math (receives from Phase 4's sink).
- `Vesting.ral` + `Schedule.ral`. 12-month linear unlock. Sole caller with write access: `AuctionFarming`.
- `CircuitBreaker.ral` wired everywhere it needs to be (OpenLoan / BorrowMore / Redeem / Liquidate / Deposit / Withdraw). Fresh integration tests.
- `Timelock.ral` — 24-hour queue for admin-role calls.

**Tests:**

- Reward math matches `docs/03-reward-math.md` reference spreadsheet to 1e-12 tolerance.
- 14-day cooldown invariant (can't unstake early).
- Governance: param changes go through timelock; pause bypasses timelock; pause cannot seize funds.

**Exit gate:** `docs/03-reward-math.md` exists with worked examples; all tests pass.

---

## Phase 6 — Frontend (10–14 days)

**Pages (ordered by live-app priority per `docs/00-protocol-spec.md §1.1`):**

1. `/` — Dashboard: global stats (TVL, total debt, ABD / ABX / ALPH prices), user position summary once connected.
2. `/borrow` — Open vault form (8 interest tiers), adjust / close for existing vault, liquidation-price ticker, CR gauge, mint fee preview.
3. `/auction` — Four pool cards (5/10/15/20 %), deposit/withdraw, per-pool APR (ALPH yield + ABX farming), "My deposits" sub-tab.
4. `/stake` — Stake ABX form, current ALPH yield, pending unstakes with cooldown countdown, tier visualization (matches live app's tier ladder).
5. `/vesting` — Per-user vesting schedules (only Earn-pool ABX in v1), claim button.

**Cross-cutting:**

- Two-network SDK via `getClient(network, role)` factory.
- Mainnet first-run modal: "This app calls AlphBanX's mainnet contracts, which we did not deploy or audit. [Learn more]" → `/docs/05-security.md`.
- React Query invalidation via `updateBalanceForTx`.
- axe-core: 0 serious violations per page.
- Mobile-responsive; tested at 375 / 768 / 1440 widths.
- Not a visual clone of app.alphbanx.com; shadcn + custom Tailwind theme.

**Testing:**

- Playwright E2E per page, testnet happy path + error states.
- Mainnet smoke: "page renders, RPC resolves, connected wallet shows correct balance."

**Exit gate:** all 5 pages deployed to a Vercel preview URL pointing at Alephium testnet.

---

## Phase 7 — Docs + mainnet UI ship (4–5 days)

**Scripts:**

- `scripts/deploy-testnet.ts` — idempotent; writes `deployments/testnet.json`.
- **No `deploy-mainnet.ts` for contracts.** (User decision #3.)
- `scripts/verify-mainnet-addresses.ts` — daily CI check: re-reads every mainnet address in `deployments/mainnet.json`, hashes the bytecode, compares to Phase 0 hash. Mismatch = alert + frontend auto-rolls to "under maintenance".

**Docs:**

- `docs/04-deploy-runbook.md` — testnet deploy checklist; mainnet-frontend release checklist.
- `docs/05-security.md` — threat model for a third-party mainnet frontend; user disclaimer text; incident response for AlphBanX upgrades or exploits.
- `docs/06-user-guide.md` — end-user walkthrough for both testnet (using our contracts) and mainnet (using AlphBanX's contracts).
- `RELEASE-CANDIDATE.md` — what's ready, what still needs an external paid audit, which params governance should set.

**Shipping:**

- Vercel main branch → `NEXT_PUBLIC_NETWORK=mainnet`. Preview branches default to testnet.
- README one-command setup.

**Exit gate:** fresh contributor clone → working local devnet + frontend in < 10 min. Public Vercel URL renders mainnet data.

---

## Working agreements (unchanged from `openabx_plan.md §Working agreements`)

1. TodoWrite aggressively. One todo file per phase.
2. Small atomic commits; each compiles and lints.
3. Tests-first for every new contract fn or UI flow.
4. Read before writing. No ad-hoc `any`.
5. Ask when blocked by a `NEEDS_HUMAN_CONFIRMATION` — never guess.
6. Full check suite before claiming exit: `pnpm lint && pnpm typecheck && pnpm test && pnpm -C contracts test && pnpm build && pnpm e2e:smoke`. Nightly adds the 30-day fuzz.
