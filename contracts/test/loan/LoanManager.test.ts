import { beforeAll, describe, expect, it } from 'vitest'
import { addressFromContractId, binToHex, DUST_AMOUNT } from '@alephium/web3'
import { randomBytes } from 'node:crypto'
import { LoanManager, type LoanManagerTypes } from '../../artifacts/ts'
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from '../helpers'

/**
 * LoanManager unit tests — scoped to the pure math functions and the
 * admin-gated parameter setters. Full lifecycle (openLoan → borrow/repay →
 * close) requires a deployed template + AbdToken + oracle and is covered by
 * the Phase 7 devnet integration tests; here we verify the building blocks
 * in isolation.
 */

const ONE_PCT_1E18 = 10_000_000_000_000_000n
const FIVE_PCT_1E18 = 50_000_000_000_000_000n
const TWO_HUNDRED_PCT_1E18 = 2_000_000_000_000_000_000n
const MINTING_FEE_1E18 = 5_000_000_000_000_000n // 0.5 %
const PRICE_DIA_5_CENTS_1E18 = 50_000_000_000_000_000n // $0.05 / ALPH
const ABD_SCALE = 1_000_000_000n // 10^9
const ALPH_SCALE = 1_000_000_000_000_000_000n // 10^18
const MIN_LOAN_1E9 = 100n * ABD_SCALE // 100 ABD

function freshTemplate() {
  return binToHex(randomBytes(32))
}

function baseFields(
  overrides: Partial<LoanManagerTypes.Fields> = {},
): LoanManagerTypes.Fields {
  return {
    abdTokenId: binToHex(randomBytes(32)),
    oracleId: binToHex(randomBytes(32)),
    loanTemplate: freshTemplate(),
    admin: aliceAddress,
    totalDebt: 0n,
    totalCollateral: 0n,
    mintingFee: MINTING_FEE_1E18,
    mcrThreshold: TWO_HUNDRED_PCT_1E18,
    minLoanSize: MIN_LOAN_1E9,
    auctionManager: '', // filled in by callers that hit liquidate()
    borrowerOperations: '', // empty in tests = caller-check is a no-op (audit fix A-01/A-04)
    circuitBreaker: '', // empty in tests = healthy gate is a no-op (audit fix O-02/D-23)
    badDebt: 0n, // audit fix O-04
    ...overrides,
  }
}

