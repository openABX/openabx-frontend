// Per-user and global protocol reads. Used by the Dashboard + every protocol
// page so the connected wallet can see its own state.
//
// Approach:
//   - Wallet balances use the public /addresses/<addr>/balance endpoint —
//     works on every network unconditionally.
//   - Per-contract user reads use the typed @openabx/contracts clients for
//     our clean-room deployments (devnet, testnet). On mainnet, where
//     AlphBanX's contract bytecode is not ours, those typed calls may fail
//     silently — the UI renders em-dashes rather than misleading numbers,
//     and gates writes until mainnet-write-path work lands.
//   - Global protocol reads (total debt, TVL, supplies) use raw
//     /contracts/<addr>/state fetches which work on every network; the
//     mutable-field layout is pinned in @openabx/sdk.

import { addressFromContractId, binToHex, contractIdFromAddress } from '@alephium/web3'
import {
  AuctionPool,
  Loan,
  LoanManager,
  StakeManager,
  Vesting,
} from '@openabx/contracts'
import type { Network } from '@openabx/sdk'
import {
  fetchMainnetLoanId,
  fetchMainnetPoolPositions,
  fetchMainnetStakePosition,
  getClientContext,
  getNetworkConfig,
  resolveAddress,
} from '@openabx/sdk'

/**
 * Convert a base58 contract address into its hex token id (32 bytes) — used
 * to match tokens in the /addresses/<addr>/balance endpoint, which keys
 * token balances by hex id rather than base58 address.
 */
export function tokenIdFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined
  try {
    return binToHex(contractIdFromAddress(address))
  } catch {
    return undefined
  }
}

export interface WalletBalances {
  alphAtto: bigint
  abdAtto: bigint
  abxAtto: bigint
}

interface TokenBalance {
  id: string
  amount: string
}

interface BalanceResponse {
  balance: string
  tokenBalances?: TokenBalance[]
}

/**
 * Alephium's balance endpoint keys tokens by hex-encoded token id (= contract
 * id), not by base58 contract address. We can't derive one from the other
 * without a node round-trip; the simple solution is to match by index into
 * the token list when length is 1 (common case on testnet where only ABD is
 * issued) and fall back to name/amount heuristics otherwise. For the
 * mainnet and devnet cases we rely on explicit id override via env or a
 * separate /contracts/<addr>/state call at page load to cache the id.
 *
 * For the v0.2 pass: we simply sum token balances whose id ends with a
 * suffix matching the tail of the contract address (Alephium addresses
 * derive from the contract id). If that's brittle in the future, add a
 * resolver that caches id ↔ address pairs at app boot.
 */
function matchToken(list: TokenBalance[], tokenIdHex: string | undefined): bigint {
  if (!tokenIdHex) return 0n
  const norm = tokenIdHex.toLowerCase()
  for (const b of list) {
    if (b.id.toLowerCase() === norm) {
      return BigInt(b.amount)
    }
  }
  return 0n
}

export async function fetchWalletBalances(
  network: Network,
  walletAddress: string,
): Promise<WalletBalances> {
  const nodeUrl = getNetworkConfig(network).nodeUrl
  const res = await fetch(`${nodeUrl}/addresses/${walletAddress}/balance`)
  if (!res.ok) throw new Error(`balance HTTP ${res.status}`)
  const json = (await res.json()) as BalanceResponse
  const tokens = json.tokenBalances ?? []
  const abdId = tokenIdFromAddress(resolveAddress(network, 'abdToken'))
  const abxId = tokenIdFromAddress(resolveAddress(network, 'abxToken'))
  return {
    alphAtto: BigInt(json.balance),
    abdAtto: matchToken(tokens, abdId),
    abxAtto: matchToken(tokens, abxId),
  }
}

export interface LoanPosition {
  exists: boolean
  collateralAtto: bigint
  debtAtto: bigint
  interestRate1e18: bigint
  lastInterestMs: bigint
}

export const EMPTY_LOAN: LoanPosition = {
  exists: false,
  collateralAtto: 0n,
  debtAtto: 0n,
  interestRate1e18: 0n,
  lastInterestMs: 0n,
}

