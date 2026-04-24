'use client'

import { AlertTriangle } from 'lucide-react'
import { NETWORK } from '@/lib/env'
import { cn } from '@/lib/utils'

export type PageFeature =
  | 'dashboard'
  | 'borrow'
  | 'auction'
  | 'stake'
  | 'vesting'
  | 'redeem'
  | 'liquidate'

interface PageStatus {
  tone: 'danger' | 'warning' | 'info'
  headline: string
  details: string
}

function statusFor(feature: PageFeature): PageStatus | null {
  const isMainnet = NETWORK === 'mainnet'

  // Unaudited-contracts message is common to every devnet/testnet page.
  const unauditedBase =
    'OpenABX’s own clean-room contracts are unaudited. A self-administered ' +
    'red team found 91 findings, 19 Critical; 8 Criticals remain open ' +
    '(see audit/00-RED-TEAM-SUMMARY.md). Do NOT use with real funds.'

  switch (feature) {
    case 'dashboard':
      return isMainnet
        ? null
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — devnet/testnet only.',
            details: unauditedBase,
          }
    case 'borrow':
      return isMainnet
        ? null
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — unsafe for real funds.',
            details: unauditedBase,
          }
    case 'auction':
      return isMainnet
        ? null
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — unsafe for real funds.',
            details:
              unauditedBase +
              ' AuctionPool carries Critical findings M-02/M-03 (snapshot-rebase bugs silently zero pending ALPH rewards).',
          }
    case 'stake':
      return isMainnet
        ? null
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — unsafe for real funds.',
            details:
              unauditedBase +
              ' StakeManager carries Critical findings M-04/M-05 (snapshot-rebase zeroing).',
          }
    case 'vesting':
      return isMainnet
        ? {
            tone: 'warning',
            headline: 'Vesting not live on mainnet.',
            details:
              'Probed all four candidate mainnet contracts 2026-04-24 — none have Vesting-shaped state. This page will light up automatically once a mainnet Vesting contract appears on-chain.',
          }
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — unsafe for real funds.',
            details: unauditedBase,
          }
    case 'redeem':
      return isMainnet
        ? null
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — unsafe for real funds.',
            details:
              unauditedBase +
              ' Redeem path gates on A-03 audit finding (callerAddress! returns wrong context) — still open.',
          }
    case 'liquidate':
      return isMainnet
        ? {
            tone: 'warning',
            headline: 'Mainnet liquidation wiring pending.',
            details:
              'LoanManager.liquidate() method index not yet confirmed. Keepers must use their own tooling until this lands.',
          }
        : {
            tone: 'danger',
            headline: 'Pre-audit alpha — unsafe for real funds.',
            details:
              unauditedBase +
              ' Liquidation path carries Critical finding O-04 (bad-debt loans permanently un-liquidatable).',
          }
  }
}

const TONE_CLASSES: Record<PageStatus['tone'], string> = {
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-primary/40 bg-primary/10 text-primary',
}

export function PageStatusBanner({ feature }: { feature: PageFeature }) {
  const status = statusFor(feature)
  if (!status) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-sm',
        TONE_CLASSES[status.tone],
      )}
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="font-medium leading-tight">{status.headline}</p>
        <p className="text-xs leading-relaxed opacity-90">{status.details}</p>
      </div>
    </div>
  )
}
