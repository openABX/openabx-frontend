'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getClientContext,
  resolveAddress,
  type ContractRole,
  type Network,
} from '@openabx/sdk'
import { NETWORK } from '@/lib/env'
import { cn } from '@/lib/utils'

interface RowProps {
  role: ContractRole
  label: string
  network: Network
}

function AddressRow({ role, label, network }: RowProps) {
  const address = resolveAddress(network, role)
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs">{address ?? '—'}</span>
    </div>
  )
}

interface RawContractState {
  immFields: Array<{ type: string; value: string }>
  mutFields: Array<{ type: string; value: string }>
}

/**
 * Raw node fetch bypassing the typed contract client. This works against any
 * field layout — useful when our clean-room ABD has 3 immFields but
 * AlphBanX's mainnet ABD has 4 (an extra URI-like ByteVec). The typed
 * client would throw on layout mismatch; this does not.
 */
async function fetchState(network: Network, address: string): Promise<RawContractState> {
  const ctx = getClientContext(network)
  // The node API type is node.ContractState; we only need imm/mut fields here.
  const state = await ctx.provider.contracts.getContractsAddressState(address)
  return {
    immFields: state.immFields as Array<{ type: string; value: string }>,
    mutFields: state.mutFields as Array<{ type: string; value: string }>,
  }
}

function hexBytesToUtf8(hex: string): string {
  try {
    return Buffer.from(hex, 'hex').toString('utf-8').replace(/\0/g, '')
  } catch {
    return hex
  }
}

