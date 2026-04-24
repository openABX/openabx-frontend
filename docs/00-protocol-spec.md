# AlphBanX protocol specification (as observed)

**Purpose.** This document is the normative specification for the OpenABX clean-room re-implementation. It was produced in Phase 0 from public sources only: the protocol paper `references/alphbanx-protocol-paper.pdf`, the GitBook (`alphbanx.gitbook.io/alphbanx`), the Inference AG audit report `references/alphbanx-audit-inference-ag-2025-04.pdf`, and direct on-chain state observation via the Alephium mainnet node (v4.5.1, 2026-04-22).

**Source-of-truth rule.** When sources disagree: **`app.alphbanx.com` as observed in §1 wins**, then GitBook, then the on-chain state, then the paper. Each such divergence is logged explicitly in §7.

**Clean-room rule.** No JavaScript source from `app.alphbanx.com` was read. No Ralph bytecode was decompiled. The public source repo `github.com/FRAGSTARRR/Smart-Contracts---AlphBanX` (identified by the audit report) was **intentionally not accessed**. Every quantitative claim below can be reproduced by re-running the Phase 0 observation commands in §9.

---

## 1. Live app inventory (§1 — canonical feature list)

Captured 2026-04-22 against `https://app.alphbanx.com`. Screenshots in the Chrome MCP cache (IDs `ss_7442ieztb` dashboard, `ss_0842n8x3r` borrow, `ss_9868lez4f` stake, `ss_1739ata0j` auction, `ss_2234i230z` vesting).

### 1.1 Routes (enumerated by walking all `<a href>` nodes in the live DOM)

| Route      | Title     | What it shows (no wallet connected)                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`        | Dashboard | Price tickers: ALPH, ABX, ABD. Protocol aggregates: total Collateral USD, total Debt USD. Charts at 1d/1w/1m/3m/6m/1y timeframes.                                                                                                                                                                                                                                                                  |
| `/borrow`  | Borrow    | Open-vault form (deposit ALPH, choose one of eight interest-rate tiers 1/3/5/10/15/20/25/30 %, mint ABD). Shows: Collateral, Borrowing Limit, Interest, Liquidation price, current ALPH price. Tutorial modal "Borrow ABD: you can borrow ABD here and keep track of the status of your loan."                                                                                                     |
| `/stake`   | Stake     | "Stake ABX, earn more ALPH". Current ALPH Yield (live APR e.g. 0.94 %). "No Tier" + tier ladder visual. Sub-tabs: `Stake` and `Locked ABX`. Notice: **"Unstaking ABX tokens requires a 14-day vesting period."**                                                                                                                                                                                   |
| `/auction` | Auction   | "Don't wait, Accumulate". Total Deposit (ABD), ALPH Yield, **ABX Yield** (vested). CTA "Bid & earn". Sub-tabs: `Auction`, `My deposits`. Tutorial modal: "Placing a deposit means you bid to buy the loan's collateral at a 5 %, 10 %, 15 %, or 20 % discount, depending on the pool selected." Displays `+X ALPH / 6 hours` on the Total Deposit card — confirms 6-hour interest accrual cadence. |
| `/vesting` | Vesting   | Requires connected wallet. Without one: "You need to connect wallet to see your personal statistic."                                                                                                                                                                                                                                                                                               |

### 1.2 External links (from footer and "More" menu)

- Docs: `https://alphbanx.gitbook.io/alphbanx`
- X / Twitter: `https://x.com/alephiumbank`
- Telegram community: `https://t.me/AlphBanX`
- **Telegram alert bot: `https://t.me/alphbanx_alert_bot`** — "Instant Loan Risk Alerts" (the thing the original plan called "optional v2 Telegram integration"; it exists as a separate bot today)
- Discord: `https://discord.gg/56rgKJ9HGW`
- GitHub: `https://github.com/alphbanx` **(link target is 404 — stale link in footer)**

### 1.3 Conclusions that bind Phase 1+ scope

