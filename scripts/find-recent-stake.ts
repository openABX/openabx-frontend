#!/usr/bin/env tsx
/**
 * Scan for recent stake transactions on the ABX token. Reports every contract
 * address touched by ABX-token-involving transactions in the last N minutes,
 * and decodes each tx's TxScript to extract (contractAddress, methodIndex)
 * pairs. Used to identify AlphBanX's mainnet StakeManager address by
 * observing a real user stake tx the moment it lands.
 *
 * Run: pnpm tsx scripts/find-recent-stake.ts [minutesBack]
 */

import {
  binToHex,
  codec,
  contractIdFromAddress,
  addressFromContractId,
  hexToBinUnsafe,
} from '@alephium/web3'

const BACKEND_URL = 'https://backend.mainnet.alephium.org'
const ABX_TOKEN = '258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV'
const scriptCodec = codec.script.scriptCodec

const KNOWN: Record<string, string> = {
  '288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K': 'abdToken',
  '258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV': 'abxToken',
  tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB: 'loanManager',
  '29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3': 'auctionManager',
  '21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf': 'platformSettings',
  '2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7': 'diaAlphPriceAdapter',
  '28Nju5bkxygKQp3SEw29jELwgTL4zpJZjwXNgaUzU3otT': 'abdPriceOracle',
  '28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF': 'borrowerOperations',
  '28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu': 'router-or-bo2',
  '211mQVddZ3SEv5dZu33E9RAvDFDKPkZdZUkJp6eMEHUxo': 'seen-in-loan-scripts',
}

interface ExplorerTx {
  hash: string
  timestamp: number
  scriptOpt?: string
  inputs?: Array<{ address?: string; contractInput: boolean }>
  outputs?: Array<{ type: string; address: string }>
}

async function fetchRecentTxs(address: string, limit = 50): Promise<ExplorerTx[]> {
  const url = `${BACKEND_URL}/addresses/${address}/transactions?page=1&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} — HTTP ${res.status}`)
  return (await res.json()) as ExplorerTx[]
}

async function main(): Promise<void> {
  const minutesBack = Number(process.argv[2]) || 30
  const cutoff = Date.now() - minutesBack * 60_000
  console.log(
    `Scanning ABX-token-touching txs from the last ${minutesBack} min (>=${new Date(
      cutoff,
    ).toISOString()})`,
  )

  const txs = await fetchRecentTxs(ABX_TOKEN, 100)
  const recent = txs.filter((t) => t.timestamp >= cutoff)
  console.log(`  total returned=${txs.length}  within window=${recent.length}`)

  if (recent.length === 0) {
    console.log(
      `  no recent ABX txs. most-recent in result: ${new Date(txs[0]?.timestamp ?? 0).toISOString()}`,
    )
    console.log(`  Hint: the explorer-backend /addresses/<abxToken>/transactions`)
    console.log(`        endpoint returns txs where ABX is the INPUT ADDRESS, not`)
    console.log(`        where the ABX token was TRANSFERRED. Your stake moved`)
    console.log(`        ABX from your wallet to StakeManager — it's keyed on your`)
    console.log(`        wallet, not on the token. Re-run with your wallet`)
    console.log(`        address:  pnpm tsx scripts/find-recent-stake.ts 30 <wallet>`)
    const wallet = process.argv[3]
    if (wallet) {
      console.log(`\n  ↪ Re-scanning wallet ${wallet}…`)
      const walletTxs = await fetchRecentTxs(wallet, 30)
      const rec2 = walletTxs.filter((t) => t.timestamp >= cutoff)
      console.log(`  wallet total=${walletTxs.length}  within window=${rec2.length}`)
      for (const t of rec2) analyze(t)
    }
    return
  }

  for (const t of recent) analyze(t)
}

function analyze(t: ExplorerTx): void {
  console.log(
    `\n- tx ${t.hash.slice(0, 16)}… @ ${new Date(t.timestamp).toISOString()}`,
  )
  // Contracts touched as inputs
  const contractInputs =
    t.inputs?.filter((i) => i.contractInput).map((i) => i.address!) ?? []
  const uniqContracts = [...new Set(contractInputs)]
  console.log(`  contracts touched as inputs:`)
  for (const addr of uniqContracts) {
    const id = addr ? labelFor(addr) : '???'
    console.log(`    ${addr}  ${id}`)
  }
  // Decode the script
  if (!t.scriptOpt) {
    console.log(`  (no scriptOpt)`)
    return
  }
  try {
    const bytes = hexToBinUnsafe(t.scriptOpt)
    const script = scriptCodec.decode(bytes)
    for (const [i, m] of script.methods.entries()) {
      console.log(`  method ${i}:`)
      let lastBytes: string | null = null
      for (const ins of m.instrs) {
        if (ins.name === 'BytesConst') {
          const v = (ins as any).value as Uint8Array | string
          lastBytes =
            v instanceof Uint8Array ? binToHex(v) : (v as string)
        } else if (ins.name === 'CallExternal') {
          const callIndex = (ins as any).index
          if (lastBytes && lastBytes.length === 64) {
            try {
              const addr = addressFromContractId(lastBytes)
              const label = labelFor(addr)
              console.log(
                `    → CallExternal[${callIndex}] on ${addr}  ${label}`,
              )
            } catch {
              console.log(
                `    → CallExternal[${callIndex}] on id=${lastBytes}`,
              )
            }
          } else {
            console.log(`    → CallExternal[${callIndex}] (target unresolved)`)
          }
          lastBytes = null
        }
      }
    }
  } catch (err) {
    console.log(`  decode failed: ${(err as Error).message}`)
  }
}

function labelFor(addr: string): string {
  const known = KNOWN[addr]
  if (known) return `(${known})`
  return '⟵ UNKNOWN — candidate StakeManager / Vesting'
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
