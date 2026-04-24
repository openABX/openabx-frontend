'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NetworkBadge } from '@/components/network-badge'
import { WalletButton } from '@/components/wallet-button'
import { cn } from '@/lib/utils'

const SECTIONS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Dashboard' },
  { href: '/borrow', label: 'Borrow' },
  { href: '/auction', label: 'Auction' },
  { href: '/stake', label: 'Stake' },
  { href: '/redeem', label: 'Redeem' },
  { href: '/liquidate', label: 'Liquidate' },
  { href: '/vesting', label: 'Vesting' },
]

export function TopNav() {
  const pathname = usePathname()
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Logo />
          <span>
            open<span className="text-primary">ABX</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => {
            const active =
              s.href === '/' ? pathname === '/' : pathname.startsWith(s.href)
            return (
              <Link
                key={s.href}
                href={s.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {s.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <NetworkBadge />
          <WalletButton />
        </div>
      </div>

      {/* Mobile nav scroller */}
      <nav className="flex gap-1 overflow-x-auto border-t border-border/40 px-4 py-2 md:hidden">
        {SECTIONS.map((s) => {
          const active =
            s.href === '/' ? pathname === '/' : pathname.startsWith(s.href)
          return (
            <Link
              key={s.href}
              href={s.href}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}

function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="openabx-logo" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(200 90% 60%)" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="8"
        fill="url(#openabx-logo)"
        opacity="0.15"
      />
      <path
        d="M9 22 L16 7 L23 22 M12 17 H20"
        stroke="url(#openabx-logo)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
