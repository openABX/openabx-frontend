# Mainnet write-path enablement

Status: **4 operations live, 8 pending** (2026-04-23).

- ✅ **Live on mainnet**: `stake`, `requestUnstake`, `claimUnstake`,
  `claimRewards` — all pre-flighted through `/contracts/call-tx-script`
  simulation and verified successful on real AlphBanX users.
- ⚠️ **Gated pending per-user subcontract substitution**: pool
  operations (`poolDeposit`, `poolWithdraw`, `poolClaim`) and loan
  operations (`openLoan`, `repay`, `addCollateral`, `withdrawCollateral`,
  `closeLoan`). The observed scripts embed the historical user's
  specific Loan / pool-position sub-contract ID; that ID must be
  re-computed per-caller before substitution.

## The write layer

- **`@openabx/sdk/mainnet`** — public API. `buildStake(amount)`,
  `buildClaimRewards(signer)`, and the other 12 helpers return a
  `PreparedTx` with `{bytecode, attoAlphAmount, tokens[]}`.
- **`@openabx/sdk/mainnet/template`** — `applyTemplate(tmpl, subs)`
  performs the decode → substitute → re-encode round-trip; 15/15
  templates round-trip byte-identically with zero substitutions.
  `simulateScript(nodeUrl, bytecode, caller, input)` calls the node's
  `/contracts/call-tx-script` endpoint with optional inputAssets.
- **`web/src/lib/tx.ts`** dispatches on `NETWORK`: clean-room typed
  clients on devnet/testnet; mainnet re-encoders on mainnet, each run
  through `submitPrepared()` which simulates before it signs.
- **`canMainnetWrite(op)`** in `@openabx/sdk` is the authoritative
  operation-enable gate. `canTransactOp(network, op)` in the web layer
  composes it with the network check.

OpenABX is a clean-room re-implementation; by policy we do **not** read
`app.alphbanx.com` JavaScript, decompile Ralph contract bytecode, or read
the `github.com/alphbanx` source repository. The frontend therefore cannot
trivially build transactions against AlphBanX's mainnet contracts: Ralph
methods are called by **index** on a per-contract basis, and our clean-room
method ordering is not guaranteed to match AlphBanX's.

The observation work below is clean-room compliant: it reads **public
transactions** via the Alephium explorer backend + node API and decodes
their `scriptOpt` (TxScript bytecode — the signed-by-user payload, not
contract bytecode). Every Alephium block explorer does this to render
"tx called X.foo()" in its UI.

## Tooling

### `scripts/observe-alphbanx-writes.ts`

Run:

```bash
pnpm tsx scripts/observe-alphbanx-writes.ts
```

- Pulls up to 50 recent txs per known AlphBanX contract via
  `https://backend.mainnet.alephium.org/addresses/<addr>/transactions`.
- Decodes each tx's `scriptOpt` using `@alephium/web3`'s published
  `codec.script.scriptCodec`.
- For every `CallExternal(methodIndex)` opcode, resolves the target contract
  id (pushed immediately before the opcode as `BytesConst[32]`) and
  increments a `(address, methodIndex)` counter.
- Writes a structured report to
  `references/alphbanx-mainnet-methods.json` with sample tx ids per
  `(address, methodIndex)` pair and a heuristic "argPattern" of the last six
  stack pushes.

### Observed method indices (2026-04-23)

The table below is derived by:

1. Pulling recent public transactions for each AlphBanX contract via
   `https://backend.mainnet.alephium.org/addresses/<addr>/transactions`.
2. Decoding each tx's `scriptOpt` via `@alephium/web3`'s `codec.script.scriptCodec`.
3. Computing the **net (ALPH, ABD, ABX) delta for the user wallet** across the tx.
4. Classifying the operation by delta sign (e.g., `ABD minted, ALPH out → openLoan`).

Full raw data: `references/alphbanx-operation-map.json` and
`references/alphbanx-mainnet-methods.json`. Reproducer:
`pnpm tsx scripts/catalog-alphbanx-writes.ts`.

