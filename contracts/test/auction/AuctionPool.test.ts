import { beforeAll, describe, expect, it } from 'vitest'
import { addressFromContractId, binToHex, DUST_AMOUNT } from '@alephium/web3'
import { randomBytes } from 'node:crypto'
import { AuctionPool, type AuctionPoolTypes } from '../../artifacts/ts'
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from '../helpers'

/**
 * AuctionPool unit tests — scoped to:
 *   (a) getters,
 *   (b) the pure `previewLiquidate` math (P/S snapshot update),
 *   (c) `currentAbdOf` / `claimableAlphOf` derivation over pool state,
 *   (d) access control on `liquidate`.
 *
 * Full deposit/withdraw/claim/multi-liquidation scenarios require map
 * subcontracts to be pre-populated in `existingContracts`; those end-to-end
 * flows are covered by the Phase 7 devnet integration suite.
 */

const PRECISION = 1_000_000_000_000_000_000n // 10^18
const BPS_SCALE = 10_000n
const ABD_SCALE = 1_000_000_000n // 10^9
const ALPH_SCALE = 1_000_000_000_000_000_000n // 10^18

function ownerCtx() {
  const ownerId = binToHex(randomBytes(32))
  const ownerAddress = addressFromContractId(ownerId)
  return { ownerId, ownerAddress }
}

function baseFields(
  overrides: Partial<AuctionPoolTypes.Fields> = {},
): AuctionPoolTypes.Fields {
  const { ownerId } = ownerCtx()
  return {
    abdTokenId: binToHex(randomBytes(32)),
    owner: ownerId,
    discountBps: 500n,           // 5 %
    bidSuccessFeeBps: 50n,       // 0.5 %
    closeBidFeeBps: 50n,         // 0.5 %
    productP: PRECISION,
    alphPerUnit: 0n,
    totalAbd: 0n,
    epoch: 0n, // audit fix M-02 — wipeout epoch counter
    ...overrides,
  }
}