export async function fetchLoanPosition(
  network: Network,
  walletAddress: string,
): Promise<LoanPosition> {
  const ctx = getClientContext(network)

  if (!ctx.isOpenAbxDeployment) {
    // Mainnet: lookup user's Loan sub id via LoanManager.mi=23, fetch raw
    // state. AlphBanX Loan mut field layout verified 2026-04-23 against 4
    // active loans:
    //   mut[0] lastInterestMs
    //   mut[1] interestRate integer % (e.g., 5, 15, 35)
    //   mut[2] cumulative-interest index at 1e18 scale
    //   mut[3] collateral atto-ALPH (1e18 scale)
    //   mut[4] debt atto-ABD (1e9 scale)
    const loanId = await fetchMainnetLoanId(network, walletAddress)
    if (!loanId) return EMPTY_LOAN
    try {
      const loanAddress = addressFromContractId(loanId)
      const res = await fetch(
        `${getNetworkConfig(network).nodeUrl}/contracts/${loanAddress}/state`,
      )
      if (!res.ok) return EMPTY_LOAN
      const state = (await res.json()) as {
        mutFields: Array<{ type: string; value: string }>
      }
      const u256 = (i: number): bigint | null => {
        const f = state.mutFields[i]
        if (!f || f.type !== 'U256') return null
        try {
          return BigInt(f.value)
        } catch {
          return null
        }
      }
      const lastInterestMs = u256(0)
      const rateIntPercent = u256(1) ?? 0n
      const collateral = u256(3)
      const debt = u256(4)
      if (collateral === null) return EMPTY_LOAN
      // Convert rateIntPercent (5, 15, 35) into 1e18-scaled rate
      // (0.05 × 1e18, 0.15 × 1e18, etc.).
      const interestRate1e18 =
        rateIntPercent > 0n ? (rateIntPercent * 10_000_000_000_000_000n) : 0n
      return {
        exists: true,
        collateralAtto: collateral,
        debtAtto: debt ?? 0n,
        interestRate1e18,
        lastInterestMs: lastInterestMs ?? 0n,
      }
    } catch {
      return EMPTY_LOAN
    }
  }

  const loanManagerAddr = resolveAddress(network, 'loanManager')
  if (!loanManagerAddr) return EMPTY_LOAN
  const lm = LoanManager.at(loanManagerAddr)
  try {
    const exists = await lm.view.loanExists({ args: { owner: walletAddress } })
    if (!exists.returns) return EMPTY_LOAN
    const loanIdRes = await lm.view.loanIdOf({ args: { owner: walletAddress } })
    const loanId = loanIdRes.returns
    if (!loanId) return EMPTY_LOAN
    const loan = Loan.at(addressFromContractId(loanId))
    const state = await loan.fetchState()
    return {
      exists: true,
      collateralAtto: state.fields.collateral,
      debtAtto: state.fields.debt,
      interestRate1e18: state.fields.interestRate,
      lastInterestMs: state.fields.lastInterestMs,
    }
  } catch {
    return EMPTY_LOAN
  }
}

export interface PoolPosition {
  discountBps: number
  addr: string
  hasDeposit: boolean
  abdAtto: bigint
  claimableAlphAtto: bigint
}

export async function fetchPoolPositions(
  network: Network,
  walletAddress: string,
): Promise<PoolPosition[]> {
  const ctx = getClientContext(network)
  if (!ctx.isOpenAbxDeployment) {
    const mainnetPositions = await fetchMainnetPoolPositions(network, walletAddress)
    return mainnetPositions.map((p) => ({
      discountBps: p.tierBps,
      addr: p.subAddress ?? '',
      hasDeposit: p.depositedAbdAtto > 0n,
      abdAtto: p.depositedAbdAtto,
      claimableAlphAtto: p.claimableAlphAtto,
    }))
  }
  const tiers: Array<[500, 'auctionPool5'] | [1000, 'auctionPool10'] | [1500, 'auctionPool15'] | [2000, 'auctionPool20']> = [
    [500, 'auctionPool5'],
    [1000, 'auctionPool10'],
    [1500, 'auctionPool15'],
    [2000, 'auctionPool20'],
  ]
  const results: PoolPosition[] = []
  for (const [bps, role] of tiers) {
    const addr = resolveAddress(network, role)
    if (!addr) continue
    try {
      const pool = AuctionPool.at(addr)
      const [hasDeposit, abd, claim] = await Promise.all([
        pool.view.hasDeposit({ args: { who: walletAddress } }),
        pool.view.currentAbdOf({ args: { who: walletAddress } }),
        pool.view.claimableAlphOf({ args: { who: walletAddress } }),
      ])
      results.push({
        discountBps: bps,
        addr,
        hasDeposit: Boolean(hasDeposit.returns),
        abdAtto: abd.returns ?? 0n,
        claimableAlphAtto: claim.returns ?? 0n,
      })
    } catch {
      results.push({
        discountBps: bps,
        addr,
        hasDeposit: false,
        abdAtto: 0n,
        claimableAlphAtto: 0n,
      })
    }
  }
  return results
}

