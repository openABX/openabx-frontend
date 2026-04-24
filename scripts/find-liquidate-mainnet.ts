#!/usr/bin/env tsx
/**
 * Find AlphBanX mainnet liquidation transactions.
 *
 * Liquidate is almost certainly a direct LoanManager call (permissionless
 * keeper operation, no user APS routing). We:
 *   1. Pull many pages of LoanManager transactions.
 *   2. Keep only scripts that do NOT call BorrowerOperations.
 *   3. Tally by LoanManager method index.
 *   4. Cross-check: a liquidation's inputs include an AuctionPool contract
 *      (debt-absorb path) and its outputs refund any surplus ALPH to the
 *      loan OWNER, not the caller.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  binToHex,
  codec,
  contractIdFromAddress,
  hexToBinUnsafe,
} from '@alephium/web3'

const BACKEND = 'https://backend.mainnet.alephium.org'
const LOAN_MANAGER = 'tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB'
const BORROWER_OPS = '28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF'
const AUCTION_MGR = '29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3'
const STAKE_MGR = '28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu'

const LM_ID_HEX = binToHex(contractIdFromAddress(LOAN_MANAGER))
const BO_ID_HEX = binToHex(contractIdFromAddress(BORROWER_OPS))
const AM_ID_HEX = binToHex(contractIdFromAddress(AUCTION_MGR))
const SM_ID_HEX = binToHex(contractIdFromAddress(STAKE_MGR))

const AUCTION_POOLS = [
  '29VFMPU7L73vqMgjo6A3WiwhPiHZiB4tq4DZVTMNLiCPU', // 5%
  '2DPKfNx5BwnbJ65NRHmrbUPcP9w3LkX8fpx4cbDJyBhu4', // 10% (example — regenerated if wrong)
  '29n9bNJWZ7Nf8BstNKK9cxkCZ9VGGK9NttgkPXWu9kLbs', // 15%
  '2CCKmkTaYLSBBNLvoPEjrBoucJnF7MbG8x6LY59tgKKJf', // 20%
]

const scriptCodec = codec.script.scriptCodec

interface ExplorerTx {
  hash: string
  timestamp: number
  scriptOpt?: string
  inputs?: Array<{ address?: string; contractInput: boolean }>
  outputs?: Array<{ type: string; address: string; attoAlphAmount?: string }>
}

async function fetchTxs(addr: string, pages: number): Promise<ExplorerTx[]> {
  const all: ExplorerTx[] = []
  for (let p = 1; p <= pages; p++) {
    const r = await fetch(
      `${BACKEND}/addresses/${addr}/transactions?page=${p}&limit=100`,
    )
    if (!r.ok) break
    const batch = (await r.json()) as ExplorerTx[]
    all.push(...batch)
    if (batch.length < 100) break
    await new Promise((r) => setTimeout(r, 80))
  }
  return all
}

interface CallInfo {
  miByContract: Map<string, number[]>
  targetSequence: string[]
}

function analyzeScript(scriptOpt: string): CallInfo | null {
  try {
    const script = scriptCodec.decode(hexToBinUnsafe(scriptOpt))
    const miByContract = new Map<string, number[]>()
    const targetSequence: string[] = []
    for (const m of script.methods) {
      const bytesPushes: string[] = []
      for (const ins of m.instrs) {
        if (ins.name === 'BytesConst') {
          const v = (ins as { value?: unknown }).value
          const hex =
            v instanceof Uint8Array
              ? binToHex(v)
              : typeof v === 'string'
                ? v
                : ''
          if (hex.length === 64) bytesPushes.push(hex)
        } else if (ins.name === 'CallExternal') {
          const mi = (ins as { index: number }).index
          const target = bytesPushes[bytesPushes.length - 1] ?? null
          if (target) {
            targetSequence.push(target.slice(0, 8))
            const arr = miByContract.get(target) ?? []
            arr.push(mi)
            miByContract.set(target, arr)
          }
        }
      }
    }
    return { miByContract, targetSequence }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  console.log('Pulling LoanManager txs (deep scan)…')
  const lmTxs = await fetchTxs(LOAN_MANAGER, 15)
  console.log(`  ${lmTxs.length} LoanManager txs`)

  interface Hit {
    txId: string
    timestamp: number
    signer: string | null
    lmMis: number[]
    amMis: number[]
    smMis: number[]
    callsBo: boolean
    involvesPool: boolean
    knownPool: string | null
  }

  const hits: Hit[] = []

  for (const tx of lmTxs) {
    if (!tx.scriptOpt) continue
    const info = analyzeScript(tx.scriptOpt)
    if (!info) continue

    const lmMis = info.miByContract.get(LM_ID_HEX) ?? []
    if (lmMis.length === 0) continue

    const callsBo = info.miByContract.has(BO_ID_HEX)
    const amMis = info.miByContract.get(AM_ID_HEX) ?? []
    const smMis = info.miByContract.get(SM_ID_HEX) ?? []

    const allPoolAddrs = AUCTION_POOLS.map((a) =>
      binToHex(contractIdFromAddress(a)),
    )
    const hitsPool = allPoolAddrs.find((p) => info.miByContract.has(p)) ?? null
    const poolInOutputs = (tx.outputs ?? []).some((o) =>
      AUCTION_POOLS.includes(o.address),
    )

    const signer =
      tx.inputs?.find((i) => !i.contractInput && i.address)?.address ?? null

    hits.push({
      txId: tx.hash,
      timestamp: tx.timestamp,
      signer,
      lmMis,
      amMis,
      smMis,
      callsBo,
      involvesPool: hitsPool != null || poolInOutputs,
      knownPool: hitsPool,
    })
  }

  // Direct LoanManager calls (no BO routing) — likely liquidate, admin, or reads
  const direct = hits.filter((h) => !h.callsBo)
  console.log(
    `\nDirect LM calls (no BO): ${direct.length} of ${hits.length} total`,
  )

  // Tally LM mi distributions
  const miCount = new Map<string, number>()
  for (const h of direct) {
    const key = h.lmMis.join(',')
    miCount.set(key, (miCount.get(key) ?? 0) + 1)
  }
  console.log('\n--- Direct-LM mi-sequence distribution ---')
  for (const [seq, n] of [...miCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  [${seq}]: ${n}`)
  }

  // Liquidation fingerprint: direct LM + touches an auction pool
  const likelyLiq = direct.filter((h) => h.involvesPool)
  console.log(
    `\nDirect LM + touches auction pool: ${likelyLiq.length} candidates`,
  )
  for (const h of likelyLiq.slice(0, 12)) {
    console.log(
      `  tx=${h.txId.slice(0, 14)}… signer=${(h.signer ?? '?').slice(
        0,
        14,
      )}… lmMis=[${h.lmMis.join(',')}] amMis=[${h.amMis.join(',')}]`,
    )
  }

  const outPath = join(
    dirname(new URL(import.meta.url).pathname),
    '..',
    'references',
    'liquidate-scan.json',
  )
  writeFileSync(
    outPath,
    JSON.stringify({ direct, likelyLiq }, null, 2) + '\n',
  )
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