**Confirmed mappings (ready to wire as mainnet writes):**

Deep-paginated scan of ~15,000 transactions across BorrowerOperations,
StakeManager, AuctionManager, LoanManager, and both tokens. Sample counts are
number of distinct transactions whose per-wallet token delta uniquely
identifies the operation.

| Contract                             | methodIndex | Operation                                 | Confidence | Samples                         |
| ------------------------------------ | ----------- | ----------------------------------------- | ---------- | ------------------------------- |
| **BorrowerOperations** (`28QGP95r…`) | 11          | openLoan                                  | high       | 221                             |
| BorrowerOperations                   | 12          | openLoan (variant — likely tier-specific) | high       | 46                              |
| BorrowerOperations                   | 10          | repay                                     | medium     | 421                             |
| BorrowerOperations                   | 8           | addCollateral (primary)                   | medium     | 455                             |
| BorrowerOperations                   | 7           | addCollateral (rare — likely borrowMore)  | medium     | 55                              |
| BorrowerOperations                   | 19          | closeLoan                                 | medium     | 72                              |
| BorrowerOperations                   | 20          | withdrawCollateral                        | medium     | 412                             |
| **StakeManager** (`28Mhs2…`)         | 30          | stake                                     | **high**   | 721 (+ user tx `9838896456fa…`) |
| StakeManager                         | 31          | requestUnstake                            | low        | 26                              |
| StakeManager                         | 32          | claimUnstake                              | high       | 99                              |
| StakeManager                         | 33          | claimRewards                              | medium     | 1,726                           |
| **AuctionManager** (`29YL53te…`)     | 36          | poolDeposit                               | high       | 255                             |
| AuctionManager                       | 41          | poolWithdraw                              | medium     | 386                             |
| AuctionManager                       | 40          | poolClaim                                 | high       | 95                              |
| AuctionManager                       | 42          | poolClaim (variant)                       | high       | 787                             |
| AuctionManager                       | 43          | (unclassified — 31 samples)               | low        | 31                              |

Additional surfaced contract during the scan —
`vxM9L97vxybEo3FHU9PSzwCVnBUoSispm8tpq22Twftj` — received **4,680 internal
CallExternals** with identical method-index distribution to BorrowerOperations
(indices 0, 3, 7, 8, 9, 10, 11, 12, 19, 20). Its `/addresses/.../transactions`
count is 1 (the contract-creation tx only), so it's an **internal delegate**
called from other contracts, not a user-facing entry point. Role probably
"LoanRouter v2" or a canonical Loan template.

**Remaining ambiguities (still need a tie-breaking tx):**

- BorrowerOperations mi=11 vs mi=12 — both classified openLoan. Likely one is
  openLoan-fresh and the other is openLoan-with-sorted-list-hint, or a
  versioned variant. Resolve by comparing argPattern + per-tx interest-rate
  argument: if one is always called with `U256Const=100_000_000_000_000_000n`
  (10 %) and the other varies, they share an operation with a flag.
- BorrowerOperations mi=7 vs mi=8 — mi=7 may actually be `borrowMore` (rare,
  only 2 samples vs 18 for mi=8).
- AuctionManager mi=40 vs mi=42 — both classified poolClaim. Probably pool
  index matters (claim from pool 5% vs pool 20%).
- AuctionManager mi=43 — 1 sample, unclassified.
- **BorrowerOperations mi=3, mi=9** — view/query methods used to pre-compute
  values for subsequent writes (mi=7, mi=20). Decoded 2026-04-24:
  - mi=3: takes 1 U256, returns 1 U256 (computed collateral-equivalent?).
  - mi=9: takes 1 U256 + 1 Address, returns 1 U256 (withdrawal preview?).
    These are not standalone write operations — they pair with mi=7/20.