describe('AuctionPool', () => {
  beforeAll(setupTestProvider)

  it('exposes configured fields via getters', async () => {
    const fields = baseFields({ discountBps: 1500n, bidSuccessFeeBps: 150n })
    const disc = await AuctionPool.tests.getDiscountBps({ initialFields: fields })
    expect(disc.returns).toBe(1500n)
    const fee = await AuctionPool.tests.getBidSuccessFeeBps({ initialFields: fields })
    expect(fee.returns).toBe(150n)
    const close = await AuctionPool.tests.getCloseBidFeeBps({ initialFields: fields })
    expect(close.returns).toBe(50n)
    const p = await AuctionPool.tests.getProductP({ initialFields: fields })
    expect(p.returns).toBe(PRECISION)
    const s = await AuctionPool.tests.getAlphPerUnit({ initialFields: fields })
    expect(s.returns).toBe(0n)
    const total = await AuctionPool.tests.getTotalAbd({ initialFields: fields })
    expect(total.returns).toBe(0n)
  })

  it('hasDeposit returns false for an empty pool', async () => {
    const result = await AuctionPool.tests.hasDeposit({
      initialFields: baseFields(),
      args: { who: aliceAddress },
    })
    expect(result.returns).toBe(false)
  })

  it('currentAbdOf returns 0 for non-depositor', async () => {
    const result = await AuctionPool.tests.currentAbdOf({
      initialFields: baseFields(),
      args: { who: aliceAddress },
    })
    expect(result.returns).toBe(0n)
  })

  describe('previewLiquidate math', () => {
    // Scenario: pool has 1000 ABD, P=1e18, S=0. Liquidation absorbs 200 ABD
    // debt, pool gains 50 ALPH collateral, bid fee 0.5%.
    //
    // Expected:
    //   fee = 50 × 0.005 = 0.25 ALPH
    //   netAlph = 49.75 ALPH
    //   newP = 1e18 × (1000-200) / 1000 = 1e18 × 0.8 = 8e17
    //   newS = 0 + (49.75e18 × 1e18) / 1000e9 = 49.75e27/1e12 = 4.975e16
    //     Wait — scale check. Pool's totalAbd is in atto-ABD (1e9 scale).
    //     1000 ABD = 1e12 atto-ABD.
    //     alphGained is atto-ALPH (1e18). 50 ALPH = 5e19 atto-ALPH.
    //     S formula: alphGained * P / totalAbd = 5e19 × 1e18 / 1e12 = 5e25
    //     Then after fee: 5e25 × 0.995 / ... hmm I'm confusing units.
    //
    //     Actually the contract does: netAlph × P / previousTotal.
    //     previousTotal and debtAbsorbed are both in the *same unit* (atto-ABD).
    //     netAlph is atto-ALPH. P is 1e18 scale, totalAbd is 1e12 (atto-ABD for 1000 ABD).
    //     So netAlph × P / totalAbd = 5e19 × 1e18 / 1e12 = 5e25.
    //     That's "atto-ALPH per ... something" — let me think.
    //
    //     A depositor with d atto-ABD and snapshot P_i, S_i.
    //     pending_alph = d × (S - S_i) / P_i
    //                 = (atto-ABD) × (atto-ALPH × 1e18 / atto-ABD) / (1e18)
    //                 = atto-ALPH ✓
    //     For all-pool example, one depositor with d = 1000 ABD = 1e12 atto-ABD:
    //     claimed = 1e12 × 5e25 / 1e18 = 5e19 = 50 ALPH worth (minus the 0.25 fee).
    //     5e19 × 0.995 = 4.975e19 = 49.75 ALPH ✓
    //
    //     So for the test, netAlph = 5e19 - fee(2.5e17) = 4.9750e19.
    //     S_new = netAlph × P_prev / totalAbd = 4.975e19 × 1e18 / 1e12 = 4.975e25

    it('standard case: 200/1000 ABD absorbed, 50 ALPH gained → P×0.8, S updated', async () => {
      const fields = baseFields({ totalAbd: 1000n * ABD_SCALE })
      const debtAbsorbed = 200n * ABD_SCALE
      const alphGained = 50n * ALPH_SCALE
      const result = await AuctionPool.tests.previewLiquidate({
        initialFields: fields,
        args: { debtAbsorbed, alphGained },
      })
      const [newP, newS, newTotal] = result.returns

      // P: PRECISION × (1000 - 200) / 1000 = PRECISION × 0.8
      expect(newP).toBe((PRECISION * 800n) / 1000n)
      expect(newP).toBe(800_000_000_000_000_000n)
      expect(newTotal).toBe(800n * ABD_SCALE)

      // S: 0 + netAlph × P / totalAbd. netAlph = 50 ALPH × (1 − 0.005)
      const feeAlph = (alphGained * 50n) / BPS_SCALE
      const netAlph = alphGained - feeAlph
      const expectedS = (netAlph * PRECISION) / (1000n * ABD_SCALE)
      expect(newS).toBe(expectedS)
    })

    it('wipeout: debtAbsorbed == totalAbd → P resets, totalAbd=0', async () => {
      const fields = baseFields({ totalAbd: 500n * ABD_SCALE })
      const debtAbsorbed = 500n * ABD_SCALE
      const alphGained = 10n * ALPH_SCALE
      const result = await AuctionPool.tests.previewLiquidate({
        initialFields: fields,
        args: { debtAbsorbed, alphGained },
      })
      const [newP, _newS, newTotal] = result.returns
      expect(newP).toBe(PRECISION)
      expect(newTotal).toBe(0n)
    })

    it('no liquidation (zero amounts) is a no-op in preview', async () => {
      // previewLiquidate with 0/0 is mathematically undefined (0/0);
      // for a non-empty pool, the caller should never invoke liquidate
      // with zero. But preview handles it by computing newS = prev +
      // 0*P/total = prev. P unchanged. Total unchanged.
      const fields = baseFields({ totalAbd: 100n * ABD_SCALE })
      const result = await AuctionPool.tests.previewLiquidate({
        initialFields: fields,
        args: { debtAbsorbed: 0n, alphGained: 0n },
      })
      const [newP, newS, newTotal] = result.returns
      expect(newP).toBe(PRECISION)
      expect(newS).toBe(0n)
      expect(newTotal).toBe(100n * ABD_SCALE)
    })

    it('higher-tier fee (20 % pool = 2 % bid fee) reduces S accordingly', async () => {
      const fields = baseFields({
        discountBps: 2000n,
        bidSuccessFeeBps: 200n,
        totalAbd: 1000n * ABD_SCALE,
      })
      const debtAbsorbed = 100n * ABD_SCALE
      const alphGained = 30n * ALPH_SCALE
      const result = await AuctionPool.tests.previewLiquidate({
        initialFields: fields,
        args: { debtAbsorbed, alphGained },
      })
      const [_newP, newS] = result.returns
      const expectedFee = (alphGained * 200n) / BPS_SCALE
      const expectedNet = alphGained - expectedFee
      const expectedS = (expectedNet * PRECISION) / (1000n * ABD_SCALE)
      expect(newS).toBe(expectedS)
    })
  })

  describe('access control', () => {
    it('liquidate by non-owner reverts with NotOwner (600)', async () => {
      const wrong = addressFromContractId(binToHex(randomBytes(32)))
      const fake = fungibleTestContract()
      await expect(
        AuctionPool.tests.liquidate({
          initialFields: baseFields({ totalAbd: 100n * ABD_SCALE }),
          contractAddress: fake.contractAddress,
          callerContractAddress: wrong,
          args: { debtAbsorbed: 1n, alphGained: 1n },
        }),
      ).rejects.toThrow(/AssertionFailed|600/)
    })

    it('liquidate by owner with zero amounts reverts', async () => {
      const ctx = ownerCtx()
      const fake = fungibleTestContract()
      await expect(
        AuctionPool.tests.liquidate({
          initialFields: baseFields({
            owner: ctx.ownerId,
            totalAbd: 100n * ABD_SCALE,
          }),
          contractAddress: fake.contractAddress,
          callerContractAddress: ctx.ownerAddress,
          args: { debtAbsorbed: 0n, alphGained: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|603/)
    })

    it('liquidate with debtAbsorbed > totalAbd reverts', async () => {
      const ctx = ownerCtx()
      const fake = fungibleTestContract()
      await expect(
        AuctionPool.tests.liquidate({
          initialFields: baseFields({
            owner: ctx.ownerId,
            totalAbd: 100n * ABD_SCALE,
          }),
          contractAddress: fake.contractAddress,
          callerContractAddress: ctx.ownerAddress,
          args: { debtAbsorbed: 200n * ABD_SCALE, alphGained: 1n * ALPH_SCALE },
        }),
      ).rejects.toThrow(/AssertionFailed|605/)
    })
  })

  describe('liquidate state transitions', () => {
    it('updates productP, alphPerUnit, totalAbd per formula', async () => {
      const ctx = ownerCtx()
      const fake = fungibleTestContract()
      const startTotal = 1000n * ABD_SCALE
      const debtAbsorbed = 250n * ABD_SCALE
      const alphGained = 100n * ALPH_SCALE

      const result = await AuctionPool.tests.liquidate({
        initialFields: baseFields({ owner: ctx.ownerId, totalAbd: startTotal }),
        contractAddress: fake.contractAddress,
        callerContractAddress: ctx.ownerAddress,
        args: { debtAbsorbed, alphGained },
      })

      // With Ralph's `mapping` field, the result uses `contractAddress` as
      // the identifier; find the pool by address rather than codeHash.
      const state = result.contracts.find((c) => c.address === fake.contractAddress)
      expect(state).toBeDefined()
      const fields = (state as unknown as AuctionPoolTypes.State).fields

      expect(fields.productP).toBe((PRECISION * 750n) / 1000n)
      expect(fields.totalAbd).toBe(750n * ABD_SCALE)

      const feeAlph = (alphGained * 50n) / BPS_SCALE
      const netAlph = alphGained - feeAlph
      const expectedS = (netAlph * PRECISION) / startTotal
      expect(fields.alphPerUnit).toBe(expectedS)
    })

    it('pool wipeout resets P to PRECISION and totalAbd to 0', async () => {
      const ctx = ownerCtx()
      const fake = fungibleTestContract()
      const startTotal = 500n * ABD_SCALE

      const result = await AuctionPool.tests.liquidate({
        initialFields: baseFields({ owner: ctx.ownerId, totalAbd: startTotal }),
        contractAddress: fake.contractAddress,
        callerContractAddress: ctx.ownerAddress,
        args: { debtAbsorbed: startTotal, alphGained: 1n * ALPH_SCALE },
      })
      const state = result.contracts.find((c) => c.address === fake.contractAddress)
      const fields = (state as unknown as AuctionPoolTypes.State).fields
      expect(fields.productP).toBe(PRECISION)
      expect(fields.totalAbd).toBe(0n)
    })
  })
})
