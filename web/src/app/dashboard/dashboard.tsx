'use client'

import Link from 'next/link'
import { useWallet } from '@alephium/web3-react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Flame,
  Gauge,
  LifeBuoy,
  Target,
  Vault,
  Wallet,
} from 'lucide-react'
import {
  useLoanPosition,
  usePoolPositions,
  useProtocolGlobals,
  useStakePosition,
  useVestingPosition,
  useWalletBalances,
} from '@/lib/hooks'
import { usePoolsTvl } from '@/lib/hooks/use-pools-tvl'
import { usePriceHistory } from '@/lib/hooks/use-price-history'
import {
  useRecentActivity,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/hooks/use-recent-activity'
import { explorerTxUrl } from '@/lib/validation'
import { bigintToNumber, formatAmount, formatUsd } from '@/lib/format'
import { Sparkline } from '@/components/sparkline'
import { cn } from '@/lib/utils'

export function Dashboard() {
  const wallet = useWallet()
  const isConnected = wallet.connectionStatus === 'connected'

  const { data: globals } = useProtocolGlobals()
  const { data: balances } = useWalletBalances()
  const { data: loan } = useLoanPosition()
  const { data: pools } = usePoolPositions()
  const { data: stake } = useStakePosition()
  const { data: vesting } = useVestingPosition()
  const { data: poolsTvl } = usePoolsTvl()
  const { data: activity } = useRecentActivity()
  const priceHist = usePriceHistory()

  const priceUsd = priceHist.latest ?? null
  const priceSeries = priceHist.samples.map((s) => s.p)

  // Protocol stats
  const abdSupply = globals?.abdTotalSupply
    ? bigintToNumber(globals.abdTotalSupply, 9)
    : null
  const abxSupply = globals?.abxTotalSupply
    ? bigintToNumber(globals.abxTotalSupply, 9)
    : null
  const tvlAlph = globals?.totalCollateralAlph
    ? bigintToNumber(globals.totalCollateralAlph, 18)
    : null
  const tvlUsd = tvlAlph != null && priceUsd != null ? tvlAlph * priceUsd : null
  const poolTvlAbd = globals?.totalPoolAbd
    ? bigintToNumber(globals.totalPoolAbd, 9)
    : null
  const protocolCrPct =
    tvlAlph != null &&
    globals?.totalDebtAbd != null &&
    globals.totalDebtAbd > 0n &&
    priceUsd != null
      ? ((tvlAlph * priceUsd) / bigintToNumber(globals.totalDebtAbd, 9)) * 100
      : null

  // User-side totals
  const loanCollUsd =
    loan?.exists && priceUsd != null
      ? bigintToNumber(loan.collateralAtto, 18) * priceUsd
      : null
  const loanDebtAbd = loan?.exists ? bigintToNumber(loan.debtAtto, 9) : null
  const loanCrPct =
    loanCollUsd != null && loanDebtAbd != null && loanDebtAbd > 0
      ? (loanCollUsd / loanDebtAbd) * 100
      : null
  const loanLiqPrice =
    loan?.exists && loanDebtAbd != null && loan.collateralAtto > 0n
      ? (loanDebtAbd * 2) / bigintToNumber(loan.collateralAtto, 18)
      : null

  const activePools = (pools ?? []).filter((p) => p.abdAtto > 0n)
  const totalPoolDeposit = activePools.reduce(
    (sum, p) => sum + bigintToNumber(p.abdAtto, 9),
    0,
  )
  const totalPoolClaim = activePools.reduce(
    (sum, p) => sum + bigintToNumber(p.claimableAlphAtto, 18),
    0,
  )

  return (
    <div className="space-y-12">
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background p-6 sm:p-8 lg:p-12">
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Live · Alephium mainnet · independent UI
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Borrow ABD,{' '}
              <span className="bg-gradient-to-r from-primary via-primary to-blue-400 bg-clip-text text-transparent">
                earn on every liquidation
              </span>
              .
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              Mint ABD against ALPH at 1–30% interest, deposit ABD into
              auction pools to absorb discounted collateral, or stake ABX to
              earn protocol fees. Every read is live from Alephium mainnet —
              no private backend, no custody, no intermediaries.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/borrow" className="btn-primary">
                Open a loan →
              </Link>
              <Link href="/auction" className="btn-ghost">
                Earn from liquidations
              </Link>
            </div>
          </div>

          {/* Hero stat card — ALPH/USD + sparkline */}
          <div className="card-elevated p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  ALPH / USD
                </p>
                <p className="mt-1 stat-value text-4xl font-semibold tabular-nums">
                  {priceUsd != null ? `$${priceUsd.toFixed(6)}` : '—'}
                </p>
              </div>
              {priceHist.change24h != null && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
                    priceHist.change24h >= 0
                      ? 'bg-primary/10 text-primary'
                      : 'bg-destructive/10 text-destructive',
                  )}
                >
                  {priceHist.change24h >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(priceHist.change24h).toFixed(2)}%
                </span>
              )}
            </div>
            <div className="mt-4">
              <Sparkline
                values={priceSeries}
                width={360}
                height={70}
                colorClass="text-primary"
                className="w-full"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {priceSeries.length >= 2
                ? `${priceSeries.length} samples over the last 24 h · DIA xMarket oracle`
                : 'Tracking DIA oracle — samples accumulate as you stay on the page.'}
            </p>
          </div>
        </div>
      </section>

      {/* ─── Protocol stats ─── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Protocol at a glance
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={Vault}
            label="Total value locked"
            primary={tvlUsd != null ? `$${formatUsd(tvlUsd, 0)}` : '—'}
            secondary={
              tvlAlph != null
                ? `${formatAmount(globals!.totalCollateralAlph!, 18, 0)} ALPH`
                : null
            }
          />
          <MetricCard
            icon={Coins}
            label="ABD in circulation"
            primary={
              abdSupply != null
                ? formatAmount(globals!.abdTotalSupply!, 9, 0)
                : '—'
            }
            secondary={
              protocolCrPct != null
                ? `protocol CR ${protocolCrPct.toFixed(0)}%`
                : null
            }
          />
          <MetricCard
            icon={Flame}
            label="ABD in pools"
            primary={
              poolTvlAbd != null
                ? formatAmount(globals!.totalPoolAbd!, 9, 0)
                : '—'
            }
            secondary="awaits a liquidation"
          />
          <MetricCard
            icon={Gauge}
            label="ABX circulating"
            primary={
              abxSupply != null
                ? formatAmount(globals!.abxTotalSupply!, 9, 0)
                : '—'
            }
            secondary="governance + fee share"
          />
        </div>
      </section>

      {/* ─── Per-pool TVL ─── */}
      {poolsTvl && poolsTvl.some((t) => t.totalAbdAtto > 0n) && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Auction pools
          </h2>
          <div className="card p-6">
            <PoolBars data={poolsTvl} />
          </div>
        </section>
      )}

      {/* ─── My positions (if connected) ─── */}
      {!isConnected ? (
        <ConnectPromo />
      ) : (
        <section className="space-y-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Your positions
            </h2>
            <span className="text-xs text-muted-foreground">
              {wallet.account.address.slice(0, 10)}…
              {wallet.account.address.slice(-4)}
            </span>
          </div>

          {/* Wallet balances */}
          <div className="grid gap-4 sm:grid-cols-3">
            <PositionCard
              icon={Wallet}
              label="ALPH"
              value={formatAmount(balances?.alphAtto ?? null, 18, 4)}
              usd={
                balances?.alphAtto != null && priceUsd != null
                  ? bigintToNumber(balances.alphAtto, 18) * priceUsd
                  : null
              }
            />
            <PositionCard
              icon={Coins}
              label="ABD"
              value={formatAmount(balances?.abdAtto ?? null, 9, 2)}
              usd={
                balances?.abdAtto != null
                  ? bigintToNumber(balances.abdAtto, 9)
                  : null
              }
            />
            <PositionCard
              icon={Gauge}
              label="ABX"
              value={formatAmount(balances?.abxAtto ?? null, 9, 2)}
              usd={null}
            />
          </div>

          {/* Loan */}
          <div className="card p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Loan</h3>
              <Link
                href="/borrow"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Manage →
              </Link>
            </div>
            {loan?.exists ? (
              <div className="grid gap-4 sm:grid-cols-4">
                <MiniStat
                  label="Collateral"
                  value={`${formatAmount(loan.collateralAtto, 18, 3)} ALPH`}
                  sub={
                    loanCollUsd != null ? `≈ $${formatUsd(loanCollUsd)}` : null
                  }
                />
                <MiniStat
                  label="Debt"
                  value={`${formatAmount(loan.debtAtto, 9, 2)} ABD`}
                  sub={`rate ${(bigintToNumber(loan.interestRate1e18, 18) * 100).toFixed(0)}% / yr`}
                />
                <MiniStat
                  label="CR"
                  value={
                    loanCrPct != null ? `${loanCrPct.toFixed(1)}%` : '—'
                  }
                  tone={
                    loanCrPct != null && loanCrPct < 230
                      ? 'danger'
                      : loanCrPct != null && loanCrPct < 280
                      ? 'warning'
                      : 'primary'
                  }
                  sub="liquidates < 200%"
                />
                <MiniStat
                  label="Liq. price"
                  value={
                    loanLiqPrice != null
                      ? `$${loanLiqPrice.toFixed(6)}`
                      : '—'
                  }
                  sub="per ALPH"
                />
              </div>
            ) : (
              <EmptyState
                message="No open loan."
                cta={{ href: '/borrow', label: 'Open a loan' }}
              />
            )}
          </div>

          {/* Pool + Stake + Vesting in one row */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-base font-semibold">Auction pools</h3>
                <Link
                  href="/auction"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Manage →
                </Link>
              </div>
              {activePools.length > 0 ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Deposited</span>
                    <span className="font-mono">
                      {totalPoolDeposit.toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      ABD
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Claimable</span>
                    <span className="font-mono text-primary">
                      {totalPoolClaim.toLocaleString('en-US', {
                        maximumFractionDigits: 4,
                      })}{' '}
                      ALPH
                    </span>
                  </div>
                  <div className="border-t border-border/60 pt-2 text-xs text-muted-foreground">
                    Across {activePools.length} active{' '}
                    {activePools.length === 1 ? 'tier' : 'tiers'}
                  </div>
                </div>
              ) : (
                <EmptyState
                  message="No pool deposits."
                  cta={{ href: '/auction', label: 'Deposit ABD' }}
                />
              )}
            </div>

            <div className="card p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-base font-semibold">Staking</h3>
                <Link
                  href="/stake"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Manage →
                </Link>
              </div>
              {stake && stake.stakedAtto > 0n ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Staked</span>
                    <span className="font-mono">
                      {formatAmount(stake.stakedAtto, 9, 2)} ABX
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rewards</span>
                    <span className="font-mono text-primary">
                      {formatAmount(stake.pendingRewardsAtto, 18, 4)} ALPH
                    </span>
                  </div>
                  {stake.pendingUnstakeAtto > 0n && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Unlocking</span>
                      <span className="font-mono text-warning">
                        {formatAmount(stake.pendingUnstakeAtto, 9, 2)} ABX
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  message="Not staked."
                  cta={{ href: '/stake', label: 'Stake ABX' }}
                />
              )}
            </div>

            <div className="card p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-base font-semibold">Vesting</h3>
                <Link
                  href="/vesting"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Manage →
                </Link>
              </div>
              {vesting?.exists ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-mono">
                      {formatAmount(vesting.totalAbxAtto, 9, 2)} ABX
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Claimable</span>
                    <span className="font-mono text-primary">
                      {formatAmount(vesting.claimableAtto, 9, 2)} ABX
                    </span>
                  </div>
                </div>
              ) : (
                <EmptyState message="Not live on mainnet." />
              )}
            </div>
          </div>
        </section>
      )}

      {/* ─── Recent activity (only when connected) ─── */}
      {isConnected && activity && activity.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your recent activity
          </h2>
          <ActivityTable entries={activity} />
        </section>
      )}

      {/* ─── Quick actions ─── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Take action
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            icon={Vault}
            title="Borrow ABD"
            desc="Deposit ALPH. Pick 1–30% APR. Keep CR above 200%."
            href="/borrow"
            accent="primary"
          />
          <ActionCard
            icon={Flame}
            title="Earn from liquidations"
            desc="Deposit ABD into a 5/10/15/20% pool. Absorb discounted collateral."
            href="/auction"
            accent="amber"
          />
          <ActionCard
            icon={Gauge}
            title="Stake ABX"
            desc="Claim a share of every protocol fee. Paid in ALPH."
            href="/stake"
            accent="blue"
          />
          <ActionCard
            icon={Target}
            title="Redeem ABD"
            desc="Burn ABD for ALPH at 1:1 USD. Keeps ABD pinned to $1."
            href="/redeem"
            accent="primary"
          />
          <ActionCard
            icon={LifeBuoy}
            title="Liquidate"
            desc="Trigger a liquidation on below-MCR vaults. Permissionless."
            href="/liquidate"
            accent="red"
          />
          <ActionCard
            icon={Wallet}
            title="Manage loan"
            desc="Add / withdraw collateral, borrow more, repay, close."
            href="/borrow"
            accent="blue"
          />
        </div>
      </section>
    </div>
  )
}

/* ───── sub-components ───── */

function MetricCard({
  icon: Icon,
  label,
  primary,
  secondary,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  primary: string
  secondary: string | null
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 stat-value text-2xl font-semibold tabular-nums">
        {primary}
      </p>
      {secondary && (
        <p className="mt-1 text-xs text-muted-foreground">{secondary}</p>
      )}
    </div>
  )
}

function PositionCard({
  icon: Icon,
  label,
  value,
  usd,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  usd: number | null
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 stat-value text-2xl font-semibold tabular-nums">
        {value}
      </p>
      {usd != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          ≈ ${formatUsd(usd)}
        </p>
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string | null
  tone?: 'primary' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warning'
      ? 'text-warning'
      : ''
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 stat-value font-mono text-lg font-semibold tabular-nums',
          toneClass,
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function EmptyState({
  message,
  cta,
}: {
  message: string
  cta?: { href: string; label: string }
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
      <p>{message}</p>
      {cta && (
        <Link
          href={cta.href}
          className="text-xs font-medium text-primary hover:underline"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  )
}

function PoolBars({
  data,
}: {
  data: Array<{ tierBps: number; totalAbdAtto: bigint }>
}) {
  const numeric = data.map((d) => ({
    tier: d.tierBps / 100,
    abd: Number(d.totalAbdAtto) / 1e9,
  }))
  const max = Math.max(...numeric.map((n) => n.abd), 1)
  const badgeColor: Record<number, string> = {
    5: 'text-primary',
    10: 'text-primary',
    15: 'text-warning',
    20: 'text-destructive',
  }
  return (
    <div className="space-y-3">
      {numeric.map((n) => (
        <div key={n.tier} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className={cn('font-medium', badgeColor[n.tier] ?? '')}>
              {n.tier}% pool
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {n.abd.toLocaleString('en-US', { maximumFractionDigits: 0 })} ABD
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                n.tier === 20
                  ? 'bg-destructive'
                  : n.tier === 15
                  ? 'bg-warning'
                  : 'bg-primary',
              )}
              style={{ width: `${Math.max(2, (n.abd / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ConnectPromo() {
  return (
    <section className="card-elevated relative overflow-hidden p-8">
      <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Connect a wallet</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            See your open loan, pool deposits, staked ABX, and vesting
            schedule. Every click is pre-flighted via on-chain simulation
            before we ask you to sign.
          </p>
        </div>
        <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          Use the <strong>Connect</strong> button in the top-right →
        </p>
      </div>
    </section>
  )
}

function ActionCard({
  icon: Icon,
  title,
  desc,
  href,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  href: string
  accent: 'primary' | 'amber' | 'blue' | 'red'
}) {
  const bgClass = {
    primary: 'from-primary/10 via-transparent',
    amber: 'from-amber-500/10 via-transparent',
    blue: 'from-blue-500/10 via-transparent',
    red: 'from-destructive/10 via-transparent',
  }[accent]
  const iconClass = {
    primary: 'text-primary',
    amber: 'text-warning',
    blue: 'text-blue-400',
    red: 'text-destructive',
  }[accent]
  return (
    <Link
      href={href}
      className={cn(
        'group card relative overflow-hidden bg-gradient-to-br p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_20px_40px_-20px_hsl(var(--primary)/0.25)]',
        bgClass,
      )}
    >
      <Icon className={cn('mb-3 h-5 w-5', iconClass)} />
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <span className="mt-4 inline-flex text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Enter →
      </span>
    </Link>
  )
}

const KIND_LABEL: Record<ActivityKind, string> = {
  openLoan: 'Open loan',
  repay: 'Repay',
  addCollateral: 'Add collateral',
  withdrawCollateral: 'Withdraw collateral',
  closeLoan: 'Close loan',
  redeem: 'Redeem',
  stake: 'Stake',
  unstake: 'Unstake',
  claim: 'Claim',
  poolDeposit: 'Pool deposit',
  poolWithdraw: 'Pool withdraw',
  poolClaim: 'Pool claim',
  other: 'Other',
}

function formatDelta(attoValue: bigint, decimals: number, fractionDigits = 2): string {
  const sign = attoValue < 0n ? '-' : '+'
  const abs = attoValue < 0n ? -attoValue : attoValue
  const divisor = 10n ** BigInt(decimals)
  const whole = Number(abs / divisor)
  const frac = Number(abs % divisor) / Number(divisor)
  return `${sign}${(whole + frac).toLocaleString('en-US', {
    maximumFractionDigits: fractionDigits,
  })}`
}

function ActivityTable({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 border-b border-border/60 px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground sm:grid">
        <span>Type</span>
        <span>ALPH</span>
        <span>ABD</span>
        <span>ABX</span>
        <span>Tx</span>
      </div>
      <ul className="divide-y divide-border/40">
        {entries.map((e) => (
          <li
            key={e.txId}
            className="flex flex-col gap-2 px-5 py-3 text-sm sm:grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-center sm:gap-4"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{KIND_LABEL[e.kind]}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(e.timestamp).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <DeltaCell value={e.alphDelta} decimals={18} unit="ALPH" />
            <DeltaCell value={e.abdDelta} decimals={9} unit="ABD" />
            <DeltaCell value={e.abxDelta} decimals={9} unit="ABX" />
            <a
              href={explorerTxUrl(e.txId)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-primary underline-offset-4 hover:underline"
            >
              {e.txId.slice(0, 8)}…{e.txId.slice(-4)} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DeltaCell({
  value,
  decimals,
  unit,
}: {
  value: bigint
  decimals: number
  unit: string
}) {
  if (value === 0n) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const tone =
    value > 0n ? 'text-primary' : 'text-muted-foreground'
  return (
    <span className={cn('font-mono text-xs tabular-nums', tone)}>
      {formatDelta(value, decimals, decimals === 18 ? 4 : 2)}{' '}
      <span className="text-muted-foreground">{unit}</span>
    </span>
  )
}
