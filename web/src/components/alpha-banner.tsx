'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'

export function AlphaBanner() {
  return (
    <div
      role="alert"
      className="border-b border-destructive/40 bg-destructive/10 text-destructive"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-1.5 text-[11px] leading-tight">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          Independent open-source interface to the ABD stablecoin protocol
          deployed on Alephium. We did not author or deploy the contracts.
          Use at your own risk.{' '}
          <Link
            href="https://github.com/openabx/openabx/blob/main/RELEASE-CANDIDATE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            Details
          </Link>
        </p>
      </div>
    </div>
  )
}
