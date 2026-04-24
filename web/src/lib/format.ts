// Shared amount/number formatters. Contract amounts are atto-scaled bigints
// (ABD = 1e9, ABX = 1e9, ALPH = 1e18). UI displays use human-readable decimals.

export const ALPH_DECIMALS = 18
export const ABD_DECIMALS = 9
export const ABX_DECIMALS = 9
export const PRICE_DECIMALS = 18

export const ALPH_SCALE = 10n ** BigInt(ALPH_DECIMALS)
export const ABD_SCALE = 10n ** BigInt(ABD_DECIMALS)
export const ABX_SCALE = 10n ** BigInt(ABX_DECIMALS)
export const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS)

export function bigintToNumber(v: bigint, decimals: number): number {
  const scale = 10n ** BigInt(decimals)
  const whole = v / scale
  const frac = v % scale
  return Number(whole) + Number(frac) / Number(scale)
}

export function numberToBigint(v: number, decimals: number): bigint {
  if (!Number.isFinite(v) || v < 0) return 0n
  // Use toFixed+string parsing to avoid float precision loss on small values.
  const s = v.toFixed(decimals)
  const [wholeStr, fracStr = ''] = s.split('.')
  const padded = (fracStr + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(wholeStr!) * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

export function formatAmount(
  v: bigint | null | undefined,
  decimals: number,
  displayDecimals = 4,
): string {
  if (v === null || v === undefined) return '—'
  const n = bigintToNumber(v, decimals)
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  })
}

export function formatUsd(n: number | null | undefined, displayDecimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: displayDecimals,
    maximumFractionDigits: displayDecimals,
  })
}

export function shortAddress(addr: string | null | undefined, head = 6, tail = 4): string {
  if (!addr) return '—'
  if (addr.length <= head + tail + 3) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}