- **`redeem`** — no observation yet. Unlike repay/close, redeem may go
  through a dedicated method on LoanManager (not via BorrowerOperations).
  The UI surfaces a clear error on click until we capture a sample.
- **`liquidate`** — similarly unseen. Most liquidations on mainnet are
  keeper-bot operated and don't produce a token delta on the caller's
  wallet our classifier can key on. A keeper tx scanner would pick it up.
- **Vesting** — probed the four candidates (`24nvcVvS…`, `uHKrQGuT…`,
  `vh9fQ2PR…`, `211mQVdd…`) on 2026-04-24. None have state consistent with
  a Vesting contract (either empty ByteVecs, all-zero state, or only hold a
  single reference ByteVec). **Conclusion: Vesting is not live on mainnet
  yet.** AlphBanX's GitBook warns of testnet-parity gaps; Vesting appears
  to be one. The /vesting page explains this to users.

## Remaining work before mainnet writes flip on

### 1. Method-index → operation mapping

For every `(address, methodIndex)` in the observation table, confirm the
operation it performs. Two compatible approaches:

- **Correlation with state-diffs.** Re-fetch each sample tx's
  `contractInputs` and `generatedOutputs`, compare the before/after
  contract state, and infer the operation by the state change (e.g., a tx
  whose LoanManager.totalDebt decreased is a repayment).
- **Method signature probing.** Call each method via
  `POST /contracts/call-contract` with intentionally-wrong args and parse
  the error message for arg-type hints. Reads only; zero risk to user funds.

### 2. Mainnet write bytecode builder

Once the mapping is known, write
`sdk/src/mainnet/write-builder.ts` that produces TxScript bytecode via
`codec.script.scriptCodec.encode({...})` with the right
`CallExternal(methodIndex)` + argument push sequence + APS approvals.
Submit via `@alephium/web3`'s `SignerProvider.signAndSubmitExecuteScriptTx`.

Target API (matches `web/src/lib/tx.ts`):

```ts
export interface MainnetTxOptions { ... }
export async function openLoanMainnet(
  signer: SignerProvider,
  collateralAlphAtto: bigint,
  borrowAbdAtto: bigint,
  interestRate1e18: bigint,
): Promise<TxResult>
// ... and equivalents for every write path
```

The write builder should route through the observed BorrowerOperations
address `28QGP95r...` for loan operations; pool deposits route through the
AuctionManager at `29YL53te...`.

### 3. Disambiguate StakeManager / Vesting / pool addresses

Not one of the known user-facing entrypoints maps to staking or vesting
actions. Either:

- AlphBanX mainnet doesn't yet have live StakeManager / Vesting contracts
  (the GitBook admits testnet parity issues), in which case the Stake and
  Vesting pages stay gated on mainnet indefinitely.
- Or these live at one of the remaining unlabeled addresses
  (`24nvcVvS...`, `uHKrQGuT...`, `vh9fQ2PR...`) and will appear in the
  observer once someone actually stakes or claims. The observer can be
  re-run periodically via cron to pick this up.

### 4. Second-source each method call before wiring

For each write we wire, grab at least 3 independent sample tx ids from the
observer output and simulate the constructed bytecode via
`POST /contracts/call-tx-script` (read-only — no gas, no state change) to
confirm it produces the same contract inputs/outputs as the real tx. If
simulation matches, the mapping is confirmed; if not, dig deeper before
exposing the button.

## Why not trust our clean-room method ordering?

Our `BorrowerOperations.ral` compiles to methods `[getLoanManager,
getOracle, getAbdTokenId, openLoan, addCollateral, withdrawCollateral,
borrowMore, repay, closeLoan, accrueInterest, liquidate, redeem]` — indices
0–11. Observation shows AlphBanX's uses indices up to 20. Different
ordering. A wrong-index call either reverts with a cryptic error or, in the
worst case, invokes a similarly-shaped method on a different operation —
losing user funds. **We do not take that risk.** Every write path lands
behind explicit confirmation via simulation before the UI enables it.
