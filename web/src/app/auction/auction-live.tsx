'use client'

import { useEffect, useState } from 'react'
import { getNetworkConfig, resolveAddress } from '@openabx/sdk'
import { NETWORK } from '@/lib/env'
import { usePoolsTvl } from '@/lib/hooks/use-pools-tvl'
import { explorerAddressUrl } from '@/lib/validation'
import { cn } from '@/lib/utils'

// Protocol-spec §2: four tiers, tiered bid-success fee, flat 0.5 % close fee.
const TIERS = [
  { discount: 5, feeBps: 50, badgeClass: 'bg-green-600 text-white' },
  { discount: 10, feeBps: 100, badgeClass: 'bg-emerald-500 text-white' },
  { discount: 15, feeBps: 150, badgeClass: 'bg-amber-500 text-white' },
  { discount: 20, feeBps: 200, badgeClass: 'bg-orange-500 text-white' },
] as const

const ABD_SCALE = 1_000_000_000
const PRECISION = 1_000_000_000_000_000_000

interface NodeState {
  immFields: Array<{ type: string; value: string }>
  mutFields: Array<{ type: string; value: string }>
}

interface PoolSnapshot {
  totalPoolsAbdHuman: number | null
  priceUsdPerAlph: number | null
  error: string | null
}

/**
 * Fetches three bits of live state:
 *   - AuctionManager's aggregate ABD TVL (mutField index 5 on mainnet, per
 *     Phase 0 observation).
 *   - DIA oracle price (methodIndex 1 on the adapter).
 * Returns `null`s + error string if either call fails; the UI handles that.
 */
