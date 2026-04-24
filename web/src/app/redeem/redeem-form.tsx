'use client'

import { useState } from 'react'
import { useWallet } from '@alephium/web3-react'
import { NETWORK } from '@/lib/env'
import {
  bigintToNumber,
  formatAmount,
  formatUsd,
  numberToBigint,
} from '@/lib/format'
import { useProtocolGlobals, useWalletBalances } from '@/lib/hooks'
import { useLoanScan } from '@/lib/hooks/use-loan-scan'
import { useTxRunner } from '@/lib/hooks/use-tx-runner'
import { canTransactOp, redeem } from '@/lib/tx'
import { validateUserAddress } from '@/lib/validation'
import { TxStatusLine } from '@/components/tx-status-line'
import { cn } from '@/lib/utils'

const REDEMPTION_FEE_BPS = 150 // 1.5% per spec §2

export function RedeemForm() {
  const [abdIn, setAbdIn] = useState('100')
  const [targetOwner, setTargetOwner] = useState('')
  const { state: submit, runTx } = useTxRunner()

  const wallet = useWallet()
  const { data: globals } = useProtocolGlobals()
  const { data: balances } = useWalletBalances()
  const { data: loans, isFetching: scanning } = useLoanScan(30)

  // Lowest-interest active loan = highest-priority redemption target (spec §6).
  const sortedTargets = (loans ?? [])
    .filter((l) => l.debtAbdAtto > 0n)
    .sort((a, b) => a.interestRatePercent - b.interestRatePercent)
  const bestTarget = sortedTargets[0] ?? null

  const isConnected = wallet.connectionStatus === 'connected'
  const writesAllowed = canTransactOp(NETWORK, 'redeem')
  const isBusy =
    submit.kind === 'awaitingSign' ||
    submit.kind === 'submitted' ||
    submit.kind === 'confirming'

  const priceUsd = globals?.alphUsd1e18
    ? bigintToNumber(globals.alphUsd1e18, 18)
    : null

  const amount = Number(abdIn) || 0
  const feeAbd = amount * (REDEMPTION_FEE_BPS / 10_000)
  const netAbd = Math.max(0, amount - feeAbd)
  const alphOut = priceUsd != null && priceUsd > 0 ? netAbd / priceUsd : null

  const addrValidation = validateUserAddress(targetOwner)
  const atto = numberToBigint(amount, 9)
  const canSubmit =
    isConnected &&
    writesAllowed &&
    atto > 0n &&
    addrValidation.ok &&
    !isBusy

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !wallet.signer || !addrValidation.ok) return
    await runTx(() =>
      redeem(NETWORK, wallet.signer!, addrValidation.address, atto),
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="abd">
            Redeem
            <span className="ml-1 text-muted-foreground">(ABD)</span>
          </label>
          <input
            id="abd"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={abdIn}
            onChange={(e) => setAbdIn(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          {balances?.abdAtto != null && (
            <button
              type="button"
              onClick={() =>
                setAbdIn(
                  bigintToNumber(balances.abdAtto, 9).toFixed(2).toString(),
                )
              }
              className="text-xs text-primary underline underline-offset-4 hover:text-primary/80"
            >
              Use wallet balance:{' '}
              {formatAmount(balances.abdAtto, 9, 2)} ABD
            </button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label className="text-sm font-medium" htmlFor="target">
              Target loan owner
              <span className="ml-1 text-muted-foreground">
                (Alephium address)
              </span>
            </label>
            {bestTarget && (
              <button
                type="button"
                onClick={() => setTargetOwner(bestTarget.owner)}
                className="text-xs text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Auto-pick lowest-rate: {bestTarget.interestRatePercent}% APR
              </button>
            )}
          </div>
          <input
            id="target"
            type="text"
            value={targetOwner}
            onChange={(e) => setTargetOwner(e.target.value)}
            placeholder={
              bestTarget
                ? `${bestTarget.owner.slice(0, 18)}… (auto-pick available)`
                : 'Alephium address…'
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">
            Per spec, redemptions target the lowest-interest loan first.
            {scanning
              ? ' Scanning live loans…'
              : sortedTargets.length > 0
              ? ` ${sortedTargets.length} active loan(s) scanned.`
              : ' No active loans found in the recent-activity window.'}
          </p>
          {sortedTargets.length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Pick a different target from the list
              </summary>
              <ul className="mt-2 space-y-1">
                {sortedTargets.slice(0, 8).map((l) => (
                  <li key={l.owner}>
                    <button
                      type="button"
                      onClick={() => setTargetOwner(l.owner)}
                      className="flex w-full justify-between rounded-md border border-border/50 bg-[hsl(var(--surface-2))] px-2 py-1 hover:border-primary/40"
                    >
                      <span className="font-mono">{l.owner.slice(0, 14)}…</span>
                      <span className="font-mono">
                        {l.interestRatePercent}% · debt{' '}
                        {formatAmount(l.debtAbdAtto, 9, 2)} ABD
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {!writesAllowed ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <p className="font-medium">Mainnet redemption path under construction.</p>
            <p className="mt-1">
              Deriving the on-chain method-index ABI from public transaction
              history; tracked in{' '}
              <span className="font-mono">docs/07-mainnet-write-path.md</span>.
              Switch to testnet to sign a real redeem transaction.
            </p>
          </div>
        ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'w-full rounded-md px-4 py-3 text-sm font-semibold transition-colors',
              canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            {isBusy
              ? 'Signing…'
              : !isConnected
              ? 'Connect wallet'
              : atto <= 0n
              ? 'Enter an amount'
              : !addrValidation.ok
              ? addrValidation.reason
              : 'Redeem'}
          </button>
        )}
        <TxStatusLine state={submit} />
      </form>

      <aside className="card space-y-4 p-6">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </h3>
          <dl className="mt-2 grid grid-cols-[14ch_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">ABD burned</dt>
            <dd className="font-mono">
              {amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ABD
            </dd>
            <dt className="text-muted-foreground">Fee (1.5%)</dt>
            <dd className="font-mono">
              {feeAbd.toLocaleString('en-US', { maximumFractionDigits: 4 })} ABD
            </dd>
            <dt className="text-muted-foreground">Net value</dt>
            <dd className="font-mono">
              ${formatUsd(netAbd)}
            </dd>
            <dt className="text-muted-foreground">ALPH received</dt>
            <dd className="font-mono text-primary">
              {alphOut != null
                ? `${alphOut.toLocaleString('en-US', { maximumFractionDigits: 4 })} ALPH`
                : '—'}
            </dd>
            <dt className="text-muted-foreground">ALPH / USD</dt>
            <dd className="font-mono">
              {priceUsd != null ? `$${priceUsd.toFixed(6)}` : '—'}
            </dd>
          </dl>
        </section>
        <section className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <p>
            Redemptions pull ALPH from the targeted loan and burn the
            ABD. When protocol CR falls below 100%, the contract returns ALPH
            pro-rata instead of 1:1 — so the net you receive may be less than
            the preview.
          </p>
        </section>
      </aside>
    </div>
  )
}