1. **Only five app routes exist.** No Swap, no Perps, no standalone "Redemption" page, no standalone "Liquidation trigger" page. Redemptions and liquidations must be exposed either as sub-flows of the existing pages or as dev-only admin routes. The OpenABX plan's Phase 6 must drop "Redemption" and "Liquidation trigger" as top-level pages and route them inside Dashboard / Borrow.
2. **8 interest-rate tiers + 4 auction discount pools** are hard-coded. These are protocol constants in our reimplementation, not runtime governance params.
3. **ABX staking pays ALPH** (header text "Stake ABX, earn more ALPH"). Confirms GitBook claim `§7`. Our `ABXStaking` contract emits ALPH to stakers via fee distribution.
4. **14-day unstake cooldown** for ABX. New datum — not in GitBook or paper. Added to §2.
5. **Two vesting concepts exist:** the 12-month linear Earn-pool ABX yield-farming vesting, and the 14-day ABX unstake cooldown. Our implementation must cleanly separate them (`EarnVesting` vs `ABXStaking` internal lock).
6. The "alert bot" is external infrastructure we are **not** building.

---

## 2. Parameters (consolidated)

All percentages given in human form; on-chain scale is 1e18 for ratios/fees unless noted.

| Parameter                                               | Symbol              | Value                                                                                                      | Source                                                                                               | Notes                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum Collateralization Ratio                         | `MCR` / `ρmin`      | **200 %**                                                                                                  | GitBook `collateralization-ratio`; LoanManager mutFields[1] decodes to `2 × 10¹⁸`                    | Single-threshold design; applies to both "open loan" precondition and "liquidatable" trigger. No Liquity-style two-tier MCR/TCR.                                                              |
| Minting Fee                                             | `φm`                | **0.5 %**                                                                                                  | GitBook `fees-on-alphbanx`; LoanManager mutFields[0] consistent with `5 × 10¹⁵` at 1e18 scale        | Deducted from borrower's ALPH collateral at each mint (initial + incremental). Distributed to auction pool depositors + ABX stakers via fee split.                                            |
| Borrowing Fee (interest)                                | `ir(ℓ)`             | **1 / 3 / 5 / 10 / 15 / 20 / 25 / 30 %** p.a.                                                              | GitBook `borrowing` + live `/borrow` UI                                                              | 8 discrete tiers, chosen by borrower at vault-open. Re-selectable? `NEEDS_HUMAN_CONFIRMATION` (likely fixed for the life of the loan). Accrues every 6 h, lazily settled at next interaction. |
| Interest accrual period                                 | `T_accrue`          | **6 h**                                                                                                    | GitBook `borrowing` ("accrues every 6 hours"); confirmed by "+X ALPH / 6 hours" text on `/auction`   | Settlement is lazy — computed on `borrow-more / repay / adjust / redeem / liquidate`.                                                                                                         |
| Successful Bid Fee                                      | `φb_i` for pool `i` | **0.5 % / 1 % / 1.5 % / 2 %** for pools 5 / 10 / 15 / 20                                                   | GitBook `fees-on-alphbanx`; AuctionManager mutFields[1..4] at `[5, 10, 15, 20] × 10¹⁵` match exactly | Charged on the value of collateral received by the pool at liquidation.                                                                                                                       |
| Closing Bid Fee                                         | `φbc`               | **0.5 %**                                                                                                  | GitBook `fees-on-alphbanx`                                                                           | Charged when a depositor manually withdraws ABD from a pool — discourages pool flight. Distributed to protocol treasury + stakers.                                                            |
| Redemption Fee                                          | `φr`                | **1.5 %**                                                                                                  | GitBook `fees-on-alphbanx`                                                                           | **Rebated to the force-closed borrower** (per GitBook). NOT to protocol/stakers. Design rationale: compensates the redeemed borrower for the oracle-manipulation protection function.         |
| Liquidation Fee                                         | `φl`                | **0.5 %**                                                                                                  | GitBook `fees-on-alphbanx`                                                                           | Taken from borrower collateral at liquidation. Distributed to auction pool depositors + ABX stakers via fee split.                                                                            |
| Price oracle                                            | `P`                 | DIA xMarket `ALPH/USD`                                                                                     | GitBook (inferred); mainnet adapter `2AtjFo…`, testnet adapter `2APkRx…`                             | Live call at 2026-04-22 returned `$0.04949`.                                                                                                                                                  |
| Price precision scale                                   | —                   | **1e18**                                                                                                   | LoanManager mutFields[8]                                                                             | All ratio/price arithmetic scaled to 1e18.                                                                                                                                                    |
| ABD decimals                                            | —                   | **9**                                                                                                      | ABD immFields[2]; live token                                                                         |                                                                                                                                                                                               |
| ABX decimals                                            | —                   | **9**                                                                                                      | ABX immFields[2]; live token                                                                         |                                                                                                                                                                                               |
| ABX total supply                                        | —                   | **100,000,000 ABX**                                                                                        | GitBook `abx-token`                                                                                  | Minted at deployment; no further inflation.                                                                                                                                                   |
| ABX allocation: community rewards                       | —                   | 23 % (23,000,000 ABX)                                                                                      | GitBook                                                                                              |                                                                                                                                                                                               |
| ABX allocation: treasury / ecosystem / marketing        | —                   | 20 % (20,000,000 ABX)                                                                                      | GitBook                                                                                              |                                                                                                                                                                                               |
| ABX allocation: core team                               | —                   | 15 % (15,000,000 ABX)                                                                                      | GitBook                                                                                              | Vesting schedule undocumented — `NEEDS_HUMAN_CONFIRMATION`.                                                                                                                                   |
| ABX allocation: reserve (ABD backing)                   | —                   | 5 % (5,000,000 ABX)                                                                                        | GitBook                                                                                              |                                                                                                                                                                                               |
| ABX allocation: liquidity provision                     | —                   | 5 % (5,000,000 ABX)                                                                                        | GitBook                                                                                              |                                                                                                                                                                                               |
| ABX allocation: auction pool LP yield farming           | —                   | 7 % (7,000,000 ABX)                                                                                        | GitBook                                                                                              | Emitted to Earn-pool depositors; subject to 12-month linear vesting.                                                                                                                          |
| ABX allocation: investors                               | —                   | 25 % (25,000,000 ABX)                                                                                      | GitBook                                                                                              | Vesting schedule undocumented — `NEEDS_HUMAN_CONFIRMATION`.                                                                                                                                   |
| Earn-pool ABX yield farming vesting                     | —                   | **linear, 12 months**                                                                                      | GitBook `auction-pools-and-liquidations` §"Earn Rewards"                                             | Applies to ABX rewards paid to auction pool depositors — NOT to ABD fees (which are paid in ALPH immediately).                                                                                |
| ABX unstake cooldown                                    | `T_unstake`         | **14 days**                                                                                                | live `/stake` page tooltip                                                                           | Not in GitBook or paper.                                                                                                                                                                      |
| Vaults per wallet                                       | —                   | **exactly one at a time**                                                                                  | GitBook `borrowing`                                                                                  | Structural constraint — mirrors Liquity v1's single-Trove-per-EOA model.                                                                                                                      |
| Redemption partial-fallback condition                   | —                   | **protocol CR < 100 %**                                                                                    | GitBook `redemptions` + protocol paper §2.4.8                                                        | Redemption price `P' = P · min(1, totalALPH·P / totalABD)`.                                                                                                                                   |
| Minimum loan size (dust floor)                          | —                   | **not documented**                                                                                         | `NEEDS_HUMAN_CONFIRMATION` in §7                                                                     | Default for OpenABX testnet: **100 ABD**.                                                                                                                                                     |
| ABD supply cap                                          | —                   | **not documented**                                                                                         | `NEEDS_HUMAN_CONFIRMATION` in §7                                                                     | Default for OpenABX testnet: start with a 10M ABD ceiling, governance-raisable.                                                                                                               |
| CR zones (UI presentation only — not enforced on-chain) | —                   | Conservative ≥ 400 %; Moderate 280–400 %; Aggressive 230–280 %; High Risk 200–230 %; Liquidation 100–200 % | GitBook + `/borrow` UI                                                                               | Pure visual — single hard threshold is still 200 %.                                                                                                                                           |

