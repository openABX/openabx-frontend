// Observed method-index signatures for AlphBanX's mainnet contracts.
//
// These are NOT derived from reading the AlphBanX Ralph source (forbidden by
// the clean-room policy). Every entry below was observed in Phase 0 by calling
// POST /contracts/call-contract against the live mainnet node and recording
// the response shape.
//
// Phase 0.5 decision (docs/02-execution-plan.md): we ship a separate ABI for
// mainnet rather than trying to make our Ralph implementation byte-compatible
// with AlphBanX's method ordering. This file grows as Phase 6 discovers new
// methods it needs to call.

export interface MainnetMethod {
  readonly role: string
  readonly address: string
  readonly methodIndex: number
  readonly returnType: string
  readonly label: string
  readonly observedAt: string
  readonly notes?: string
}

export const ALPHBANX_MAINNET_METHODS: readonly MainnetMethod[] = [
  {
    role: 'loanManager',
    address: 'tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB',
    methodIndex: 0,
    returnType: 'ByteVec',
    label: 'getContractName',
    observedAt: '2026-04-22',
    notes: 'Returns hex of "LoanManager".',
  },
  {
    role: 'auctionManager',
    address: '29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3',
    methodIndex: 0,
    returnType: 'ByteVec',
    label: 'getContractName',
    observedAt: '2026-04-22',
    notes: 'Returns hex of "AuctionManager".',
  },
  {
    role: 'diaAlphPriceAdapter',
    address: '2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7',
    methodIndex: 0,
    returnType: 'U256',
    label: 'unknownInverse',
    observedAt: '2026-04-22',
    notes: 'Returned 20206236978343157268; scaling TBD.',
  },
  {
    role: 'diaAlphPriceAdapter',
    address: '2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7',
    methodIndex: 1,
    returnType: 'U256',
    label: 'getAlphUsdPrice',
    observedAt: '2026-04-22',
    notes: 'Returned 49489670000000000 = $0.04949 at 1e18 scale; matches app dashboard.',
  },
  {
    role: 'platformSettings',
    address: '21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf',
    methodIndex: 0,
    returnType: 'Address',
    label: 'getAdmin',
    observedAt: '2026-04-22',
    notes: 'Returned 1Fcq1KfXTVj3EyxncDgTmtrQzDWGWF5sXKojXZYDdxoho.',
  },
]

export function findMainnetMethod(role: string, label: string): MainnetMethod | undefined {
  return ALPHBANX_MAINNET_METHODS.find((m) => m.role === role && m.label === label)
}