function formatBigIntGrouped(n: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals)
  const whole = n / divisor
  const frac = n % divisor
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (frac === 0n) return wholeStr
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${wholeStr}.${fracStr}` : wholeStr
}

function FieldRow({ label, value }: { label: string; value: string | number | bigint }) {
  const valueStr = typeof value === 'string' ? value : value.toString()
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('font-mono', valueStr.length > 50 ? 'truncate text-xs' : '')}>
        {valueStr}
      </dd>
    </>
  )
}

function TokenState({
  label,
  network,
  role,
}: {
  label: string
  network: Network
  role: ContractRole
}) {
  const address = resolveAddress(network, role)
  const { data, isLoading, error } = useQuery({
    queryKey: ['token-state', network, role, address],
    enabled: !!address,
    staleTime: 30_000,
    queryFn: () => fetchState(network, address!),
  })

  if (!address) return <p className="text-sm text-muted-foreground">{label}: not deployed on {network}.</p>
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading {label} state…</p>
  if (error) return <p className="text-sm text-destructive">{label} error: {(error as Error).message}</p>
  if (!data) return null

  const symbol = hexBytesToUtf8(data.immFields[0]?.value ?? '')
  const name = hexBytesToUtf8(data.immFields[1]?.value ?? '')
  const decimalsRaw = data.immFields[2]?.value ?? '0'
  const decimals = Number(decimalsRaw)
  const authorityOrEmpty = data.mutFields[0]?.value ?? ''
  const authorityIsAddress = data.mutFields[0]?.type === 'Address'
  // Pinned mainnet layout (verified 2026-04-23): mut[0]=mintAuthority/admin
  // (Address), mut[1]=totalSupply (U256). OpenABX clean-room contracts use
  // the same layout. We pick mut[1] when mut[0] is an Address; otherwise
  // mut[0]. Sanity bound rejects implausible values rather than silently
  // displaying a misclassified slot.
  const totalSupplyField = authorityIsAddress ? data.mutFields[1] : data.mutFields[0]
  const rawSupply = totalSupplyField && totalSupplyField.type === 'U256'
    ? BigInt(totalSupplyField.value)
    : 0n
  const SANE_MAX = 1_000_000_000_000_000_000_000_000_000_000n // 1e30
  const supplyLooksSane = rawSupply >= 1n && rawSupply <= SANE_MAX
  const totalSupply = supplyLooksSane ? rawSupply : 0n

  return (
    <dl className="grid grid-cols-[12ch_1fr] gap-x-4 gap-y-1 text-sm">
      <FieldRow label="symbol" value={symbol} />
      <FieldRow label="name" value={name} />
      <FieldRow label="decimals" value={decimals} />
      <FieldRow
        label="totalSupply"
        value={
          supplyLooksSane
            ? `${formatBigIntGrouped(totalSupply, decimals)} ${symbol}`
            : `— (mut[1] looks implausible: ${rawSupply.toString()})`
        }
      />
      {authorityIsAddress ? (
        <FieldRow label="mintAuthority" value={authorityOrEmpty} />
      ) : null}
      <FieldRow label="raw imm fields" value={String(data.immFields.length)} />
      <FieldRow label="raw mut fields" value={String(data.mutFields.length)} />
    </dl>
  )
}

function OracleState({ network }: { network: Network }) {
  const address = resolveAddress(network, 'diaAlphPriceAdapter')
  const { data, isLoading, error } = useQuery({
    queryKey: ['oracle-price', network, address],
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      // Call the DIA adapter's methodIndex 1 (observed to return ALPH/USD at 1e18 scale
      // during Phase 0). For OpenABX-deployed adapters the indices align with our
      // Ralph source; for AlphBanX's mainnet adapter the observed index is the same.
      const ctx = getClientContext(network)
      const result = await ctx.provider.contracts.postContractsCallContract({
        group: 0,
        address: address!,
        methodIndex: 1,
      })
      if (result.type !== 'CallContractSucceeded' || !('returns' in result)) {
        throw new Error(`oracle call failed: ${JSON.stringify(result)}`)
      }
      const priceReturn = (result as { returns: Array<{ type: string; value: string }> }).returns[0]
      if (!priceReturn || priceReturn.type !== 'U256') {
        throw new Error('unexpected oracle return type')
      }
      return { priceRaw: BigInt(priceReturn.value) }
    },
  })

  if (!address)
    return <p className="text-sm text-muted-foreground">DIA oracle: not deployed on {network}.</p>
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading oracle…</p>
  if (error) return <p className="text-sm text-destructive">Oracle error: {(error as Error).message}</p>
  if (!data) return null

  const priceUsd = Number(data.priceRaw) / 1e18
  return (
    <dl className="grid grid-cols-[12ch_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">ALPH / USD</dt>
      <dd className="font-mono text-primary">${priceUsd.toFixed(6)}</dd>
      <FieldRow label="raw (1e18)" value={data.priceRaw.toString()} />
    </dl>
  )
}

function PlatformSettingsState({ network }: { network: Network }) {
  const address = resolveAddress(network, 'platformSettings')
  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-settings', network, address],
    enabled: !!address,
    staleTime: 60_000,
    queryFn: () => fetchState(network, address!),
  })

  if (!address)
    return <p className="text-sm text-muted-foreground">PlatformSettings: not deployed on {network}.</p>
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading settings…</p>
  if (error) return <p className="text-sm text-destructive">Settings error: {(error as Error).message}</p>
  if (!data) return null

  const admin = data.mutFields.find((f) => f.type === 'Address')?.value ?? '—'
  return (
    <dl className="grid grid-cols-[12ch_1fr] gap-x-4 gap-y-1 text-sm">
      <FieldRow label="admin" value={admin} />
      <FieldRow
        label="mut fields"
        value={`${data.mutFields.length} (${data.mutFields.filter((f) => f.type === 'ByteVec').length} refs)`}
      />
    </dl>
  )
}

export function LiveState() {
  const network = NETWORK

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Addresses ({network})
        </h2>
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-2">
          <AddressRow role="abdToken" label="ABD" network={network} />
          <AddressRow role="abxToken" label="ABX" network={network} />
          <AddressRow role="loanManager" label="LoanManager" network={network} />
          <AddressRow role="auctionManager" label="AuctionManager" network={network} />
          <AddressRow role="diaAlphPriceAdapter" label="DIA Adapter" network={network} />
          <AddressRow role="abdPriceOracle" label="ABD Oracle" network={network} />
          <AddressRow role="circuitBreaker" label="CircuitBreaker" network={network} />
          <AddressRow role="platformSettings" label="PlatformSettings" network={network} />
          <AddressRow role="admin" label="Admin EOA" network={network} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          ABD token (live)
        </h2>
        <TokenState label="ABD" network={network} role="abdToken" />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          ABX token (live)
        </h2>
        <TokenState label="ABX" network={network} role="abxToken" />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          DIA ALPH price (live, refetches every 30 s)
        </h2>
        <OracleState network={network} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          PlatformSettings (live)
        </h2>
        <PlatformSettingsState network={network} />
      </section>
    </div>
  )
}
