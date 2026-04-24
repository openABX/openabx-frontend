import { beforeAll, describe, expect, it } from 'vitest'
import { ONE_ALPH } from '@alephium/web3'
import {
  DiaAlphPriceAdapter,
  MockDiaRegistry,
  type MockDiaRegistryTypes,
} from '../../artifacts/ts'
import { fungibleTestContract, setupTestProvider } from '../helpers'

describe('DiaAlphPriceAdapter', () => {
  beforeAll(setupTestProvider)

  const feedKey = '414c50482f555344' // hex of "ALPH/USD"
  const priceFromMock = 49_489_670_000_000_000n // $0.04949 at 1e18
  const timestampFromMock = 1_745_000_000_000n

  it('getValue delegates to the registry and returns (price, timestamp)', async () => {
    const registry = fungibleTestContract()
    const existingRegistry: MockDiaRegistryTypes.State = MockDiaRegistry.stateForTest(
      { price: priceFromMock, timestamp: timestampFromMock },
      { alphAmount: ONE_ALPH },
      registry.contractAddress,
    )

    const result = await DiaAlphPriceAdapter.tests.getValue({
      initialFields: { registryId: registry.contractId, feedKey },
      existingContracts: [existingRegistry],
    })
    const [price, timestamp] = result.returns
    expect(price).toBe(priceFromMock)
    expect(timestamp).toBe(timestampFromMock)
  })

  it('getPrice returns just the price', async () => {
    const registry = fungibleTestContract()
    const existingRegistry = MockDiaRegistry.stateForTest(
      { price: priceFromMock, timestamp: timestampFromMock },
      { alphAmount: ONE_ALPH },
      registry.contractAddress,
    )
    const result = await DiaAlphPriceAdapter.tests.getPrice({
      initialFields: { registryId: registry.contractId, feedKey },
      existingContracts: [existingRegistry],
    })
    expect(result.returns).toBe(priceFromMock)
  })

  it('getTimestamp returns just the timestamp', async () => {
    const registry = fungibleTestContract()
    const existingRegistry = MockDiaRegistry.stateForTest(
      { price: priceFromMock, timestamp: timestampFromMock },
      { alphAmount: ONE_ALPH },
      registry.contractAddress,
    )
    const result = await DiaAlphPriceAdapter.tests.getTimestamp({
      initialFields: { registryId: registry.contractId, feedKey },
      existingContracts: [existingRegistry],
    })
    expect(result.returns).toBe(timestampFromMock)
  })

  it('exposes its configured registry id and feed key', async () => {
    const registry = fungibleTestContract()
    const idResult = await DiaAlphPriceAdapter.tests.getRegistryId({
      initialFields: { registryId: registry.contractId, feedKey },
    })
    expect(idResult.returns).toBe(registry.contractId)

    const keyResult = await DiaAlphPriceAdapter.tests.getFeedKey({
      initialFields: { registryId: registry.contractId, feedKey },
    })
    expect(keyResult.returns).toBe(feedKey)
  })
})
