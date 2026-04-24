# Security notes

Threat model, known gaps, and disclosure process. Essential reading before
running OpenABX on anything beyond devnet.

## Scope

OpenABX ships two artefacts:

1. **Reference Ralph contracts** (testnet only). Our clean-room
   reimplementation of AlphBanX. Open to anyone to fork, audit, and
   deploy. We do NOT deploy them to mainnet — AlphBanX's contracts are
   already there.
2. **Next.js frontend** served on mainnet. A *third-party UI* over
   AlphBanX's deployed contracts. Users' funds are at risk from the
   underlying contracts; the UI's role is to correctly construct
   transactions that the user signs.

Each artefact has a different security posture and disclosure procedure.

---

## Threat model — the contracts

### T1. CR computation errors

The MCR check guards every state-changing call. A bug that under-states
the required collateral would allow insolvent positions.

**Mitigation:** every CR branch has a pinned unit test with a known-good
vector (`docs/03-reward-math.md §1`). Property tests run 10k random
inputs through `computeCr` in the contracts workspace.

**Residual risk:** medium — we have not formally verified the fixed-point
arithmetic. A paid audit pass before mainnet deploy is mandatory (see
`RELEASE-CANDIDATE.md`).

### T2. Oracle manipulation

LoanManager methods accept `price` as a caller-supplied argument to keep
the API deterministic. BorrowerOperations fetches the live DIA value and
forwards it — but nothing prevents an attacker from calling LoanManager
directly with a spoofed price.

**Mitigation:** Phase 5 part 4 adds an oracle-staleness cross-check
inside LoanManager that bounds the caller-supplied price against the
CircuitBreaker's last-observed DIA reading. Until then, deploying
publicly on testnet is safe (no real money); mainnet deploy is NOT.

**Residual risk:** high for mainnet; negligible for testnet.

### T3. Redemption ordering

Phase 4 ships a single-loan `redeem` that takes the target loan as an
argument. A redeemer could pick a high-interest loan to help that
borrower avoid force-closure, breaking the "lowest interest rate first"
invariant the paper specifies.

**Mitigation:** Phase 5 part 4 wires the `SortedList` from Phase 3
into LoanManager and replaces the caller-supplied loan argument with a
sorted traversal. Until then, the documented redemption semantics differ
from the paper — frontend copy reflects this.

### T4. Pool precision collapse

The P/S snapshot factor `productP` shrinks monotonically. After ~59
50%-wipeouts it drops below 1 and precision collapses.

**Mitigation:** `docs/03-reward-math.md §Precision budget` projects a
~5-year runway at AlphBanX's observed wipeout cadence (0 full wipeouts
in a year). If the budget is exhausted, the admin pauses the pool,
claims for all depositors, and redeploys. This is documented as a
governance intervention, not a contract upgrade.

### T5. Subcontract path collisions

Loans use `path = toByteVec!(owner)`. Two different accounts cannot
collide (Alephium addresses are unique). Map-entries in
AuctionPool/Vesting similarly use address keys.

**Residual risk:** negligible.

### T6. Admin compromise

Every mutator-with-admin gate (`setParameters`, `setAuctionManager`,
`setPools`, `setCreator`, `transferMintAuthority`, etc.) can be abused
by a compromised admin key to:

- Redirect the ABD mint authority to a malicious contract.
- Swap the AuctionManager's pool list mid-flight (orphaning deposits).
- Retarget Vesting's creator to a contract that emits infinite schedules
  (within the reserve balance).

**Mitigation for mainnet-ready deploys:** Phase 5 part 4 wraps every
admin call in a 24-hour Timelock + multisig. Until then, DO NOT mainnet-
deploy; a single EOA admin is fine for testnet but insufficient for
real funds.

**Residual risk:** high until Timelock lands.

### T7. APS approval reuse

When a wallet approves X ALPH at call site for a nested chain, the full
X is available at every nested contract that opts into
`preapprovedAssets`. A contract in the chain could drain the remainder.

**Mitigation:** every nested `{caller -> ALPH: amount}` in our code
explicitly bounds the nested approval to the exact amount that call
needs. Audit grep: `grep -rn "caller -> ALPH" contracts/contracts/`.

**Residual risk:** low.

---

## Threat model — the frontend

### F1. Upstream contract upgrade

AlphBanX could upgrade their mainnet contracts under us, changing the
ABI and causing our frontend to construct malformed transactions.

**Mitigation:** `scripts/verify-mainnet-addresses.ts` runs daily in CI
and compares every mainnet `codeHash` to a Phase-0 baseline. On
mismatch, the cron exits non-zero; the frontend is flipped to an "under
maintenance" page pending review.

