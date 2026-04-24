'use client'

import { useState } from 'react'
import { useWallet } from '@alephium/web3-react'
import { NETWORK } from '@/lib/env'
import {
  canTransactOp,
  claimStakingRewards,
  claimUnstake,
  requestUnstake,
  stakeAbx,
} from '@/lib/tx'
import { useStakePosition, useWalletBalances } from '@/lib/hooks'
import { useTxRunner } from '@/lib/hooks/use-tx-runner'
import { formatAmount, numberToBigint } from '@/lib/format'
import { TxStatusLine } from '@/components/tx-status-line'
import { cn } from '@/lib/utils'

type StakeMode = 'stake' | 'unstake'

export function StakeActions() {
  const wallet = useWallet()
  const { data: stake } = useStakePosition()
  const { data: balances } = useWalletBalances()
  const [mode, setMode] = useState<StakeMode>('stake')
  const [amount, setAmount] = useState('')
  const { state: submit, runTx } = useTxRunner()

  const writesAllowed = canTransactOp(NETWORK, 'stake')
  const isConnected = wallet.connectionStatus === 'connected'
  const isBusy =
    submit.kind === 'awaitingSign' ||
    submit.kind === 'submitted' ||
    submit.kind === 'confirming'

  async function runPrimary(e: React.FormEvent) {
    e.preventDefault()
    if (!isConnected || !wallet.signer) return
    const raw = Number(amount) || 0
    if (raw <= 0) return
    const atto = numberToBigint(raw, 9)
    if (atto <= 0n) return
    await runTx(() =>
      mode === 'stake'
        ? stakeAbx(NETWORK, wallet.signer!, atto)
        : requestUnstake(NETWORK, wallet.signer!, atto),
    )
  }

  async function runClaim(label: 'rewards' | 'unstake') {
    if (!isConnected || !wallet.signer) return
    await runTx(() =>
      label === 'rewards'
        ? claimStakingRewards(NETWORK, wallet.signer!)
        : claimUnstake(NETWORK, wallet.signer!),
    )
  }

  const cooldownReady =
    stake?.pendingUnstakeAtto &&
    stake.pendingUnstakeAtto > 0n &&
    stake.unstakeReadyAtMs > 0n &&
    Date.now() >= Number(stake.unstakeReadyAtMs)

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Your stake
      </h3>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Staked"
          value={`${formatAmount(stake?.stakedAtto ?? null, 9, 2)} ABX`}
        />
        <Stat
          label="Pending rewards"
          value={`${formatAmount(stake?.pendingRewardsAtto ?? null, 18, 4)} ALPH`}
        />
        <Stat
          label="Pending unstake"
          value={
            stake && stake.pendingUnstakeAtto > 0n
              ? `${formatAmount(stake.pendingUnstakeAtto, 9, 2)} ABX`
              : '—'
          }
          note={
            stake && stake.pendingUnstakeAtto > 0n && stake.unstakeReadyAtMs > 0n
              ? cooldownReady
                ? 'cooldown elapsed — claim ready'
                : `ready ${new Date(Number(stake.unstakeReadyAtMs)).toLocaleString()}`
              : undefined
          }
        />
      </div>

      <form
        onSubmit={runPrimary}
        className="card grid gap-3 p-5 sm:grid-cols-[auto_1fr_auto]"
      >
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode('stake')}
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              mode === 'stake'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            Stake
          </button>
          <button
            type="button"
            onClick={() => setMode('unstake')}
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              mode === 'unstake'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            Request unstake
          </button>
        </div>
        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={
            mode === 'stake'
              ? `ABX (balance ${formatAmount(balances?.abxAtto ?? null, 9, 2)})`
              : `ABX (staked ${formatAmount(stake?.stakedAtto ?? null, 9, 2)})`
          }
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        {writesAllowed ? (
          <button
            type="submit"
            disabled={!isConnected || isBusy}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-semibold',
              isConnected && !isBusy
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            {isBusy
              ? 'Signing…'
              : mode === 'stake'
              ? 'Stake'
              : 'Request'}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground"
          >
            Mainnet write pending
          </button>
        )}
      </form>

      {writesAllowed && (
        <div className="flex flex-wrap gap-2">
          {(stake?.pendingRewardsAtto ?? 0n) > 0n && (
            <button
              type="button"
              onClick={() => runClaim('rewards')}
              disabled={isBusy}
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary hover:bg-primary/15 disabled:opacity-60"
            >
              Claim{' '}
              {formatAmount(stake?.pendingRewardsAtto ?? 0n, 18, 4)} ALPH
              rewards
            </button>
          )}
          {cooldownReady && (
            <button
              type="button"
              onClick={() => runClaim('unstake')}
              disabled={isBusy}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              Claim {formatAmount(stake?.pendingUnstakeAtto ?? 0n, 9, 2)} ABX
            </button>
          )}
        </div>
      )}

      <TxStatusLine state={submit} />
    </section>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