export interface StakePosition {
  stakedAtto: bigint
  pendingRewardsAtto: bigint
  pendingUnstakeAtto: bigint
  unstakeReadyAtMs: bigint
}

export const EMPTY_STAKE: StakePosition = {
  stakedAtto: 0n,
  pendingRewardsAtto: 0n,
  pendingUnstakeAtto: 0n,
  unstakeReadyAtMs: 0n,
}

export async function fetchStakePosition(
  network: Network,
  walletAddress: string,
): Promise<StakePosition> {
  const ctx = getClientContext(network)
  if (!ctx.isOpenAbxDeployment) {
    const m = await fetchMainnetStakePosition(network, walletAddress)
    return {
      stakedAtto: m.stakedAbxAtto,
      pendingRewardsAtto: m.pendingRewardsAlphAtto,
      pendingUnstakeAtto: m.pendingUnstakeAbxAtto,
      unstakeReadyAtMs: m.unstakeReadyAtMs,
    }
  }
  const addr = resolveAddress(network, 'stakeManager')
  if (!addr) return EMPTY_STAKE
  try {
    const sm = StakeManager.at(addr)
    const [staked, pending, unstake] = await Promise.all([
      sm.view.stakeOf({ args: { who: walletAddress } }),
      sm.view.pendingRewardsOf({ args: { who: walletAddress } }),
      sm.view.pendingUnstakeOf({ args: { who: walletAddress } }),
    ])
    const unstakeReturns = unstake.returns as unknown as
      | [bigint, bigint]
      | undefined
    return {
      stakedAtto: staked.returns ?? 0n,
      pendingRewardsAtto: pending.returns ?? 0n,
      pendingUnstakeAtto: unstakeReturns?.[0] ?? 0n,
      unstakeReadyAtMs: unstakeReturns?.[1] ?? 0n,
    }
  } catch {
    return EMPTY_STAKE
  }
}

export interface VestingPosition {
  exists: boolean
  totalAbxAtto: bigint
  claimedAtto: bigint
  claimableAtto: bigint
  startMs: bigint
  durationMs: bigint
}

export const EMPTY_VESTING: VestingPosition = {
  exists: false,
  totalAbxAtto: 0n,
  claimedAtto: 0n,
  claimableAtto: 0n,
  startMs: 0n,
  durationMs: 0n,
}

export async function fetchVestingPosition(
  network: Network,
  walletAddress: string,
): Promise<VestingPosition> {
  const ctx = getClientContext(network)
  if (!ctx.isOpenAbxDeployment) return EMPTY_VESTING
  const addr = resolveAddress(network, 'vesting')
  if (!addr) return EMPTY_VESTING
  try {
    const v = Vesting.at(addr)
    const has = await v.view.hasSchedule({ args: { who: walletAddress } })
    if (!has.returns) return EMPTY_VESTING
    const [schedule, claimable] = await Promise.all([
      v.view.getSchedule({ args: { who: walletAddress } }),
      v.view.claimableAt({
        args: { who: walletAddress, nowMs: BigInt(Date.now()) },
      }),
    ])
    const s = schedule.returns as unknown as
      | [bigint, bigint, bigint, bigint, string]
      | undefined
    if (!s) return EMPTY_VESTING
    return {
      exists: true,
      totalAbxAtto: s[0],
      claimedAtto: s[1],
      startMs: s[2],
      durationMs: s[3],
      claimableAtto: claimable.returns ?? 0n,
    }
  } catch {
    return EMPTY_VESTING
  }
}

export interface ProtocolGlobals {
  totalDebtAbd: bigint | null
  totalCollateralAlph: bigint | null
  abdTotalSupply: bigint | null
  abxTotalSupply: bigint | null
  alphUsd1e18: bigint | null
  totalStakedAbx: bigint | null
  totalPoolAbd: bigint | null
}

interface NodeCallResponse {
  type: string
  returns?: Array<{ type: string; value: string }>
}

