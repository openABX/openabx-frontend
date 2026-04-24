import { beforeAll, describe, expect, it } from 'vitest'
import { addressFromContractId, binToHex, DUST_AMOUNT, ONE_ALPH } from '@alephium/web3'
import { randomBytes } from 'node:crypto'
import { AuctionFarming, type AuctionFarmingTypes } from '../../artifacts/ts'
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
  U256_MAX,
} from '../helpers'

const TWELVE_MONTHS_MS = 31_536_000_000n

function baseFields(
  overrides: Partial<AuctionFarmingTypes.Fields> = {},
): AuctionFarmingTypes.Fields {
  return {
    abxTokenId: binToHex(randomBytes(32)),
    vesting: binToHex(randomBytes(32)),
    admin: aliceAddress,
    notifier: binToHex(randomBytes(32)),
    emittedAbx: 0n,
    paused: false,
    vestingDurationMs: TWELVE_MONTHS_MS,
    ...overrides,
  }
}

describe('AuctionFarming', () => {
  beforeAll(setupTestProvider)

  it('exposes constructor state', async () => {
    const fields = baseFields()
    const adm = await AuctionFarming.tests.getAdmin({ initialFields: fields })
    expect(adm.returns).toBe(aliceAddress)
    const paused = await AuctionFarming.tests.isPaused({ initialFields: fields })
    expect(paused.returns).toBe(false)
    const duration = await AuctionFarming.tests.getVestingDurationMs({ initialFields: fields })
    expect(duration.returns).toBe(TWELVE_MONTHS_MS)
  })

  it('admin can pause', async () => {
    const fake = fungibleTestContract()
    const result = await AuctionFarming.tests.setPaused({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: { newPaused: true },
    })
    const state = result.contracts.find(
      (c) => c.address === fake.contractAddress,
    ) as unknown as AuctionFarmingTypes.State
    expect(state.fields.paused).toBe(true)
  })

  it('non-admin pause reverts', async () => {
    const fake = fungibleTestContract()
    await expect(
      AuctionFarming.tests.setPaused({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
        args: { newPaused: true },
      }),
    ).rejects.toThrow(/AssertionFailed|1000/)
  })

  it('setVestingDurationMs rejects 0', async () => {
    const fake = fungibleTestContract()
    await expect(
      AuctionFarming.tests.setVestingDurationMs({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newMs: 0n },
      }),
    ).rejects.toThrow(/AssertionFailed|1004/)
  })

  it('creditDepositor by non-notifier reverts (1001)', async () => {
    const fake = fungibleTestContract()
    const wrongCaller = addressFromContractId(binToHex(randomBytes(32)))
    await expect(
      AuctionFarming.tests.creditDepositor({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        callerContractAddress: wrongCaller,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: binToHex(randomBytes(32)), amount: 1000n }],
        },
        args: { beneficiary: bobAddress, abxAmount: 100n },
      }),
    ).rejects.toThrow(/AssertionFailed|1001/)
  })

  it('creditDepositor when paused reverts (1002)', async () => {
    const fake = fungibleTestContract()
    const notifierCid = binToHex(randomBytes(32))
    const notifierAddr = addressFromContractId(notifierCid)
    await expect(
      AuctionFarming.tests.creditDepositor({
        initialFields: baseFields({ paused: true, notifier: notifierCid }),
        contractAddress: fake.contractAddress,
        callerContractAddress: notifierAddr,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: binToHex(randomBytes(32)), amount: 1000n }],
        },
        args: { beneficiary: bobAddress, abxAmount: 100n },
      }),
    ).rejects.toThrow(/AssertionFailed|1002/)
  })
})