### 2.1 Dynamic fee split (paper §2.4.12 + GitBook "fee distribution")

Let `k = Σ(abd_in_all_pools) / totalSupply(ABD)`. Then, for every fee-earning event:

- `(1 − k)` of the fee payload goes to **auction pool depositors**, proportionally to their deposit share within the pool they are in.
- `k` of the fee payload goes to **ABX stakers**, proportionally to their staked balance.

GitBook's two worked examples match the paper:

- 10 % of ABD staked in pools → 90 % fees to pool depositors, 10 % to ABX stakers.
- 80 % of ABD staked in pools → 20 % fees to pool depositors, 80 % to ABX stakers.

All fees distributed to both legs are **paid in ALPH**, not ABX (GitBook `/stake`: "Rewards are paid out in Alph").

---

## 3. Roles

| Role                                         | Powers                                                                                                                                                                                                                        | Access                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Borrower                                     | Open / adjust / close a vault; choose interest tier at open; may have their vault force-redeemed by a redeemer                                                                                                                | Permissionless; any EOA                                                 |
| Earn Pool Participant ("Stability Provider") | Deposit ABD into one of the four discount pools; claim discounted ALPH after liquidations; withdraw ABD (pays 0.5 % closing bid fee)                                                                                          | Permissionless                                                          |
| ABX Staker                                   | Stake ABX to earn ALPH fees; unstake after 14 days                                                                                                                                                                            | Permissionless                                                          |
| Liquidator                                   | Trigger liquidation of a vault with CR < 200 %; receives no explicit reward in the current paper math (flag in §7)                                                                                                            | Permissionless                                                          |
| Redeemer                                     | Burn ABD to force-close the lowest-interest loan and receive its collateral minus 1.5 % fee (which is rebated to the force-closed borrower)                                                                                   | Permissionless                                                          |
| Admin                                        | Per audit "Scope limitations": exists but is out of scope for the Inference AG audit. On-chain evidence: mainnet admin EOA `1Fcq1KfXTVj3EyxncDgTmtrQzDWGWF5sXKojXZYDdxoho`. Powers undocumented — `NEEDS_HUMAN_CONFIRMATION`. | Multisig or EOA — unknown; assume single-sig EOA until proven otherwise |