function useAuctionSnapshot(refreshMs = 30_000): PoolSnapshot {
  const auctionManagerAddr = resolveAddress(NETWORK, 'auctionManager')
  const oracleAddr = resolveAddress(NETWORK, 'diaAlphPriceAdapter')
  const nodeUrl = getNetworkConfig(NETWORK).nodeUrl

  const [state, setState] = useState<PoolSnapshot>({
    totalPoolsAbdHuman: null,
    priceUsdPerAlph: null,
    error: null,
  })

  useEffect(() => {
    if (!auctionManagerAddr || !oracleAddr) {
      setState({
        totalPoolsAbdHuman: null,
        priceUsdPerAlph: null,
        error: `AuctionManager not deployed on ${NETWORK}`,
      })
      return
    }
    let cancelled = false

    async function fetchOnce(): Promise<void> {
      try {
        const [amRes, oracleRes] = await Promise.all([
          fetch(`${nodeUrl}/contracts/${auctionManagerAddr}/state`),
          fetch(`${nodeUrl}/contracts/call-contract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group: 0, address: oracleAddr, methodIndex: 1 }),
          }),
        ])
        if (!amRes.ok) throw new Error(`AuctionManager HTTP ${amRes.status}`)
        if (!oracleRes.ok) throw new Error(`oracle HTTP ${oracleRes.status}`)
        const am = (await amRes.json()) as NodeState
        const oracle = (await oracleRes.json()) as {
          type: string
          returns?: Array<{ type: string; value: string }>
        }

        // Identify the aggregate-ABD mutField. AuctionManager's state has
        // several U256 fields including fee percentages (at 1e18 scale),
        // the ABD TVL (at 1e9 scale), and multiple compound snapshot
        // factors. On mainnet we use the pinned mut[5] index (verified
        // 2026-04-23 by direct on-chain inspection of the AlphBanX
        // AuctionManager state). Off-mainnet, AuctionManager isn't deployed
        // (testnet ships only the GitBook addresses; devnet ships our
        // clean-room contracts whose layout we own and which currently
        // returns null until pnpm deploy:devnet runs).
        let aggregate = 0n
        if (NETWORK === 'mainnet') {
          const slot = am.mutFields[5]
          if (slot && slot.type === 'U256') {
            aggregate = BigInt(slot.value)
          }
        } else {
          // Defensive heuristic for non-mainnet so this code keeps working
          // when devnet exists; same shape as before but now clearly scoped.
          const MIN_TVL_ATTO = 100_000_000_000n
          const MAX_TVL_ATTO = 1_000_000_000_000_000_000n
          const FEE_VALUES = new Set([
            5_000_000_000_000_000n,
            10_000_000_000_000_000n,
            15_000_000_000_000_000n,
            20_000_000_000_000_000n,
          ])
          const u256Muts = am.mutFields
            .filter((f) => f.type === 'U256')
            .map((f) => BigInt(f.value))
          const candidates = u256Muts.filter(
            (v) => v >= MIN_TVL_ATTO && v < MAX_TVL_ATTO && !FEE_VALUES.has(v),
          )
          aggregate = candidates.reduce((acc, v) => (v > acc ? v : acc), 0n)
        }

        const oraclePrice =
          oracle.type === 'CallContractSucceeded' && oracle.returns?.[0]?.type === 'U256'
            ? Number(BigInt(oracle.returns[0].value)) / PRECISION
            : null

        if (!cancelled) {
          setState({
            totalPoolsAbdHuman: Number(aggregate) / ABD_SCALE,
            priceUsdPerAlph: oraclePrice,
            error: null,
          })
        }
      } catch (err) {
        if (!cancelled)
          setState((prev) => ({ ...prev, error: (err as Error).message }))
      }
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [auctionManagerAddr, oracleAddr, nodeUrl, refreshMs])

  return state
}

export function AuctionLive() {
  const { totalPoolsAbdHuman, priceUsdPerAlph, error } = useAuctionSnapshot()
  const auctionManagerAddr = resolveAddress(NETWORK, 'auctionManager')

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Total ABD in pools
          </p>
          <p className="mt-2 font-mono text-2xl">
            {totalPoolsAbdHuman != null
              ? totalPoolsAbdHuman.toLocaleString('en-US', { maximumFractionDigits: 2 })
              : '—'}
            <span className="ml-1 text-sm text-muted-foreground">ABD</span>
          </p>
          {totalPoolsAbdHuman != null && (
            <p className="text-xs text-muted-foreground">
              ≈ $
              {totalPoolsAbdHuman.toLocaleString('en-US', {
                maximumFractionDigits: 2,
              })}{' '}
              USD <span className="opacity-60">(if ABD on peg)</span>
            </p>
          )}
        </div>

        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            ALPH / USD
          </p>
          <p className="mt-2 font-mono text-2xl text-primary">
            {priceUsdPerAlph != null ? `$${priceUsdPerAlph.toFixed(6)}` : '—'}
          </p>
          <p className="text-xs text-muted-foreground">via DIA xMarket, 30 s refresh</p>
        </div>

        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            AuctionManager
          </p>
          <p className="mt-2 truncate font-mono text-xs">{auctionManagerAddr ?? '—'}</p>
          {auctionManagerAddr && NETWORK === 'mainnet' && (
            <a
              href={explorerAddressUrl(auctionManagerAddr)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              Explorer ↗
            </a>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {error}
        </div>
      )}

      <PerTierCards />
    </div>
  )
}

function PerTierCards() {
  const { data: tvlByTier } = usePoolsTvl()
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {TIERS.map((tier) => {
        const t = tvlByTier?.find((x) => x.tierBps === tier.discount * 100)
        const tvlAbd = t ? Number(t.totalAbdAtto) / 1e9 : null
        return (
          <div
            key={tier.discount}
            className="card flex flex-col gap-3 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{tier.discount}% discount</h3>
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium',
                  tier.badgeClass,
                )}
              >
                Pool {tier.discount}
              </span>
            </div>
            <div className="rounded-md border border-border/50 bg-[hsl(var(--surface-2))] p-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">TVL</span>
                <span className="font-mono">
                  {tvlAbd != null
                    ? `${tvlAbd.toLocaleString('en-US', { maximumFractionDigits: 0 })} ABD`
                    : '—'}
                </span>
              </div>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Bid-success fee</dt>
                <dd className="font-mono">{(tier.feeBps / 100).toFixed(1)}%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Close-bid fee</dt>
                <dd className="font-mono">0.5%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority</dt>
                <dd className="font-mono">
                  {tier.discount === 5 ? 'First' : tier.discount === 20 ? 'Last' : 'Mid'}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Every 1 ABD deposited → {(1 + tier.discount / 100).toFixed(2)}{' '}
              USD of ALPH at liquidation time, minus the bid-success fee.
            </p>
          </div>
        )
      })}
    </section>
  )
}
