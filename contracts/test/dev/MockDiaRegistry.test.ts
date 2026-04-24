import { beforeAll, describe, expect, it } from 'vitest'
import { ONE_ALPH } from '@alephium/web3'
import { MockDiaRegistry, type MockDiaRegistryTypes } from '../../artifacts/ts'
import { aliceAddress, fungibleTestContract, inputFrom, setupTestProvider } from '../helpers'

describe('MockDiaRegistry', () => {
  beforeAll(setupTestProvider)

  const initial: MockDiaRegistryTypes.Fields = {
    price: 49_489_670_000_000_000n,
    timestamp: 1_745_000_000_000n,
  }

  const ALPH_USD_KEY = '414c50482f555344' // hex of "ALPH/USD"

  it('getValue returns stored (price, timestamp) regardless of key', async () => {
    const result = await MockDiaRegistry.tests.getValue({
      initialFields: initial,
      args: { key: ALPH_USD_KEY },
    })
    const [price, timestamp] = result.returns
    expect(price).toBe(initial.price)
    expect(timestamp).toBe(initial.timestamp)
  })

  it('setValue updates both fields', async () => {
    const fake = fungibleTestContract()
    const result = await MockDiaRegistry.tests.setValue({
      initialFields: initial,
      contractAddress: fake.contractAddress,
      initialAsset: { alphAmount: ONE_ALPH, tokens: [] },
      inputAssets: [inputFrom(aliceAddress)],
      args: { newPrice: 123n, newTimestamp: 456n },
    })
    const state = result.contracts.find(
      (c): c is MockDiaRegistryTypes.State =>
        c.codeHash === MockDiaRegistry.contract.codeHash,
    )
    expect(state!.fields.price).toBe(123n)
    expect(state!.fields.timestamp).toBe(456n)
  })
})