---

## 4. Protocol operations

Notation follows the protocol paper §2.1–§2.2. Let `τ` be time-before, `τ'` time-after. All asset transfers are Alephium-native with call-site approval (APS). Let `CA = ALPH`, `SC = ABD`, `BT = ABX`, `P = P[τ]` oracle ALPH/USD.

### 4.1 OpenLoan (aka Create Vault)

**Inputs:** collateral amount `m` (ALPH), borrow amount `n` (ABD), chosen interest tier `i ∈ {1,3,5,10,15,20,25,30} %`.

**Preconditions:** caller has no open loan; `(m − mφm·P) · P / n ≥ 2` (post-fee CR ≥ 200 %); `n ≥ MIN_LOAN_SIZE`.

**Effects:**

1. Caller approves `m` ALPH at call site.
2. `mφm·P` ALPH deducted from `m` as minting fee; distributed to fee split `(1−k)` pool / `k` stakers.
3. LoanManager creates a `Loan` subcontract under path `blake2b(caller)` in the correct `InterestPool(i)`.
4. `n` ABD minted to caller.
5. Loan struct: `{owner=caller, q=n, ir=i, t=τ, c=m−mφm·P}`.
6. Loan inserted into `InterestPool(i)`'s `SortedList` (by `t` or by a protocol-chosen key — `NEEDS_HUMAN_CONFIRMATION`; redemption traversal works across pools ascending in `i`, then within a pool by some rule).

### 4.2 BorrowMore

**Inputs:** additional borrow `n`.
**Preconditions:** caller owns the loan; post-op CR ≥ 200 %.
**Effects:** accrue interest → `q ⇐ q + n + n·φm·accrued`; mint `n` ABD; `nφm·P` ALPH deducted as minting fee; reposition in list if key depends on q.

### 4.3 Repay

**Inputs:** repay amount `n`.
**Effects:** accrue interest; `q ⇐ q − n`; burn `n` ABD; if `q = 0`, close loan and refund remaining collateral; else reposition in list.

### 4.4 AddCollateral / WithdrawCollateral

**AddCollateral:** transfer `m` ALPH from caller to loan; no accrual, no CR check (can only improve).
**WithdrawCollateral:** accrue interest; transfer `m` ALPH out; require post-op CR ≥ 200 %.

### 4.5 AccrueInterest (permissionless crank)

Callable by anyone. Computes `interest = q · ir · P · (τ − t) / 1e18` (6-hour quantisation of `τ − t`); transfers that ALPH from loan to LoanManager fee bucket; sets `t ⇐ τ`.

### 4.6 Redeem

**Input:** ABD amount `n`.
**Effects:** Burn `n` ABD from caller. Compute `P' = P · min(1, totalALPH / (totalDebt)) `. Walk the cross-pool sorted list starting from lowest interest tier; for each loan `ℓ` in order:

