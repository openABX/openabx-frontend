import { beforeAll, describe, expect, it } from 'vitest'
import { addressFromContractId, binToHex, DUST_AMOUNT, ONE_ALPH } from '@alephium/web3'
import { randomBytes } from 'node:crypto'
import { Loan, type LoanTypes } from '../../artifacts/ts'
import { aliceAddress, bobAddress, inputFrom, setupTestProvider } from '../helpers'

/**
 * Unit tests for the Loan subcontract.
 *
 * The manager-auth check uses `callerContractId!() == manager`, so every
 * mutator test sets `callerContractAddress` to the manager's address and
 * declares the matching `manager` contractId in initialFields. A non-manager
 * caller uses a *different* contractAddress so `callerContractId!()` differs.
 */

function managerContext() {
  const managerContractId = binToHex(randomBytes(32))
  const managerAddress = addressFromContractId(managerContractId)
  return { managerContractId, managerAddress }
}

function loanSubContractAddress() {
  // Fresh Loan contract address each test, unrelated to the manager's.
  return addressFromContractId(binToHex(randomBytes(32)))
}

describe('Loan', () => {
  beforeAll(setupTestProvider)

  function baseFields(
    overrides: Partial<LoanTypes.Fields> = {},
  ): LoanTypes.Fields {
    const ctx = managerContext()
    return {
      manager: ctx.managerContractId,
      owner: aliceAddress,
      interestRate: 50_000_000_000_000_000n, // 5 % at 1e18 scale
      debt: 0n,
      collateral: 0n,
      lastInterestMs: 0n,
      ...overrides,
    }
  }

  it('exposes all getters from initial state', async () => {
    const fields = baseFields({
      debt: 100n * 10n ** 9n,
      collateral: 500n * 10n ** 18n,
      lastInterestMs: 1_000_000n,
    })
    const owner = await Loan.tests.getOwner({ initialFields: fields })
    expect(owner.returns).toBe(fields.owner)

    const manager = await Loan.tests.getManager({ initialFields: fields })
    expect(manager.returns).toBe(fields.manager)

    const ir = await Loan.tests.getInterestRate({ initialFields: fields })
    expect(ir.returns).toBe(50_000_000_000_000_000n)

    const debt = await Loan.tests.getDebt({ initialFields: fields })
    expect(debt.returns).toBe(100n * 10n ** 9n)

    const coll = await Loan.tests.getCollateral({ initialFields: fields })
    expect(coll.returns).toBe(500n * 10n ** 18n)

    const last = await Loan.tests.getLastInterestMs({ initialFields: fields })
    expect(last.returns).toBe(1_000_000n)
  })

  it('addDebt by manager increases debt', async () => {
    const ctx = managerContext()
    const fields = baseFields({ manager: ctx.managerContractId, debt: 10n })
    const result = await Loan.tests.addDebt({
      initialFields: fields,
      contractAddress: loanSubContractAddress(),
      callerContractAddress: ctx.managerAddress,
      args: { amount: 5n },
    })
    const state = result.contracts.find(
      (c): c is LoanTypes.State => c.codeHash === Loan.contract.codeHash,
    )
    expect(state!.fields.debt).toBe(15n)
  })

  it('addDebt by non-manager reverts with NotManager', async () => {
    const fields = baseFields()
    const wrongManager = managerContext()
    await expect(
      Loan.tests.addDebt({
        initialFields: fields,
        contractAddress: loanSubContractAddress(),
        // Wrong contract as caller — contractId won't match `manager`.
        callerContractAddress: wrongManager.managerAddress,
        args: { amount: 5n },
      }),
    ).rejects.toThrow(/AssertionFailed|200/)
  })

  it('reduceDebt by manager decreases debt', async () => {
    const ctx = managerContext()
    const fields = baseFields({ manager: ctx.managerContractId, debt: 30n })
    const result = await Loan.tests.reduceDebt({
      initialFields: fields,
      contractAddress: loanSubContractAddress(),
      callerContractAddress: ctx.managerAddress,
      args: { amount: 10n },
    })
    const state = result.contracts.find(
      (c): c is LoanTypes.State => c.codeHash === Loan.contract.codeHash,
    )
    expect(state!.fields.debt).toBe(20n)
  })

  it('reduceDebt beyond existing debt reverts with InsufficientDebt', async () => {
    const ctx = managerContext()
    await expect(
      Loan.tests.reduceDebt({
        initialFields: baseFields({ manager: ctx.managerContractId, debt: 5n }),
        contractAddress: loanSubContractAddress(),
        callerContractAddress: ctx.managerAddress,
        args: { amount: 10n },
      }),
    ).rejects.toThrow(/AssertionFailed|202/)
  })

  it('setLastInterestMs by manager updates the anchor', async () => {
    const ctx = managerContext()
    const result = await Loan.tests.setLastInterestMs({
      initialFields: baseFields({ manager: ctx.managerContractId }),
      contractAddress: loanSubContractAddress(),
      callerContractAddress: ctx.managerAddress,
      args: { nowMs: 1_700_000_000n },
    })
    const state = result.contracts.find(
      (c): c is LoanTypes.State => c.codeHash === Loan.contract.codeHash,
    )
    expect(state!.fields.lastInterestMs).toBe(1_700_000_000n)
  })

  it('pullCollateral by manager pulls ALPH and updates field', async () => {
    const ctx = managerContext()
    const amount = 10n * 10n ** 18n
    const result = await Loan.tests.pullCollateral({
      initialFields: baseFields({ manager: ctx.managerContractId }),
      contractAddress: loanSubContractAddress(),
      callerContractAddress: ctx.managerAddress,
      initialAsset: { alphAmount: ONE_ALPH, tokens: [] },
      inputAssets: [inputFrom(aliceAddress, ONE_ALPH + amount)],
      args: { from: aliceAddress, amount },
    })
    const state = result.contracts.find(
      (c): c is LoanTypes.State => c.codeHash === Loan.contract.codeHash,
    )
    expect(state!.fields.collateral).toBe(amount)
  })

  it('pullCollateral by non-manager reverts', async () => {
    const wrongManager = managerContext()
    const amount = ONE_ALPH
    await expect(
      Loan.tests.pullCollateral({
        initialFields: baseFields(),
        contractAddress: loanSubContractAddress(),
        callerContractAddress: wrongManager.managerAddress,
        initialAsset: { alphAmount: ONE_ALPH, tokens: [] },
        inputAssets: [inputFrom(aliceAddress, ONE_ALPH + amount)],
        args: { from: aliceAddress, amount },
      }),
    ).rejects.toThrow(/AssertionFailed|200/)
  })

  it('pushCollateral sends ALPH out and reduces the field', async () => {
    const ctx = managerContext()
    const startingCollateral = 20n * 10n ** 18n
    const sendAmount = 5n * 10n ** 18n
    const result = await Loan.tests.pushCollateral({
      initialFields: baseFields({ manager: ctx.managerContractId, collateral: startingCollateral }),
      contractAddress: loanSubContractAddress(),
      callerContractAddress: ctx.managerAddress,
      initialAsset: { alphAmount: ONE_ALPH + startingCollateral, tokens: [] },
      args: { to: bobAddress, amount: sendAmount },
    })
    const state = result.contracts.find(
      (c): c is LoanTypes.State => c.codeHash === Loan.contract.codeHash,
    )
    expect(state!.fields.collateral).toBe(startingCollateral - sendAmount)
  })

  it('pushCollateral beyond balance reverts', async () => {
    const ctx = managerContext()
    await expect(
      Loan.tests.pushCollateral({
        initialFields: baseFields({ manager: ctx.managerContractId, collateral: 5n }),
        contractAddress: loanSubContractAddress(),
        callerContractAddress: ctx.managerAddress,
        initialAsset: { alphAmount: ONE_ALPH, tokens: [] },
        args: { to: bobAddress, amount: 10n },
      }),
    ).rejects.toThrow(/AssertionFailed|201/)
  })

  it('destroy requires debt == 0', async () => {
    const ctx = managerContext()
    await expect(
      Loan.tests.destroy({
        initialFields: baseFields({ manager: ctx.managerContractId, debt: 1n }),
        contractAddress: loanSubContractAddress(),
        callerContractAddress: ctx.managerAddress,
        initialAsset: { alphAmount: ONE_ALPH, tokens: [] },
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { refundTo: aliceAddress },
      }),
    ).rejects.toThrow(/AssertionFailed|203/)
  })
})
