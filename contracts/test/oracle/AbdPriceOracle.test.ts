import { beforeAll, describe, expect, it } from 'vitest'
import { AbdPriceOracle } from '../../artifacts/ts'
import { PRECISION_1E18, setupTestProvider } from '../helpers'

describe('AbdPriceOracle', () => {
  beforeAll(setupTestProvider)

  const fields = { precision: PRECISION_1E18 }

  it('returns the precision constant as the price', async () => {
    const result = await AbdPriceOracle.tests.getPrice({ initialFields: fields })
    expect(result.returns).toBe(PRECISION_1E18)
  })

  it('returns the precision via getPrecision()', async () => {
    const result = await AbdPriceOracle.tests.getPrecision({ initialFields: fields })
    expect(result.returns).toBe(PRECISION_1E18)
  })

  it('getValue returns (price, timestamp)', async () => {
    const result = await AbdPriceOracle.tests.getValue({ initialFields: fields })
    const [price, timestamp] = result.returns
    expect(price).toBe(PRECISION_1E18)
    expect(typeof timestamp).toBe('bigint')
    expect(timestamp).toBeGreaterThan(0n)
  })

  it('getTimestamp returns a positive number', async () => {
    const result = await AbdPriceOracle.tests.getTimestamp({ initialFields: fields })
    expect(result.returns).toBeGreaterThan(0n)
  })
})