**Residual risk:** medium — a 24-hour window exists where an upgrade
could land between cron runs and a user could sign a stale-ABI tx.

### F2. Transaction confusion

The mainnet frontend is a third-party UI. A user reading confirmations
from their wallet must understand that OpenABX did NOT deploy the
contracts they're signing against.

**Mitigation:** persistent top-of-page banner (`MainnetDisclaimer`
component) + first-run modal (Phase 6) explaining the distinction.
README and SECURITY.md both state it explicitly.

**Residual risk:** low (educated user) to medium (naïve user).

### F3. Private-key exposure in the repo

None of our code touches private keys directly. The testnet deploy
script reads `TESTNET_PRIVATE_KEYS` from env only. No tokens, cookies,
or secrets are written to git — `.gitignore` excludes `.env.local` and
`.env.*.local`.

Enforcement: a pre-commit hook (`.husky/pre-commit`, to be added in
Phase 7 part 2) greps for `private_key|TESTNET_PRIVATE` patterns.

### F4. Supply-chain compromise

npm dependencies are pinned via `pnpm-lock.yaml`. Renovate / Dependabot
PRs are reviewed before merge. We do NOT auto-update.

**Residual risk:** medium — a compromised transitive dep could inject
malicious code into the Vercel build. Mitigation: run `pnpm audit` on
every PR (added to CI in Phase 7 part 2) and keep dependency count
minimal.

---

## Known gaps

Items documented as `NEEDS_HUMAN_CONFIRMATION` or explicit TODOs:

1. **Timelock** (T6 mitigation) — Phase 5 part 4.
2. **Oracle cross-check** (T2 mitigation) — Phase 5 part 4.
3. **Sorted-list redemption** (T3 mitigation) — Phase 5 part 4.
4. **Fee-split routing** — LoanManager and AuctionPool collect fees but
   do not yet call `StakeManager.notifyRewards` or the pool-depositor
   payout. See `docs/02-execution-plan.md §Phase 6`.
5. **ABX staking cold-start** — first-time `notifyRewards` with zero
   stakers silently donates the ALPH. A sink-bleeder is needed to
   reclaim it once staking starts.
6. **30-day market fuzz test** — the plan called for this. Not run in CI
   yet; reference Python simulator in `tests/fixtures/` is a separate
   follow-up.
7. **Minimum loan size (dust attack)** — fixed at 100 ABD by default;
   this is a guess, not a derived value. Real deployment should analyse
   worst-case redemption gas against pool size and adjust.
8. **ABD debt-ceiling** — no supply cap enforced on the mint path. Safe
   as long as MCR is respected, but governance should consider setting
   one.

---

## Disclosure process

### For security issues in our Ralph contracts

Email `security@openabx.example` (adjust to real address before launch)
or open a GitHub Security Advisory at `Security → Report a vulnerability`.

Include:

- Commit hash affected.
- Reproduction steps (preferably a failing test).
- Your preferred disclosure timeline + attribution.

We commit to:

- Acknowledge within 72 hours.
- Preliminary assessment within 7 days.
- Coordinated disclosure window negotiated; default 30 days from
  acknowledgement, extensible for complex issues.

Fixes land via normal PR process; CVE assigned via GitHub's flow.

### For security issues in AlphBanX's mainnet contracts

**Not our contract. Report to AlphBanX directly:**

- Discord: `discord.gg/56rgKJ9HGW` (invite from their GitBook).
- Telegram: `@AlphBanX`.

If the issue affects OpenABX's frontend behaviour (e.g., a contract
upgrade that breaks our ABI), ALSO notify us so we can flip to
"maintenance" mode.

### For security issues in Alephium node or Ralph compiler

Report to `github.com/alephium` directly.

### For security issues in the DIA oracle

Report to DIA (`diadata.org`).

---

## Attestations

No external security audit has been performed on OpenABX contracts.
Before any mainnet contract deploy, `RELEASE-CANDIDATE.md` requires:

- Paid audit from at least one reputable firm.
- Resolution of every `NEEDS_HUMAN_CONFIRMATION` item in
  `docs/00-protocol-spec.md §7`.
- Resolution of gaps #1–#8 above (or explicit acceptance by governance).

---

## Incident response

Operational playbook for problems with the live mainnet frontend.
Nothing here contemplates an OpenABX contract deploy — that remains
out of scope per `RELEASE-CANDIDATE.md`. The incidents we plan for:

1. **Mainnet-address drift** — AlphBanX upgrades a contract and our
   baked-in `codeHash` no longer matches.
