# Deployment runbook

Step-by-step procedure for taking OpenABX from a fresh clone to a running
testnet deployment + a public mainnet frontend. Paranoid defaults — every
step has a pre-flight check and a verification.

This is NOT a script. It is the operator's checklist. The actual deploy
logic lives in `contracts/scripts/0_deploy.ts` (this document calls into
it at the right moments).

---

## 0. Prerequisites

- Alephium testnet ALPH for gas + the 0.1 ALPH subcontract deposits.
  Budget: ~100 ALPH covers the full 17-contract deploy with headroom.
  Faucet: `POST https://faucet.testnet.alephium.org/send` with JSON body
  `{"address":"<deployer addr>"}`. Rate-limited.
- Node ≥ 20, pnpm 9. See `CONTRIBUTING.md`.
- A testnet private key committed NOWHERE in git. Set via env:
  ```
  export TESTNET_PRIVATE_KEYS="<hex, no 0x prefix>"
  ```
- Optional: `DIA_REGISTRY_ID=216wgM3Xi5uBFYwwiw2T7iZoCy9vozPJ4XjToW74nQjbV`
  (default already set in the script; override only if testing against a
  private DIA deployment).

Pre-flight:

```
pnpm i
pnpm typecheck && pnpm lint && pnpm test
pnpm -C contracts run compile
```

All green before proceeding.

---

## 1. Deploy the 17 contracts

```
pnpm -C contracts run deploy:testnet
```

This runs `contracts/scripts/0_deploy.ts` and deposits all addresses into
`contracts/deployments/testnet.json` (alephium-cli bookkeeping).

Expected console output: a "Deploy summary" block listing addresses for
ABD, ABX, LoanManager, AuctionManager, AuctionPool×4, StakeManager,
Vesting, AuctionFarming, PlatformSettings, CircuitBreaker, DIA adapter,
ABD oracle.

Verification:

```
pnpm -C contracts exec cli deploy-status --network testnet
```

Should print 17 deployed contracts with green checkmarks.

---

## 2. Post-deploy wiring

alephium-cli's Deployer API does not expose "call method after deploy".
Wiring up the cross-contract references happens in a follow-up script
(`1_wire.ts`, to be added before first mainnet-ready deploy) OR via
manual transactions from the admin wallet via a wallet UI.

The exact sequence of calls:

| #   | Target             | Method                                                                                          | Args                                | Why                                                                              |
| --- | ------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `AbdToken`         | `transferMintAuthority`                                                                         | `newAuthority=LoanManager.address`  | Only LoanManager can mint ABD (for borrows) and burn (for repays + redemptions). |
| 2   | `AuctionManager`   | `setLoanManager`                                                                                | `newRef=LoanManager.contractId`     | LoanManager is the only caller permitted to invoke `absorbDebt`.                 |
| 3   | `AuctionManager`   | `setPools` (if not set at deploy)                                                               | `p5, p10, p15, p20`                 | Ensures the pool refs are wired even if deploy-time init missed them.            |
| 4   | `Vesting`          | `setCreator`                                                                                    | `newCreator=AuctionFarming.address` | Earn-pool ABX emissions bypass the admin.                                        |
| 5   | `StakeManager`     | (no wiring needed)                                                                              | —                                   | Entry points are wallet-facing; notifyRewards is permissionless.                 |
| 6   | `PlatformSettings` | `setLoanManager`, `setBorrowerOperations`, `setAuctionManager`, `setStakeManager`, `setVesting` | matching contract ids               | Frontend reads all addresses from here.                                          |
| 7   | `AuctionFarming`   | `setNotifier`                                                                                   | `newRef=AuctionManager.contractId`  | Only AuctionManager may credit depositors with ABX.                              |
| 8   | `AuctionFarming`   | `topUp`                                                                                         | `amount=7_000_000 × 10⁹` ABX        | Fund the community-reserve pool (requires admin holding ABX).                    |

Verification after wiring:

- `AbdToken.getMintAuthority()` returns `LoanManager.address`.
- `AuctionManager.getLoanManager()` returns `LoanManager.contractId`.
- `AuctionManager.isWired()` returns `true`.
- `LoanManager.getAuctionManager()` matches `AuctionManager.contractId`.
- `Vesting.getCreator()` returns `AuctionFarming.address`.
- `AuctionFarming.getNotifier()` returns `AuctionManager.contractId`.

---

## 3. Fund initial distributions

At deploy time, ABX issues 100M to the deployer. That needs to flow:

