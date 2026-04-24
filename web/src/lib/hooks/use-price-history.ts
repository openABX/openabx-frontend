'use client'

// Keeps a rolling window of ALPH/USD readings in localStorage so the
// sparkline on the dashboard has historical context across page reloads.
// Every render that sees a new price from `useProtocolGlobals` appends a
// sample. Samples older than 24 h or exceeding 240 entries are trimmed.

import { useEffect, useState } from 'react'
import { useProtocolGlobals } from '@/lib/hooks'
import { bigintToNumber } from '@/lib/format'

const STORAGE_KEY = 'openabx:alph-usd-history'
const MAX_SAMPLES = 240
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Sample {
  t: number
  p: number
}

function trim(samples: Sample[]): Sample[] {
  const cutoff = Date.now() - MAX_AGE_MS
  return samples
    .filter(
      (s) =>
        s &&
        typeof s.t === 'number' &&
        typeof s.p === 'number' &&
        Number.isFinite(s.p) &&
        s.t >= cutoff,
    )
    .slice(-MAX_SAMPLES)
}

function loadHistory(): Sample[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Sample[]
    if (!Array.isArray(arr)) return []
    return trim(arr)
  } catch {
    return []
  }
}

function saveHistory(samples: Sample[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
  } catch {
    /* quota / privacy mode — swallow */
  }
}

export function usePriceHistory(): {
  samples: Sample[]
  latest: number | null
  change24h: number | null
} {
  const { data: globals } = useProtocolGlobals()
  const price = globals?.alphUsd1e18
    ? bigintToNumber(globals.alphUsd1e18, 18)
    : null
  // Initial state MUST be identical on server and first client render to
  // avoid hydration mismatch. We hydrate from localStorage only after
  // mount, in the effect below.
  const [samples, setSamples] = useState<Sample[]>([])

  // One-shot rehydration from localStorage after mount.
  useEffect(() => {
    const saved = loadHistory()
    if (saved.length > 0) {
      setSamples(saved)
    }
  }, [])

  useEffect(() => {
    if (price == null || !Number.isFinite(price)) return
    setSamples((cur) => {
      const last = cur[cur.length - 1]
      // dedup: ignore if same price within a 15 s window
      if (last && Date.now() - last.t < 15_000 && last.p === price) return cur
      const next = trim([...cur, { t: Date.now(), p: price }])
      saveHistory(next)
      return next
    })
  }, [price])

  const change24h =
    samples.length >= 2 && price != null
      ? ((price - samples[0]!.p) / samples[0]!.p) * 100
      : null

  return { samples, latest: price, change24h }
}