2. **Write-path regression** — a template we ship stops simulating
   (storage layout changed, method index moved).
3. **Wallet / RPC outage** — Alephium node unreachable, or
   WalletConnect relay down.
4. **UI compromise** — attacker ships a malicious build (leaked
   deploy key, supply-chain compromise).

### Detection

| Signal | Source | Action |
|---|---|---|
| `verify-mainnet-addresses` failure | `.github/workflows/verify-mainnet.yml` (daily 07:00 UTC cron) | Auto-opens an `incident` issue; on-call triages within 2 h. |
| Simulation-revert spike | User reports in issues / Telegram | On-call reproduces against mainnet state; >3 reports in 1 h = P1. |
| No explorer response | `status.alephium.org` / node logs | Surface read-only banner; no user action possible until recovered. |
| Unexpected deploy | `Deploy to GitHub Pages` run without matching commit on main | Treat as UI compromise — escalate to P0. |

### Triage levels

- **P0 (UI compromise, may drain user funds).** Revert within 30 min.
- **P1 (write-path broken, reads still work).** Disable the affected
  page within 2 h.
- **P2 (address drift, observable but not dangerous).** Update
  baseline within 24 h after manual codeHash review.
- **P3 (upstream RPC outage).** Wait it out; post a banner.

### Response — P0 (UI compromise)

1. **Revert Pages deploy.** Go to GitHub Actions → `Deploy to GitHub
   Pages` → previous successful run → "Re-run all jobs". This
   republishes the last-known-good bundle.
2. **Freeze** `main` — branch-protection rule forbidding force-push,
   require review on every PR.
3. **Rotate** Pages deploy permissions: revoke any PATs with `repo`
   scope, audit the Deploy Keys list.
4. **Notify** community via the channels in `RELEASE-CANDIDATE.md`:
   "OpenABX reverted to commit `<sha>`; the intermediate build was
   unauthorized. Do not interact with it if you signed a tx between
   `<start>` and `<end>`."
5. **Post-mortem** in `audit/incident-YYYY-MM-DD.md`.

### Response — P1 (write-path broken)

Root cause is almost always a contract upgrade we missed.

1. `pnpm exec tsx scripts/verify-mainnet-addresses.ts` — any
   codeHash differ from baseline?
2. If yes: that contract was upgraded. Pull the new `codeHash`, new
   state layout. Re-run `scripts/catalog-alphbanx-writes.ts` and
   `scripts/observe-alphbanx-writes.ts` to confirm method indices.
3. If storage layout changed: remove the affected op from
   `VERIFIED_OPS` in `sdk/src/mainnet/index.ts` — forces the page
   into "pending" and disables the button. Ship that revert first.
4. Then fix the template and re-add to `VERIFIED_OPS`.

### Response — P2 (address drift, not dangerous)

1. Fetch new contract state; walk every mut-field slot; re-run
   `scripts/catalog-alphbanx-writes.ts` to confirm method indices
   still map to the same operations.
2. Update `BASELINES` in `scripts/verify-mainnet-addresses.ts`.
3. Commit: `baseline: rotate <role> codeHash post AlphBanX upgrade
   (<tx-hash>)`.
4. Close the auto-opened incident issue with a link to the commit.

### Communications

| Audience | Channel | When |
|---|---|---|
| Users with open positions | Banner on every page | Immediately on P0/P1 |
| Broader community | X, Discord, Telegram | Within 1 h of P0/P1 |
| AlphBanX team | Their Discord / Telegram | If the issue is upstream |
| Security researchers | Email in `SECURITY.md` | On receipt of a report |

The banner lives in `web/src/components/alpha-banner.tsx`. Build +
GH-Pages deploy is ~6 min end-to-end.

### Kill-switch

We have no protocol-level kill-switch (not our contracts). The
frontend-level kill:

1. Revert `main` to the last-known-good commit and force-push
   (maintainer approval on a protected branch).
2. Pages re-deploys from that commit within ~6 min.
3. For faster halt-on-sign without a revert: set
   `NEXT_PUBLIC_EMERGENCY_LOCK=true` in the GitHub Pages workflow
   env and re-run. The `unaudited-consent-gate` context can read
   this to globally block every write button.

### Drill cadence

Quarterly tabletop:

- Q1 — simulate P0 UI compromise; measure time-to-revert.
- Q2 — simulate P1 write-path regression; measure time-to-disable.
- Q3 — simulate P2 address drift; measure time-to-re-baseline.
- Q4 — full multi-incident (node outage + address drift same day).

Notes + timings in `audit/drills/YYYY-QN.md`.
