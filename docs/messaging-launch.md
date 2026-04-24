# Launch messaging — v0.1.0-beta

Drafts for public communication. Every piece leads with the same
framing: OpenABX is an **unaffiliated, open-source third-party UI**
over AlphBanX's mainnet contracts. Clean-room reverse-engineered.
Runs fully client-side. Hosted on GitHub Pages.

## Principles

1. Never imply partnership or endorsement from AlphBanX.
2. Never call OpenABX a "mirror" or "clone" — it's a UI, not a fork.
3. Always disclose pre-audit status and simulation-before-sign.
4. Point at the repo for anyone who wants to read the code.

## Short copy (bio / description)

> OpenABX — community-maintained, open-source UI for the AlphBanX
> stablecoin protocol on Alephium. Unaffiliated with AlphBanX. Runs
> entirely in your browser. Pre-audit beta. MIT licensed.

## X / Twitter — launch thread

**Post 1/5**

> OpenABX v0.1.0-beta is live.
>
> It's an open-source, clean-room UI for the AlphBanX stablecoin
> protocol on Alephium. Unaffiliated with AlphBanX. 100 % client-side.
> Hosted on GitHub Pages — no server, no analytics, no you-as-product.
>
> github.com/<org>/openabx

**Post 2/5**

> Why it exists:
>
> AlphBanX is useful. It's also one frontend away from being unusable
> if that frontend ever goes offline. OpenABX is the backup. If
> app.alphbanx.com disappears, this keeps working.

**Post 3/5**

> What works today on mainnet:
>
> borrow · repay · add/withdraw collateral · close loan · redeem ·
> stake · unstake · claim · deposit/withdraw/claim auction pool.
>
> Every click is simulated against live mainnet state before the
> wallet prompts. If it would revert, you see the error instead of
> signing a failing tx.

**Post 4/5**

> What's not live yet:
>
> — `liquidate` button. We haven't observed a live liquidation tx on
> mainnet (all loans are above 200 % CR). The scanner still runs;
> keepers can trigger via their own tooling. It'll light up when the
> first liquidation lands.
>
> — `vesting claim`. AlphBanX hasn't activated Vesting on mainnet.

**Post 5/5**

> How to verify it's safe to use:
>
> 1. The repo is MIT, clean-room, all on GitHub.
> 2. A daily cron re-hashes every AlphBanX mainnet contract we talk
>    to. If any drift, we auto-open an incident.
> 3. Every write simulates first. No bytecode we haven't seen
>    AlphBanX users sign themselves.
>
> Pre-audit. Read `docs/05-security.md §Incident response` before
> depositing meaningful value.

## Discord — server announcement

> **OpenABX v0.1.0-beta is now live.**
>
> OpenABX is a community-maintained, open-source UI for AlphBanX
> (unaffiliated). Runs in your browser. Everything you can do at
> app.alphbanx.com — borrow, stake, auction pools, redeem — also
> works here, against the same mainnet contracts.
>
> Why: if app.alphbanx.com ever goes dark, OpenABX keeps working.
> That's the whole pitch.
>
> **Hosted on GitHub Pages. No server. MIT. Pre-audit beta.**
>
> - URL: `<user>.github.io/openabx`
> - Repo: `github.com/<org>/openabx`
> - Security: `docs/05-security.md`
>
> Every transaction is simulation-verified before your wallet sees
> it — if it would revert, you see an error instead of signing.
> `liquidate` and `vesting claim` aren't wired yet; see the repo
> README for why.
>
> Before you use with meaningful value: read the alpha banner on
> every page and skim `docs/05-security.md §Incident response`.

## Telegram — channel message

> **OpenABX v0.1.0-beta** — open-source UI for AlphBanX.
> Unaffiliated. Client-side. GitHub Pages.
> Write path verified for 13 of 14 ops via simulation-before-sign.
> `github.com/<org>/openabx` · pre-audit beta.

## Reddit / forum posts

Title: `OpenABX: an open-source, unaffiliated UI for the AlphBanX
stablecoin protocol on Alephium`

Body:

> I built OpenABX as a clean-room, open-source UI for AlphBanX.
> Unaffiliated with the AlphBanX team.
>
> The goal is narrow: if `app.alphbanx.com` ever goes dark — rug,
> lawsuit, server bill — OpenABX keeps working. It's a frontend
> redundancy layer for a protocol that people have real money in.
>
> - Clean-room: every write template built from publicly-observable
>   mainnet transactions; no AlphBanX source code touched.
> - Client-side: `next build` with `output: 'export'`, served static
>   from GitHub Pages. No server, no analytics, no account.
> - Simulation-gated: every write goes through `/contracts/call-tx-script`
>   before the wallet prompts.
> - Daily address watchdog: auto-opens an incident issue if any of
>   AlphBanX's mainnet contracts drift from our baseline codeHash.
>
> It's pre-audit beta. I wouldn't use it for your retirement fund
> yet. But if you want a second way into the protocol — or just want
> to read how the AlphBanX contracts actually work — the repo has
> every observation documented.
>
> Repo: `github.com/<org>/openabx`

## FAQ — for moderators to copy-paste

**Q: Are you AlphBanX?**
No. Unaffiliated. We don't have their signing keys, we don't have
any admin role on any of their contracts, we don't speak for them.
We're a UI that talks to the same on-chain contracts their UI does.

**Q: Is my money at risk using this vs app.alphbanx.com?**
The contracts are the same — it's the same ABD, same ABX, same
loans, same pools. What changes is the frontend code. Ours is MIT,
clean-room, reviewable. Theirs is proprietary. Pick whichever one
you audit more easily.

**Q: What if you ship a malicious update?**
GitHub Pages deploys from a specific commit on a specific branch.
Every build is tagged in the repo. If you don't trust a release,
fork the repo at a known-good commit and host your own.

**Q: Why doesn't liquidate work?**
No liquidation has happened on AlphBanX mainnet yet (every loan is
above 200 % CR). We can't reverse-engineer a transaction template
from transactions that don't exist. The scanner runs; the submit
button activates after the first observed liquidation.

**Q: Why doesn't vesting claim work?**
AlphBanX hasn't activated the Vesting contract on mainnet. The
mainnet Vesting address from their GitBook returns empty state
when queried. When they turn it on, our page lights up
automatically.

## Distribution checklist

Before the launch tweet fires:

- [ ] Repo is public and `v0.1.0-beta` tag is pushed.
- [ ] Pages deploy succeeded — hit every route and confirm no
      console errors on mainnet.
- [ ] `SECURITY.md` reporting email is monitored.
- [ ] `AlphaBanner` on the site links to `RELEASE-CANDIDATE.md`.
- [ ] Moderators in any Discord/Telegram where the link gets posted
      are briefed that OpenABX is NOT AlphBanX.
- [ ] The daily `verify-mainnet-addresses` cron has run at least
      once successfully (no drift alerts pending).
