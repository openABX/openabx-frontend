# Reward math reference

All formulas the protocol uses, in one place. Every row has a link to the
Ralph file that implements it and the Ralph unit test that pins the numeric
output.

All amounts are raw atto-units. Scales used throughout:

| Symbol | Units | Decimals |
|---|---|---|
| `PRECISION` | 1e18 | 18 — canonical for prices, rates, CR, P/S factors |
| `ABD_SCALE` | 1e9 | 9 — ABD (and any other 9-decimal token) |
| `ALPH` atto | 1e18 | 18 — native Alephium token |
| `BPS_SCALE` | 1e4 | 4 — basis points (100 bps = 1 %) |

The `ABX_SCALE` equals `ABD_SCALE` since ABX and ABD are both 9-decimal
tokens.

---

## 1. Collateralization ratio

**Contract:** `contracts/contracts/loan/LoanManager.ral` → `computeCr`
**Test:** `contracts/test/loan/LoanManager.test.ts` → `computeCr` suite

```
CR_1e18 = collateral × price / (ABD_SCALE × debt)
```

Pinned test vectors:

| collateral | debt | price | CR_1e18 | Human |
|---|---|---|---|---|
| `1000 ALPH` | `25 ABD` | `$0.05 / ALPH` | `2 × 10¹⁸` | 200 % (at MCR) |
| `2000 ALPH` | `25 ABD` | `$0.05 / ALPH` | `4 × 10¹⁸` | 400 % (Conservative) |
| `n × collateral` | `0 ABD` | any price | `u256Max!()` | ∞ (treated as safe) |

## 2. Minting fee

**Contract:** `LoanManager.ral` → `computeMintingFee`
**Test:** `LoanManager.test.ts` → `computeMintingFee — 0.5% of 100 ABD at $0.05/ALPH = 10 ALPH`

```
fee_atto_alph = mintingFee × debt × ABD_SCALE / price
```

Where `mintingFee` is a 1e18-scaled rate (0.5 % = `5 × 10¹⁵`).

Pinned vector: 100 ABD at $0.05 ALPH → `10 ALPH` fee (exact to the atto).

## 3. Interest accrual

**Contract:** `LoanManager.ral` → `computeInterest`
**Test:** `LoanManager.test.ts` → `computeInterest` suite

```
settledMs = floor(elapsedMs / SIX_HOURS_MS) × SIX_HOURS_MS   // 6-hour quantisation
interest_atto_alph = debt × interestRate × settledMs × ABD_SCALE /
                     (YEAR_MS × price)
```

Where `YEAR_MS = 31_536_000_000` and `SIX_HOURS_MS = 21_600_000`.

Pinned vectors:

| debt | ir | elapsedMs | price | Result |
|---|---|---|---|---|
| `1000 ABD` | `5 %` | `< 6 h` | any | `0` (quantised out) |
| `1000 ABD` | `5 %` | exactly `6 h` | `$0.05` | between 0.6 and 0.7 ALPH |
| `1000 ABD` | `5 %` | `365 d` | `$0.05` | between 999 and 1000 ALPH |

The one-year convergence is tight: ~ $50 owed / $0.05 per ALPH = 1000 ALPH
exactly. Quantisation drops the remainder to the next 6-hour window, so we
land in [999, 1000].

## 4. Auction-pool P/S snapshot (Liquity-style)

**Contract:** `contracts/contracts/auction/AuctionPool.ral` → `liquidate` / `previewLiquidate`
**Test:** `contracts/test/auction/AuctionPool.test.ts` → `previewLiquidate math` suite

On liquidation of `debtAbsorbed` ABD yielding `alphGained` ALPH (net):

```
netAlph  = alphGained × (BPS − bidSuccessFeeBps) / BPS
P_new    = P × (totalAbd − debtAbsorbed) / totalAbd
S_new    = S + netAlph × P_prev / totalAbd_prev
```

Per-depositor projection from snapshot `(d, P_i, S_i)`:

```
current_abd    = d × P / P_i
claimable_alph = d × (S − S_i) / P_i − claimedAlph
```

Wipeout case: when `debtAbsorbed == totalAbd`, `P` resets to `PRECISION`
and `totalAbd` to `0`. Depositor snapshots go stale (`currentAbd → 0`); any
prior-liquidation ALPH is still claimable via unchanged `S`.

Pinned vector: pool with 1000 ABD, absorb 200, gain 50 ALPH at 0.5 % bid
fee:
- `netAlph = 49.75` ALPH
- `P_new = PRECISION × 800/1000 = 8 × 10¹⁷`
- `S_new = 0 + 49.75 × PRECISION / (1000 × ABD_SCALE) = 4.975 × 10¹⁶`
- `totalAbd = 800 ABD`

All three values cross-checked in tests to the bigint precision.

## 5. Liquidation cascade (AuctionManager)