- `v = min(q(ℓ), remaining)`.
- `w = v · P' / P` (ALPH to pay out).
- `rebate = v · P' · φr / P` ALPH rebated **to owner(ℓ)** (the force-closed borrower).
- Transfer `w − rebate` ALPH from `ℓ` to redeemer; `rebate` from `ℓ` to `owner(ℓ)`.
- `q(ℓ) ⇐ q(ℓ) − v`; `c(ℓ) ⇐ c(ℓ) − w`; close `ℓ` if `q = 0`.
- `remaining ⇐ remaining − v`.
- Stop when `remaining = 0`.

### 4.7 DepositToPool(i)

**Input:** pool index `i ∈ {0..3}` (5/10/15/20 %), ABD amount `n`.
**Effects:** transfer `n` ABD from caller into `AuctionPool(i)` vault; register per-caller share via P/S snapshot (ADR-002 details); start accruing ABX farming rewards (vested 12-month linear).

### 4.8 WithdrawFromPool(i)

**Input:** pool index `i`, amount `n`.
**Effects:** charge `n·φbc` ABD to treasury as closing bid fee; transfer `n·(1−φbc)` ABD back to caller; settle pending ALPH rewards + claim so-far-earned ABX (goes into EarnVesting schedule).

### 4.9 Liquidate(ℓ)

**Trigger precondition:** `c(ℓ) · P / q(ℓ) < 200 %`.
**Permissionless.** Effects, in order:

1. Starting at pool 0 (5 % discount): let `b = balance(pool_i, ABD)`. If `b ≥ q(ℓ)`:
   - Pool absorbs the whole debt. Pool transfers `q(ℓ) · (1 + discount_i)` ALPH worth of collateral out of ℓ to itself.
   - `φb_i` of received ALPH goes to protocol fee bucket; rest goes to pool depositors pro-rata.
   - `q(ℓ) ⇐ 0`, close `ℓ`. Refund any collateral remaining after liquidation fee `φl` to the borrower.
2. Else pool absorbs what it can, `ℓ`'s debt drops, move to pool `i+1`, repeat.
3. If all four pools insufficient: partial-liquidation policy — `NEEDS_HUMAN_CONFIRMATION` in §7.

### 4.10 StakeABX

**Input:** ABX amount `n`.
**Effects:** transfer `n` ABX from caller to `ABXStaking`; per-user reward index snapshot recorded.

### 4.11 UnstakeABX

**Input:** ABX amount `n`.
**Effects:** initiate 14-day cooldown; after cooldown, transfer ABX back.

### 4.12 ClaimStakingRewards

**Effects:** compute `(accumulated_ALPH_for_stakers × user_stake_share) − claimed_so_far`; transfer ALPH out to caller.

### 4.13 ClaimVestedABX

**Effects:** for each of caller's Earn-pool farming allocations, transfer `min(accrued_per_linear_12mo, unclaimed)` ABX out.

### 4.14 Distribute (paper §2.4.12)

Called internally whenever a fee-paying event lands ALPH into the LoanManager / AuctionManager fee buckets. Splits the bucket per the `k`-formula in §2.1 into pool-depositor and staker reward indices. Permissionless but idempotent — anyone can crank.

---

## 5. Invariants (minimum set for §3 fuzz harness)

1. **Non-negative debt.** ∀ loan ℓ, `q(ℓ) ≥ 0`.
2. **Non-negative collateral.** ∀ loan ℓ, `c(ℓ) ≥ 0`.
3. **Unique-loan-per-wallet.** ∀ address a, `|{ ℓ : owner(ℓ) = a, q(ℓ) > 0 }| ≤ 1`.
4. **Sorted list integrity.** The cross-pool traversal for redemption produces loans in ascending `ir`; within a pool, ordering follows the protocol-defined secondary key.
5. **ABD supply conservation.** `totalSupply(ABD) = Σ q(ℓ) + Σ abd_in_pools + Σ abd_in_user_wallets` at all times (modulo burns / mints being atomic).
6. **Reward accounting.** `Σ user_accrued_rewards ≤ Σ distributed_rewards` — no fund over-issuance.
7. **Monotonic interest.** For every loan with `q > 0`, owed interest is non-decreasing in time.
8. **CR on open.** Post-op CR ≥ 200 % on OpenLoan / BorrowMore / WithdrawCollateral.
9. **Liquidation eligibility.** Liquidate reverts when CR ≥ 200 %.
10. **Redemption price bound.** `P' ≤ P` always.
11. **Pool-ABD conservation.** `Σ user_shares_in_pool_i · pool_total_abd_i = total_abd_held_by_pool_i_contract` within 1 wei tolerance.
12. **No stuck funds.** After closing every loan and withdrawing every deposit, all contract vaults return to their deposit-only minimum (0.1 ALPH × num contracts) plus any undistributed fees.

