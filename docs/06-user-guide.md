# User guide

How to use OpenABX. Written for end users — not deep-protocol readers.

OpenABX is a frontend that lets you borrow ABD (a USD-pegged stablecoin)
against your ALPH. On mainnet the frontend talks to AlphBanX's existing
contracts; on testnet it talks to OpenABX's own clean-room copy.

## Install a wallet

- **Extension Wallet** (desktop Chrome/Firefox extension) is the easiest
  path: `https://alephium.org/#wallets` → "Extension Wallet".
- **Desktop Wallet** (standalone macOS/Windows/Linux app) also works.
- **WalletConnect v2** compatible mobile wallets — scan the QR code.

Fund with a few ALPH on the target network (mainnet or testnet). The
Alephium testnet faucet is at `faucet.testnet.alephium.org`.

## The five pages

### `/` Dashboard

Overview. Shows the app is loaded, the connected network (top-right
badge), and links to the four protocol pages. On mainnet, a yellow
banner at the top makes clear that OpenABX is a third-party UI — we do
not custody your funds and we did not deploy the contracts your
transactions will hit.

### `/borrow`

Open a loan. Three inputs:

- **Collateral (ALPH)** — how much ALPH you're pledging.
- **Borrow (ABD)** — how much ABD you want to mint. 1 ABD ≈ 1 USD.
- **Interest rate** — one of eight tiers: 1 / 3 / 5 / 10 / 15 / 20 / 25 /
  30 %/year. Lower rates are redeemed first when anyone redeems ABD for
  ALPH across the protocol; choose higher if you want to avoid that
  risk.

The live panel on the right shows:

- The current **ALPH / USD price** from the DIA oracle, refreshing every
  30 seconds.
- Your **collateralization ratio** after minting: collateral value /
  borrow amount × 100 %. Must stay above 200 % or the loan becomes
  liquidatable. The ratio is colour-coded:
  - 🟢 **Conservative** (≥ 400 %): healthy for most market moves.
  - 🟢 **Moderate** (280–400 %): fine, but watch the price.
  - 🟡 **Aggressive** (230–280 %): vulnerable to a sharp drop.
  - 🟠 **High risk** (200–230 %): close to liquidation threshold.
  - 🔴 **Liquidation** (< 200 %): immediate liquidation risk.
- **Minting fee** (0.5 %): deducted from your collateral at loan open.
- **Net collateral** after fee.
- **Liquidation price**: the ALPH/USD price below which your CR drops to
  200 % and anyone can liquidate you.
- **Tier interest**: how much ABD per year your chosen tier costs.