**Contract:** `contracts/contracts/auction/AuctionManager.ral` → `computePoolShare`
**Test:** `contracts/test/auction/AuctionManager.test.ts` → `computePoolShare` suite

For one pool with `discountBps` and `totalAbd`:

```
debtCap   = min(desiredDebt, totalAbd)
alphNeeded = debtCap × (BPS + discountBps) × PRECISION × ABD_SCALE
             / (BPS × price)
```

Collateral-exhausted branch (when `alphNeeded > maxAlph`):

```
debtAbsorbable = maxAlph × BPS × price / ((BPS + discountBps) × PRECISION × ABD_SCALE)
```

Pinned vector: 500 ABD into 5 % pool at $0.05 ALPH → **10,500 ALPH** exactly.
Sanity: 500 × 1.05 / 0.05 = 10,500 ✓.

## 6. Protocol fee split

**Spec:** `docs/00-protocol-spec.md §2.1` + GitBook §Fees
**Frontend:** `web/src/app/stake/stake-live.tsx`

```
k = Σpools_abd / totalSupply(ABD)   // fraction parked in auction pools

per-fee distribution:
  pool share    = (1 − k)   — split pro-rata across pool depositors
  staker share  = k         — split pro-rata across ABX stakers
```

GitBook example: 10 % of ABD in pools → 10 % to stakers, 90 % to bidders.

Live mainnet reading from commit `7365831`: 88.6 % of ABD supply is in
pools → stakers entitled to 88.6 % of every fee event.

Implementation status: the individual sides are implemented —
`StakeManager.notifyRewards` accepts ALPH pushes; `AuctionPool.liquidate`
retains the bid-fee portion in its vault. The actual routing step
(LoanManager / AuctionPool / AuctionManager splitting fee ALPH into the
two destinations by `k`) lands in the Phase 6 tx-wiring pass.

## 7. Redemption

**Contract:** `LoanManager.ral` → `redeem`
**Paper:** `references/alphbanx-protocol-paper.pdf` §2.4.8

```
P' = P × min(1, totalCollateral × P × PRECISION / (totalDebt × PRECISION × ABD_SCALE))
```

Phase 4 simplification: we assume protocol CR ≥ 100 % and use `P' = P`.
Phase 5 adds the full min(...) form.

For the redeemed loan with amount `v` (clamped to `min(amount, debt)`):

```
alphTotal        = v × PRECISION × ABD_SCALE / price       // using P
alphRebate       = alphTotal × 150 / 10000                 // 1.5 % to borrower
alphToRedeemer   = alphTotal − alphRebate
```

The 1.5 % rebate goes to the loan's **owner**, not the protocol — this is
the "redemption fee protects borrowers whose collateral serves as reserve"
mechanism from the protocol paper §3.

## 8. Vesting (linear unlock)

**Contract:** `contracts/contracts/vesting/Vesting.ral` → `vestedAt` / `claimableAt`

```
vested(now) = totalAbx × min(durationMs, max(0, now − startMs)) / durationMs
claimable   = vested(now) − claimed
```

Earn-pool schedules (created by `AuctionFarming.creditDepositor`) default
to `durationMs = 31_536_000_000` (12 months). The Vesting contract accepts
any duration up to `10 × 12 months` to defend against fat-finger mistakes
while leaving room for long-horizon team/investor schedules if governance
ever adds them.

## 9. ABX staking reward-index

**Contract:** `contracts/contracts/staking/StakeManager.ral` → `notifyRewards` / `pendingRewardsOf`

```
// notifyRewards(amount):
rewardIndex += amount × PRECISION / totalStakedAbx    // skipped if totalStakedAbx == 0

// pendingRewardsOf(user):
total = stakedAbx × (rewardIndex − snapshotIndex) / PRECISION
pending = max(0, total − claimedAlph)
```

O(1) per staker regardless of how many `notifyRewards` calls have happened.

Donation-with-no-stakers edge case: when `totalStakedAbx == 0`, the ALPH
accumulates in the contract's vault but `rewardIndex` does not move. That
ALPH is effectively unreachable until governance adds a Phase-5-part-4
sweep mechanism; until then, operators should avoid routing fees here
during the zero-staker bootstrap period.

---

## Precision budget

The P/S snapshot factor `productP` can only shrink as liquidations happen.
Starting at `PRECISION = 10¹⁸`, a single 50 %-wipeout liquidation halves
`P`. After 59 halvings, `P` drops below 1 and integer precision collapses.

**Budget:** if the pool is half-wiped ≤ once per month, the contract
survives ~5 years before a precision-driven epoch reset is needed. AlphBanX
mainnet has seen zero full-scale liquidations in the year we have
observability for — the budget is more than adequate for v1.

If a precision reset becomes necessary, the admin pauses the pool,
`claim`s all pending ALPH for every depositor (a small indexer-driven
batch), and redeploys the pool afresh. This is a governance intervention,
not a contract upgrade.