---

## 6. Reward math formulas (canonical)

Reference spreadsheet `docs/03-reward-math.md` to be built in Phase 3 with these as the authoritative formulas:

1. **Redemption price:** `P' = P · min(1, totalALPH · P / totalABD)`
2. **Interest on loan ℓ at time τ:** `interest(ℓ) = q(ℓ) · ir(ℓ) · P[τ] · floor((τ − t(ℓ)) / 6h) · 6h / (365·24·3600 · 1e18)`
3. **Dynamic fee split:** `k = Σ_pools abd_deposited / totalSupply(ABD)`; pool share `= (1−k)`; staker share `= k`.
4. **Successful bid reward:** depositor in pool `i` with share `s` receives `(q_absorbed · (1 + discount_i) · (1 − φb_i)) · s` ALPH per liquidation event, via index accounting.
5. **12-month linear vesting:** `vested(t) = (t − schedule_start) / (365 days) · total_allocation`, clamped to `[0, total_allocation]`.
6. **Stability-pool proportional share (Liquity-style P/S product–sum snapshot):** standard Liquity `S_p` / `P_p` epoch/scale tracking. Implementation deferred to ADR-002.

---

## 7. NEEDS_HUMAN_CONFIRMATION list

Blockers for Phase 0 sign-off:

1. **Is the interest-rate tier fixed for the life of a loan, or re-selectable?** Default assumption: fixed. Plan test vectors assume fixed.
2. **Minimum loan size (dust floor).** Default for OpenABX testnet: 100 ABD. Confirm against live app by attempting to mint < 100 ABD once wallet is connected.
3. **ABD supply cap.** Default for OpenABX testnet: 10,000,000 ABD, governance-raisable. AlphBanX mainnet has no documented cap; current circulating is ~93,442 ABD.
4. **Partial-liquidation policy when all four pools combined are insufficient.** Options: (a) liquidation reverts (anyone can retry later); (b) partial liquidation proportional to available pool ABD; (c) anyone-can-directly-buy fallback. Default assumption: (a). Resolve by observing a live liquidation event in Phase 3 or confirming with AlphBanX team.
5. **Liquidator reward.** The paper has parameter `µ` ("liquidator reward") paid to the caller of `Liquidate`. The GitBook says "liquidator does not need to hold any tokens" but does not describe a reward. Does AlphBanX pay liquidators? Default assumption: no (zero `µ`).
6. **Within-pool ordering rule.** When one pool has multiple depositors, liquidations presumably distribute proportional to deposit; but _within a single liquidation event_, is there any priority (earlier depositor first)? Default assumption: pro-rata only.
7. **Interest-pool internal redemption order.** Paper's redemption traverses loans in ascending `ir`. Within one pool (same `ir`), what is the secondary sort key? Default assumption: loan creation time (oldest first), matching the audit's adversarial scenario "Place bids to be preferred over other bids of the same discount rate created earlier" — which tests FIFO within same tier; same FIFO likely applies to loans.
8. **Team / investor ABX vesting schedules.** Undocumented for the 15 % team + 25 % investor allocations. Likely on-chain in a contract we haven't identified. Default for OpenABX: do not implement team/investor vesting at all (out of v1 scope per plan).
9. **Circuit breaker on oracle staleness.** Undocumented. Default for OpenABX testnet: 30-minute threshold triggers a pause that halts OpenLoan / BorrowMore / Redeem / Liquidate.
10. **Interest accrual step direction.** Is `t(ℓ)` snapped to the previous 6-hour boundary or the current one? Default: floor to previous boundary (borrower-friendly; no accrued-but-unowed interest).

Non-blockers (can be resolved in Phase 1+):

11. Role labels for the five medium-confidence mainnet contracts (see `references/alphbanx-contract-addresses.md §Medium-confidence identifications`).
12. Admin role scope — what does the mainnet admin EOA actually _do_? Pausing? Parameter updates? Reading `PlatformSettings` setter method indices will answer this.
13. Exact scale constant for the fee-table contract `28QGP95r…` — fields appear to be at 1e15 OR 1e16.