| Allocation                                      | Amount         | Destination            | Notes                                                                             |
| ----------------------------------------------- | -------------- | ---------------------- | --------------------------------------------------------------------------------- |
| Auction-pool yield farming                      | 7,000,000 ABX  | `AuctionFarming.topUp` | Feeds 12-month linear unlocks for earn-pool depositors.                           |
| Team / investor / treasury                      | 68,000,000 ABX | Multisig treasury      | **Do NOT deploy these until governance procedure is ratified** (§7 spec item #8). |
| Circulating (stakers, liquidity, future growth) | 25,000,000 ABX | Deployer wallet        | Distribute per governance.                                                        |

On testnet a single EOA deployer is fine. For mainnet-ready deploy (not
this release — see `RELEASE-CANDIDATE.md`), replace the deployer with a
multisig and wrap every admin call in a 24-hour Timelock (Phase 5 part 4).

---

## 4. Smoke-test the deployment

Manual on devnet (if available):

1. Start a fresh devnet: `pnpm -C contracts run devnet:start`.
2. Call `BorrowerOperations.openLoan(100 ALPH, 100 ABD, 5 %)` from a funded
   devnet wallet.
3. Observe: LoanOpened event; ABD in wallet; CR on `/borrow` shows ≈
   500 % (1000 / 200 / 1).
4. Pay a mock liquidation: drop `MockDiaRegistry.setValue` price to
   `$0.001` (forcing CR < 200 %), then call
   `BorrowerOperations.liquidate(owner)`. Observe: loan destroyed,
   collateral consumed across pools.

The Phase 7 Playwright smoke runs a subset of this on CI. The devnet
integration suite (Phase 7) exercises the full cascade + redeem path.

On testnet:

1. `/dev/tokens` should show deployed ABD/ABX totalSupply.
2. `/borrow` calculator should respond to the oracle price.
3. `/auction` should show your four pool addresses and empty ABD TVL.

---

## 5. Frontend cutover to testnet

```
# Vercel env:
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_ENABLE_DEV_ROUTES=true
```

Deploy `web/` to Vercel (preview first, then promote to `main`
production). Verify the five routes: `/`, `/borrow`, `/auction`,
`/stake`, `/vesting`, `/dev/tokens`.

---

## 6. Mainnet frontend (read-only, third-party)

For the mainnet build, NEVER deploy our contracts to mainnet. AlphBanX's
contracts are already there. Vercel env:

```
NEXT_PUBLIC_NETWORK=mainnet
NEXT_PUBLIC_ENABLE_DEV_ROUTES=false
```

The `MainnetDisclaimer` banner (see `web/src/components/mainnet-disclaimer.tsx`)
renders automatically. Double-check the address resolver returns the
seven high-confidence mainnet addresses from
`references/alphbanx-contract-addresses.md` before promoting.

Set up a daily cron in GitHub Actions:

```yaml
on:
  schedule:
    - cron: "0 6 * * *" # daily at 06:00 UTC
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm i
      - run: npx tsx scripts/verify-mainnet-addresses.ts
```

On failure → Slack/email alert → flip Vercel to `NEXT_PUBLIC_NETWORK=testnet`
until the mismatch is reviewed (could be an intentional AlphBanX upgrade
we haven't baselined).

---

## 7. Rollback

If the testnet deploy is bad:

- Contracts: individual instances can't be deleted, only destroyed via
  the admin's `destroy*`-style methods (not exposed on every contract).
  Simpler: deploy a fresh set with different addresses, update
  `deployments/testnet.json`, redeploy the frontend.
- Frontend: Vercel preserves build history. Promote the previous good
  commit.

If mainnet frontend misroutes to the wrong AlphBanX addresses: update
`sdk/src/addresses.ts` with the corrected addresses and ship a patch
release.

---

## 8. Known gotchas

- **Ralph `errorOnWarnings: true`** fails on any unused imm/mut field. If
  the deploy errors with "Found unused field in X", edit the contract to
  remove or actually use the field; don't relax the warning gate.
- **`cli compile` requires a live node**. Our default uses testnet. For
  air-gapped CI, point at a local devnet instead (`cli compile --network
devnet` with a running `cli devnet start`).
- **Alephium bin name is `cli`**, not `alephium`. Scripts in
  `contracts/package.json` already call `cli`.
- **Subcontract creation needs ALPH** — 0.1 ALPH per new subcontract.
  Keep ≥ 50 ALPH in the deployer through the initial bootstrap (open
  ~100 loans worst-case gets us into the ~10 ALPH range).
- **`MockDiaRegistry` is dev-only**. The deploy script skips it unless
  `networkId === 4` (devnet). Never deploy it to testnet or mainnet.

---

## 9. Sign-off checklist

Before declaring a deploy complete:

- [ ] All 17 contracts deployed and visible on `explorer.alephium.org`.
- [ ] Post-deploy wiring steps 1-8 executed, verified.
- [ ] ABX community reserve topped up into AuctionFarming.
- [ ] Daily mainnet-address verification cron active.
- [ ] Frontend Vercel deploy passing `pnpm e2e:smoke`.
- [ ] `/dev/tokens`, `/borrow`, `/auction`, `/stake`, `/vesting` all
      return HTTP 200 and show live state on the target network.
- [ ] `RELEASE-CANDIDATE.md` updated with the deploy commit hash and
      mainnet-audit prerequisites met.