interface ContractStateResponse {
  immFields: Array<{ type: string; value: string }>
  mutFields: Array<{ type: string; value: string }>
}

async function rawState(
  nodeUrl: string,
  address: string,
): Promise<ContractStateResponse | null> {
  try {
    const res = await fetch(`${nodeUrl}/contracts/${address}/state`)
    if (!res.ok) return null
    return (await res.json()) as ContractStateResponse
  } catch {
    return null
  }
}

async function rawCall(
  nodeUrl: string,
  address: string,
  methodIndex: number,
): Promise<NodeCallResponse | null> {
  try {
    const res = await fetch(`${nodeUrl}/contracts/call-contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 0, address, methodIndex }),
    })
    if (!res.ok) return null
    return (await res.json()) as NodeCallResponse
  } catch {
    return null
  }
}

function decodeU256(
  slot: { type: string; value: string } | undefined,
): bigint | null {
  if (!slot || slot.type !== 'U256') return null
  try {
    return BigInt(slot.value)
  } catch {
    return null
  }
}

// Mutable-field index 1 on ABD/ABX tokens holds totalSupply (Phase 0 pin).
const TOKEN_TOTAL_SUPPLY_INDEX = 1

// LoanManager on OpenABX clean-room deployment:
//   mut[0] admin, mut[1] totalDebt, mut[2] totalCollateral, ...
// AlphBanX mainnet LoanManager layout may differ; gracefully null out.
const LOANMGR_TOTAL_DEBT_INDEX = 1
const LOANMGR_TOTAL_COLLATERAL_INDEX = 2

// AuctionManager.mut[5] is the aggregate ABD in pools (mainnet-pinned 2026-04-23).
const AUCTIONMGR_TVL_INDEX = 5

// StakeManager.mut[1] = totalStakedAbx on clean-room layout.
const STAKEMGR_TOTAL_STAKED_INDEX = 1

export async function fetchProtocolGlobals(network: Network): Promise<ProtocolGlobals> {
  const nodeUrl = getNetworkConfig(network).nodeUrl
  const addrs = {
    abd: resolveAddress(network, 'abdToken'),
    abx: resolveAddress(network, 'abxToken'),
    loanMgr: resolveAddress(network, 'loanManager'),
    auctionMgr: resolveAddress(network, 'auctionManager'),
    stakeMgr: resolveAddress(network, 'stakeManager'),
    oracle: resolveAddress(network, 'diaAlphPriceAdapter'),
  }

  const [abdState, abxState, loanState, auctionState, stakeState, oracleCall] =
    await Promise.all([
      addrs.abd ? rawState(nodeUrl, addrs.abd) : Promise.resolve(null),
      addrs.abx ? rawState(nodeUrl, addrs.abx) : Promise.resolve(null),
      addrs.loanMgr ? rawState(nodeUrl, addrs.loanMgr) : Promise.resolve(null),
      addrs.auctionMgr
        ? rawState(nodeUrl, addrs.auctionMgr)
        : Promise.resolve(null),
      addrs.stakeMgr
        ? rawState(nodeUrl, addrs.stakeMgr)
        : Promise.resolve(null),
      addrs.oracle ? rawCall(nodeUrl, addrs.oracle, 1) : Promise.resolve(null),
    ])

  const alphUsd1e18 =
    oracleCall?.type === 'CallContractSucceeded' &&
    oracleCall.returns?.[0]?.type === 'U256'
      ? BigInt(oracleCall.returns[0].value)
      : null

  return {
    totalDebtAbd: decodeU256(loanState?.mutFields[LOANMGR_TOTAL_DEBT_INDEX]),
    totalCollateralAlph: decodeU256(
      loanState?.mutFields[LOANMGR_TOTAL_COLLATERAL_INDEX],
    ),
    abdTotalSupply: decodeU256(abdState?.mutFields[TOKEN_TOTAL_SUPPLY_INDEX]),
    abxTotalSupply: decodeU256(abxState?.mutFields[TOKEN_TOTAL_SUPPLY_INDEX]),
    alphUsd1e18,
    totalStakedAbx: decodeU256(
      stakeState?.mutFields[STAKEMGR_TOTAL_STAKED_INDEX],
    ),
    totalPoolAbd: decodeU256(auctionState?.mutFields[AUCTIONMGR_TVL_INDEX]),
  }
}