---

## 8. Deviations from the protocol paper (log)

| #   | Paper says                                        | AlphBanX implements                         | We implement                       | Rationale                                                                                        |
| --- | ------------------------------------------------- | ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| D1  | Continuous bid book ordered by requested discount | Four discrete discount pools (5/10/15/20 %) | Four discrete pools (ADR-001)      | User decision; matches live app                                                                  |
| D2  | Continuous per-loan interest rate `ir(ℓ)`         | 8 tiers                                     | 8 tiers                            | Matches live app                                                                                 |
| D3  | Single `φb` bid fee                               | 4 per-pool bid fees                         | 4 per-pool                         | Matches live + on-chain                                                                          |
| D4  | Redemption fee goes "to the bank"                 | 1.5 % rebated to the force-closed borrower  | Rebated to borrower                | Matches GitBook §Fees + paper's "reward to borrowers whose collaterals are serving as a reserve" |
| D5  | Liquidator reward `µ`                             | No liquidator reward documented             | No liquidator reward               | Matches GitBook (§5 NEEDS_HUMAN_CONFIRMATION)                                                    |
| D6  | Paper has `DistributeRewards` as separate op      | Fees distributed inline on each liquidation | Inline distribution via index math | Liquity-style; lower gas                                                                         |
| D7  | Interest accrued continuously                     | Accrued every 6 h                           | 6-h lazy quantisation              | Matches GitBook + live UI                                                                        |

---

## 9. Contract address extraction log (reproducibility trail)

All commands below were executed against public endpoints on 2026-04-22. Results archived in `references/phase0-state-dumps/` (to be populated).

1. **Token-list seeding:**

   ```
   curl -s https://raw.githubusercontent.com/alephium/token-list/master/tokens/mainnet.json | jq '.tokens[] | select(.symbol == "ABX" or .symbol == "ABD")'
   ```

   → gave ABX token-id `9b3070a9…` and ABD token-id `c7d1dab4…`.

2. **Token-ID → address conversion:** base58 encode `0x03 ‖ token_id` (Alephium P2C address prefix).
   → ABD = `288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K`
   → ABX = `258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV`

3. **State-walk step 1 — ABD authority:**

   ```
   curl -s https://node.mainnet.alephium.org/contracts/288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K/state
   ```

   → `mutFields[0].value` is `tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB` = **LoanManager**.

4. **State-walk step 2 — LoanManager's 6 contract references:**

   ```
   curl -s https://node.mainnet.alephium.org/contracts/tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB/state
   ```

   → `immFields[0..5]` = 6 ByteVec contract IDs → base58-encode each → 6 mainnet addresses.

5. **Methodology for name disambiguation:** call `POST /contracts/call-contract` with `methodIndex 0` on each candidate; some return a ByteVec that decodes to the contract class name (`"LoanManager"`, `"AuctionManager"`). Matches against the audit's file-level contract names (`AbdToken.ral`, `AbxToken.ral`, `StakeManager.ral`, `Vesting.ral`, `AuctionManager.ral`, `LoanManager.ral`, `BorrowerOperations.ral`, `DIAAlphPriceAdapter.ral`, `PlatformSettings.ral`).

6. **DIA oracle live value:**
   ```
   curl -s -X POST https://node.mainnet.alephium.org/contracts/call-contract \
     -H 'Content-Type: application/json' \
     -d '{"group":0,"address":"2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7","methodIndex":1}'
   ```
   → `U256 49,489,670,000,000,000` = $0.04949 ALPH/USD (matches dashboard).

All 8+ mainnet addresses resolved through this process are in `references/alphbanx-contract-addresses.md`.

---

## 10. Appendix — paper-only material retained by reference

The paper's normative text (10 pages, 2024-11-04) covers definitions, bid-book formalism, and fee discussion. We retain it as `references/alphbanx-protocol-paper.pdf` with the explicit note: Sections 2.4.9 (Create Bid), 2.4.10 (Close Bid), 2.4.11 (Liquidate Loan with per-bid matching), and 2.4.12 (DistributeRewards as a separate op) describe a **bid-book architecture that AlphBanX does not ship**. We build the pool architecture instead (§4.7–4.9).