describe('LoanManager', () => {
  beforeAll(setupTestProvider)

  it('exposes configured parameters via getters', async () => {
    const fields = baseFields()
    const adm = await LoanManager.tests.getAdmin({ initialFields: fields })
    expect(adm.returns).toBe(aliceAddress)
    const fee = await LoanManager.tests.getMintingFee({ initialFields: fields })
    expect(fee.returns).toBe(MINTING_FEE_1E18)
    const mcr = await LoanManager.tests.getMcrThreshold({ initialFields: fields })
    expect(mcr.returns).toBe(TWO_HUNDRED_PCT_1E18)
    const min = await LoanManager.tests.getMinLoanSize({ initialFields: fields })
    expect(min.returns).toBe(MIN_LOAN_1E9)
  })

  it('accepts all eight canonical interest-rate tiers', async () => {
    const tiers = [
      ONE_PCT_1E18,
      30_000_000_000_000_000n, // 3
      50_000_000_000_000_000n, // 5
      100_000_000_000_000_000n, // 10
      150_000_000_000_000_000n, // 15
      200_000_000_000_000_000n, // 20
      250_000_000_000_000_000n, // 25
      300_000_000_000_000_000n, // 30
    ]
    for (const tier of tiers) {
      const result = await LoanManager.tests.isSupportedInterestRate({
        initialFields: baseFields(),
        args: { ir: tier },
      })
      expect(result.returns).toBe(true)
    }
  })

  it('rejects off-ladder interest rates', async () => {
    const wrong = [0n, 1n, 2n * ONE_PCT_1E18, 7n * ONE_PCT_1E18, ONE_PCT_1E18 / 2n]
    for (const ir of wrong) {
      const result = await LoanManager.tests.isSupportedInterestRate({
        initialFields: baseFields(),
        args: { ir },
      })
      expect(result.returns).toBe(false)
    }
  })

  it('computeCr returns u256Max for zero debt', async () => {
    const result = await LoanManager.tests.computeCr({
      initialFields: baseFields(),
      args: { collateral: 10n * ALPH_SCALE, debt: 0n, price: PRICE_DIA_5_CENTS_1E18 },
    })
    expect(result.returns).toBeGreaterThan(TWO_HUNDRED_PCT_1E18)
  })

  it('computeCr — 1000 ALPH × $0.05 / 25 ABD = 200 %', async () => {
    // collateral = 1000 ALPH, price = $0.05, debt = 25 ABD
    // collateral_value_USD = 1000 * 0.05 = $50
    // CR = 50/25 = 2 = 200%
    const collateral = 1000n * ALPH_SCALE
    const debt = 25n * ABD_SCALE
    const result = await LoanManager.tests.computeCr({
      initialFields: baseFields(),
      args: { collateral, debt, price: PRICE_DIA_5_CENTS_1E18 },
    })
    expect(result.returns).toBe(TWO_HUNDRED_PCT_1E18)
  })

  it('computeCr — 400 % when collateral value is 4× debt', async () => {
    const collateral = 2000n * ALPH_SCALE // $100 at $0.05
    const debt = 25n * ABD_SCALE // $25
    const result = await LoanManager.tests.computeCr({
      initialFields: baseFields(),
      args: { collateral, debt, price: PRICE_DIA_5_CENTS_1E18 },
    })
    expect(result.returns).toBe(4n * 10n ** 18n)
  })

  it('computeMintingFee — 0.5% of 100 ABD at $0.05/ALPH = 10 ALPH', async () => {
    // fee_USD = 0.005 * 100 = $0.50. fee_ALPH = 0.50 / 0.05 = 10 ALPH.
    const debt = 100n * ABD_SCALE
    const result = await LoanManager.tests.computeMintingFee({
      initialFields: baseFields(),
      args: { debt, price: PRICE_DIA_5_CENTS_1E18 },
    })
    expect(result.returns).toBe(10n * ALPH_SCALE)
  })

  it('computeInterest — zero for zero debt', async () => {
    const result = await LoanManager.tests.computeInterest({
      initialFields: baseFields(),
      args: {
        debt: 0n,
        interestRate: FIVE_PCT_1E18,
        elapsedMs: 7n * 24n * 60n * 60n * 1000n,
        price: PRICE_DIA_5_CENTS_1E18,
      },
    })
    expect(result.returns).toBe(0n)
  })

  it('computeInterest — zero for elapsed less than 6 hours (quantisation)', async () => {
    const result = await LoanManager.tests.computeInterest({
      initialFields: baseFields(),
      args: {
        debt: 1000n * ABD_SCALE,
        interestRate: FIVE_PCT_1E18,
        elapsedMs: 5n * 60n * 60n * 1000n, // 5 hours
        price: PRICE_DIA_5_CENTS_1E18,
      },
    })
    expect(result.returns).toBe(0n)
  })

  it('computeInterest — non-zero after one full 6-hour window', async () => {
    // debt = 1000 ABD, ir = 5 %, elapsed = 6 h, price = $0.05
    // interest_USD_per_yr = 1000 * 0.05 = $50 / yr
    // 6 h is 6/8760 = 1/1460 of a year ≈ 0.000685
    // interest_USD = $50 / 1460 ≈ $0.03425
    // interest_ALPH = 0.03425 / 0.05 ≈ 0.685 ALPH ≈ 685_000_000_000_000_000 atto
    const result = await LoanManager.tests.computeInterest({
      initialFields: baseFields(),
      args: {
        debt: 1000n * ABD_SCALE,
        interestRate: FIVE_PCT_1E18,
        elapsedMs: 6n * 60n * 60n * 1000n,
        price: PRICE_DIA_5_CENTS_1E18,
      },
    })
    expect(result.returns).toBeGreaterThan(600_000_000_000_000_000n)
    expect(result.returns).toBeLessThan(700_000_000_000_000_000n)
  })

  it('computeInterest — one year of 5 % on 1000 ABD at $0.05 ≈ 1000 ALPH', async () => {
    // 1000 ABD * 5%/yr = $50/yr interest. $50 / $0.05 = 1000 ALPH.
    const result = await LoanManager.tests.computeInterest({
      initialFields: baseFields(),
      args: {
        debt: 1000n * ABD_SCALE,
        interestRate: FIVE_PCT_1E18,
        elapsedMs: 31_536_000_000n,
        price: PRICE_DIA_5_CENTS_1E18,
      },
    })
    // 1000 ALPH = 1e21 atto; allow tiny rounding (quantisation of 6h)
    expect(result.returns).toBeGreaterThan(999n * ALPH_SCALE)
    expect(result.returns).toBeLessThanOrEqual(1000n * ALPH_SCALE)
  })

  it('setAdmin by admin swaps the admin', async () => {
    const fake = fungibleTestContract()
    const result = await LoanManager.tests.setAdmin({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: { newAdmin: bobAddress },
    })
    const state = result.contracts.find(
      (c): c is LoanManagerTypes.State => c.codeHash === LoanManager.contract.codeHash,
    )
    expect(state!.fields.admin).toBe(bobAddress)
  })

  it('setAdmin by non-admin reverts with NotAdmin (300)', async () => {
    const fake = fungibleTestContract()
    await expect(
      LoanManager.tests.setAdmin({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
        args: { newAdmin: bobAddress },
      }),
    ).rejects.toThrow(/AssertionFailed|300/)
  })

  it('setParameters by admin updates all three values', async () => {
    const fake = fungibleTestContract()
    const newFee = 3n * 10n ** 15n
    const newMcr = 3n * 10n ** 18n
    const newMin = 200n * ABD_SCALE
    const result = await LoanManager.tests.setParameters({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: {
        newMintingFee: newFee,
        newMcr,
        newMinLoan: newMin,
      },
    })
    const state = result.contracts.find(
      (c): c is LoanManagerTypes.State => c.codeHash === LoanManager.contract.codeHash,
    )
    expect(state!.fields.mintingFee).toBe(newFee)
    expect(state!.fields.mcrThreshold).toBe(newMcr)
    expect(state!.fields.minLoanSize).toBe(newMin)
  })

  it('setParameters by non-admin reverts', async () => {
    const fake = fungibleTestContract()
    await expect(
      LoanManager.tests.setParameters({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
        args: {
          newMintingFee: 1n,
          newMcr: 1n,
          newMinLoan: 1n,
        },
      }),
    ).rejects.toThrow(/AssertionFailed|300/)
  })

  describe('liquidate / redeem access control + argument checks', () => {
    it('liquidate on a non-existent loan reverts with LoanDoesNotExist (302)', async () => {
      const fake = fungibleTestContract()
      const amId = binToHex(randomBytes(32))
      await expect(
        LoanManager.tests.liquidate({
          initialFields: baseFields({ auctionManager: amId }),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { owner: aliceAddress, price: PRICE_DIA_5_CENTS_1E18, priceUpdateMs: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|302/)
    })

    it('liquidate when AuctionManager is not wired reverts (313)', async () => {
      const fake = fungibleTestContract()
      await expect(
        LoanManager.tests.liquidate({
          initialFields: baseFields({ auctionManager: '' }),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { owner: aliceAddress, price: PRICE_DIA_5_CENTS_1E18, priceUpdateMs: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|313/)
    })

    it('liquidate with zero price reverts (306)', async () => {
      const fake = fungibleTestContract()
      const amId = binToHex(randomBytes(32))
      await expect(
        LoanManager.tests.liquidate({
          initialFields: baseFields({ auctionManager: amId }),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { owner: aliceAddress, price: 0n, priceUpdateMs: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|306/)
    })

    it('redeem on a non-existent loan reverts (302)', async () => {
      const fake = fungibleTestContract()
      await expect(
        LoanManager.tests.redeem({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: {
            redeemer: bobAddress,
            owner: aliceAddress,
            amount: 1n * ABD_SCALE,
            price: PRICE_DIA_5_CENTS_1E18,
            priceUpdateMs: 0n,
          },
        }),
      ).rejects.toThrow(/AssertionFailed|302/)
    })

    it('redeem with zero amount reverts (306)', async () => {
      const fake = fungibleTestContract()
      await expect(
        LoanManager.tests.redeem({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: {
            redeemer: bobAddress,
            owner: aliceAddress,
            amount: 0n,
            price: PRICE_DIA_5_CENTS_1E18,
            priceUpdateMs: 0n,
          },
        }),
      ).rejects.toThrow(/AssertionFailed|306/)
    })
  })

  describe('setAuctionManager', () => {
    it('admin updates the auctionManager reference', async () => {
      const fake = fungibleTestContract()
      const newRef = binToHex(randomBytes(32))
      const result = await LoanManager.tests.setAuctionManager({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newRef },
      })
      const state = result.contracts.find(
        (c): c is LoanManagerTypes.State => c.codeHash === LoanManager.contract.codeHash,
      )
      expect(state!.fields.auctionManager).toBe(newRef)
    })

    it('non-admin setAuctionManager reverts (300)', async () => {
      const fake = fungibleTestContract()
      await expect(
        LoanManager.tests.setAuctionManager({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { newRef: binToHex(randomBytes(32)) },
        }),
      ).rejects.toThrow(/AssertionFailed|300/)
    })
  })

  it('loanIdOf and loanExists agree on a non-existent loan', async () => {
    const fake = fungibleTestContract()
    const idResult = await LoanManager.tests.loanIdOf({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      args: { owner: aliceAddress },
    })
    expect(idResult.returns).toMatch(/^[0-9a-f]{64}$/)

    const existsResult = await LoanManager.tests.loanExists({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      args: { owner: aliceAddress },
    })
    expect(existsResult.returns).toBe(false)
  })
})

describe('LoanManager — helpers', () => {
  it('addressFromContractId is deterministic', () => {
    const id = binToHex(randomBytes(32))
    expect(addressFromContractId(id)).toBe(addressFromContractId(id))
  })
})
