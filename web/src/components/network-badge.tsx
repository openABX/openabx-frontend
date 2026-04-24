'use client'

import { NETWORK } from '@/lib/env'
import { cn } from '@/lib/utils'

const COLORS: Record<typeof NETWORK, { classes: string; dot: string }> = {
  devnet: {
    classes: 'border-slate-500/40 bg-slate-500/10 text-slate-200',
    dot: 'bg-slate-400',
  },
  testnet: {
    classes: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  mainnet: {
    classes: 'border-primary/40 bg-primary/10 text-primary',
    dot: 'bg-primary animate-pulse',
  },
}

export function NetworkBadge({ className }: { className?: string }) {
  const c = COLORS[NETWORK]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        c.classes,
        className,
      )}
      data-testid="network-badge"
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} aria-hidden="true" />
      {NETWORK}
    </span>
  )
}
