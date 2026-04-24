'use client'

// Shared transaction-submit hook. Every write button on every page funnels
// through runTx() — gets consistent simulation-error translation,
// submit-phase UX, tx-confirmation polling, React-Query invalidation, AND
// mandatory once-per-session consent on mainnet.

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NETWORK } from '@/lib/env'
import { translateTxError } from '@/lib/tx-errors'
import { pollTxStatus, type TxStatus } from '@/lib/tx-status'
import {
  useUnauditedConsent,
  type ConsentApi,
} from '@/components/unaudited-consent-gate'

export type TxRunnerState =
  | { kind: 'idle' }
  | { kind: 'simulating' }
  | { kind: 'awaitingSign' }
  | { kind: 'submitted'; txId: string }
  | { kind: 'confirming'; txId: string; confirmations?: number }
  | { kind: 'confirmed'; txId: string }
  | { kind: 'error'; message: string }

export interface TxRunnerApi {
  state: TxRunnerState
  /** Execute an action that returns a `{txId: string}` promise. On mainnet
   * this gates through unaudited-consent first (once per session). */
  runTx: (action: () => Promise<{ txId: string }>) => Promise<void>
  reset: () => void
  /** Consent API. Render `<ConsentModal {...consent} />` somewhere in the
   * tree that hosts `useTxRunner` — typically the same component. */
  consent: ConsentApi
}

export function useTxRunner(): TxRunnerApi {
  const [state, setState] = useState<TxRunnerState>({ kind: 'idle' })
  const qc = useQueryClient()
  const consent = useUnauditedConsent()

  const execute = useCallback(
    async (action: () => Promise<{ txId: string }>) => {
      setState({ kind: 'awaitingSign' })
      let txId: string
      try {
        const res = await action()
        txId = res.txId
      } catch (err) {
        const message = translateTxError((err as Error).message)
        setState({ kind: 'error', message })
        return
      }
      setState({ kind: 'submitted', txId })

      pollTxStatus(NETWORK, txId, {
        onUpdate: (s: TxStatus) => {
          if (s.kind === 'confirmed') {
            setState({ kind: 'confirmed', txId })
            qc.invalidateQueries({ queryKey: ['position'] })
            qc.invalidateQueries({ queryKey: ['globals'] })
          } else if (s.kind === 'mempool' || s.kind === 'unconfirmed') {
            setState((cur) =>
              cur.kind === 'confirmed' || cur.kind === 'error'
                ? cur
                : {
                    kind: 'confirming',
                    txId,
                    confirmations: s.confirmations,
                  },
            )
          }
        },
      }).catch(() => {
        /* ignore */
      })
    },
    [qc],
  )

  const runTx = useCallback(
    async (action: () => Promise<{ txId: string }>) => {
      if (NETWORK !== 'mainnet' || consent.granted) {
        await execute(action)
        return
      }
      // Open the consent modal; queued action fires on confirmation.
      consent.withConsent(() => execute(action))
    },
    [consent, execute],
  )

  const reset = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, runTx, reset, consent }
}