The "Max at 200 % CR" button fills the borrow field with the largest
amount you can take at exactly the minimum CR (with a 0.05 % safety
margin so rounding doesn't push you under).

**Submit** is wired in Phase 6. On mainnet, the button text will remain
a link to `app.alphbanx.com` (the original operator) until OpenABX's own
path is audit-ready.

### `/auction`

Deposit ABD to earn the ALPH from liquidations. Four pools:

- **5 %** discount — receives collateral first, lowest premium.
- **10 %**, **15 %**, **20 %** — progressively higher priority-queue
  position but better upside.

When a vault is liquidated, its ALPH is auctioned off starting at the
5 % pool. If that pool has enough ABD, it absorbs all the debt and gets
ALPH worth `debt × 1.05` (USD-equivalent). Pool bid-success fee is
deducted (0.5 / 1 / 1.5 / 2 %); the rest is distributed pro-rata to
depositors in that pool.

Withdrawal charges a 0.5 % closing-bid fee, which stays in the pool as
treasury ALPH for other depositors.

Pool ABX yield — when your pool absorbs debt, you also earn ABX, locked
in a 12-month linear vesting schedule (see `/vesting`).

### `/stake`

Stake ABX to earn ALPH. Staked ABX entitles you to a share of every
protocol fee — minting, borrowing, liquidation, and redemption fees all
route a portion to stakers. The share is:

```
staker share = Σpool_abd / totalSupply(ABD)
```

When more ABD is sitting in auction pools (e.g. 88 % of supply), stakers
get 88 % of fees; the remaining 12 % goes to pool depositors. The system
rebalances the incentives as TVL shifts.

Unstaking triggers a **14-day cooldown** before the ABX returns to your
wallet. Claimed ALPH rewards are independent of the cooldown — you can
claim anytime.

### `/vesting`

View and claim your 12-month ABX vesting schedules. One schedule per
liquidation event your pool absorbed. Vesting is strictly linear:

```
vested = total × min(1, time_elapsed / 12_months)
```

Anyone can click "Claim" on behalf of a beneficiary — the ABX always
goes to the beneficiary, not the clicker. This lets gas-efficient cron
keepers handle claims without you needing to interact.

---

## Common flows

### Opening your first loan

1. Deposit ALPH into your wallet.
2. Go to `/borrow`.
3. Choose your collateral and borrow amounts so the CR is at least 280 %
   ("Moderate" or above). Lower CRs risk liquidation if ALPH drops.
4. Pick a tier. If you're unsure, **5 %** is the mid-market pick.
5. Submit (Phase 6).

### Topping up before liquidation

If ALPH is falling and your CR is approaching 200 %:

1. Go to `/borrow`.
2. Click "Manage loan" (Phase 6).
3. "Add collateral" to push the CR back up, OR "Repay" to reduce the
   debt.

### Closing a loan

1. Repay the full debt (need ABD ≥ your debt).
2. Click "Close loan" — remaining collateral returns to your wallet
   minus the 0.1 ALPH subcontract deposit refund.

### Getting liquidated

When your CR drops below 200 %:

1. **Anyone** can call `liquidate(yourAddress)` — typically a
   liquidation bot.
2. Your collateral is auctioned off at the 5 %-discount pool first.
3. You lose the collateral but the debt is cleared. You keep the ABD
   you originally minted plus any surplus collateral (after the pools
   consume what they need).

### Redeeming ABD for ALPH

1. Have ABD in your wallet.
2. Go to a redemption UI (Phase 6).
3. Specify how much ABD to redeem and which loan to redeem against.
4. Receive ALPH-worth of the redeemed ABD from that loan's collateral,
   minus 1.5 % redemption fee. That 1.5 % goes back to the borrower you
   force-closed — they break even on the transaction.

---

## FAQ

**Is OpenABX the same as AlphBanX?**

No. OpenABX is a clean-room open-source frontend that talks to
AlphBanX's mainnet contracts. We did not deploy those contracts. We do
not custody your funds. If AlphBanX's contracts have a bug or a rug,
OpenABX can't help. Users typing in either frontend send transactions to
the same underlying protocol.

**Why does OpenABX exist if AlphBanX has a frontend?**

(a) Open source: the code is auditable, forkable, and free to run. (b)
Redundancy: if `app.alphbanx.com` ever goes down, OpenABX is a drop-in
replacement. (c) Documentation: the `docs/` folder is a by-product of
building the clone.

**What about security?**

See `docs/05-security.md`. Short version: our contracts are unaudited;
do not use them with real money until they're audited. The mainnet UI
is a frontend over AlphBanX's already-live contracts; the contract risk
is on AlphBanX.

**What happens if the oracle fails?**

The CircuitBreaker contract watches the DIA xMarket oracle. If it goes
stale (no update in 30 min by default), every state-changing operation
reverts until a fresh price lands. You can always close a loan or
withdraw from a pool, but new borrows and liquidations are blocked.

**Why the 14-day staking cooldown?**

Prevents flash attacks: a rogue actor can't borrow ABX, stake,
manipulate the protocol for a single block, and walk away. The cooldown
keeps the staking-rewards game aligned with long-term protocol health.

**Why are redemption fees paid to the borrower, not the protocol?**

Redemption is a special case — the protocol is essentially buying back
ABD at the peg, and the cost is paid by whoever has the lowest-interest
loan. That borrower didn't ask to be force-closed, so the 1.5 % fee
compensates them. This differs from most stablecoin protocols (where
redemption fees go to stakers) and is specific to AlphBanX's
implementation.
