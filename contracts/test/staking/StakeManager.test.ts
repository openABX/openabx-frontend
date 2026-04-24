import { beforeAll, describe, expect, it } from 'vitest'
import { addressFromContractId, binToHex, DUST_AMOUNT, ONE_ALPH } from '@alephium/web3'
import { randomBytes } from 'node:crypto'
import { StakeManager, type StakeManagerTypes } from '../../artifacts/ts'
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from '../helpers'

/**
 * StakeManager unit tests — scoped to:
 *   (a) getters + constructor state,
 *   (b) access control on admin mutators,
 *   (c) notifyRewards math (rewardIndex update),
 *   (d) revert paths on stake/unstake/claim entry points.
 *
 * Full stake → reward → claim lifecycle requires pre-populating map
 * entries in `existingContracts` — those end-to-end scenarios are covered
 * by the Phase 7 devnet integration suite.
 */

const FOURTEEN_DAYS_MS = 1_209_600_000n
const PRECISION = 1_000_000_000_000_000_000n
const ABX_SCALE = 1_000_000_000n

function baseFields(
  overrides: Partial<StakeManagerTypes.Fields> = {},
): StakeManagerTypes.Fields {
  return {
    abxTokenId: binToHex(randomBytes(32)),
    admin: aliceAddress,
    totalStakedAbx: 0n,
    rewardIndex: 0n,
    unstakeCooldownMs: FOURTEEN_DAYS_MS,
    ...overrides,
  }
}

describe('StakeManager', () => {
  beforeAll(setupTestProvider)

  it('exposes constructor state via getters', async () => {
    const fields = baseFields()
    const adm = await StakeManager.tests.getAdmin({ initialFields: fields })
    expect(adm.returns).toBe(aliceAddress)
    const cooldown = await StakeManager.tests.getUnstakeCooldownMs({ initialFields: fields })
    expect(cooldown.returns).toBe(FOURTEEN_DAYS_MS)
    const total = await StakeManager.tests.getTotalStakedAbx({ initialFields: fields })
    expect(total.returns).toBe(0n)
    const idx = await StakeManager.tests.getRewardIndex({ initialFields: fields })
    expect(idx.returns).toBe(0n)
  })

  it('pendingRewardsOf returns 0 for non-staker', async () => {
    const r = await StakeManager.tests.pendingRewardsOf({
      initialFields: baseFields(),
      args: { who: aliceAddress },
    })
    expect(r.returns).toBe(0n)
  })

  it('stakeOf returns 0 for non-staker', async () => {
    const r = await StakeManager.tests.stakeOf({
      initialFields: baseFields(),
      args: { who: aliceAddress },
    })
    expect(r.returns).toBe(0n)
  })

  describe('admin mutators', () => {
    it('setAdmin by admin swaps the admin', async () => {
      const fake = fungibleTestContract()
      const result = await StakeManager.tests.setAdmin({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newAdmin: bobAddress },
      })
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as StakeManagerTypes.State
      expect(state.fields.admin).toBe(bobAddress)
    })

    it('setAdmin by non-admin reverts with NotAdmin (800)', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.setAdmin({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { newAdmin: bobAddress },
        }),
      ).rejects.toThrow(/AssertionFailed|800/)
    })

    it('setUnstakeCooldownMs by admin updates the field', async () => {
      const fake = fungibleTestContract()
      const newCooldown = 7n * 24n * 60n * 60n * 1000n // 7 days
      const result = await StakeManager.tests.setUnstakeCooldownMs({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newCooldown },
      })
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as StakeManagerTypes.State
      expect(state.fields.unstakeCooldownMs).toBe(newCooldown)
    })

    it('setUnstakeCooldownMs rejects 0', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.setUnstakeCooldownMs({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
          args: { newCooldown: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|808/)
    })

    it('setUnstakeCooldownMs rejects > 60 days', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.setUnstakeCooldownMs({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
          args: { newCooldown: 5_184_000_001n }, // just over 60 days
        }),
      ).rejects.toThrow(/AssertionFailed|808/)
    })
  })

  describe('notifyRewards math', () => {
    it('no-op on rewardIndex when totalStakedAbx is 0 (ALPH donation)', async () => {
      const fake = fungibleTestContract()
      const result = await StakeManager.tests.notifyRewards({
        initialFields: baseFields({ totalStakedAbx: 0n }),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, ONE_ALPH * 10n)],
        args: { amount: ONE_ALPH },
      })
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as StakeManagerTypes.State
      // Index unchanged because no recipients.
      expect(state.fields.rewardIndex).toBe(0n)
    })

    it('increments rewardIndex by amount × PRECISION / totalStakedAbx', async () => {
      const fake = fungibleTestContract()
      const totalStaked = 1000n * ABX_SCALE
      const reward = 50n * PRECISION // 50 ALPH
      const result = await StakeManager.tests.notifyRewards({
        initialFields: baseFields({
          totalStakedAbx: totalStaked,
          rewardIndex: 0n,
        }),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, ONE_ALPH + reward)],
        args: { amount: reward },
      })
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as StakeManagerTypes.State
      const expectedIndex = (reward * PRECISION) / totalStaked
      expect(state.fields.rewardIndex).toBe(expectedIndex)
    })

    it('rewardIndex accumulates across multiple notifications', async () => {
      const fake = fungibleTestContract()
      const totalStaked = 500n * ABX_SCALE
      const startIndex = (10n * PRECISION * PRECISION) / totalStaked
      const reward = 5n * PRECISION
      const result = await StakeManager.tests.notifyRewards({
        initialFields: baseFields({
          totalStakedAbx: totalStaked,
          rewardIndex: startIndex,
        }),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, ONE_ALPH + reward)],
        args: { amount: reward },
      })
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as StakeManagerTypes.State
      expect(state.fields.rewardIndex).toBe(startIndex + (reward * PRECISION) / totalStaked)
    })

    it('rejects zero amount', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.notifyRewards({
          initialFields: baseFields({ totalStakedAbx: 100n }),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, ONE_ALPH)],
          args: { amount: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|801/)
    })
  })

  describe('entry-point reverts', () => {
    it('stake with zero amount reverts', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.stake({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, ONE_ALPH)],
          args: { amount: 0n },
        }),
      ).rejects.toThrow(/AssertionFailed|801/)
    })

    it('requestUnstake by non-staker reverts', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.requestUnstake({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
          args: { amount: 1n },
        }),
      ).rejects.toThrow(/AssertionFailed|802/)
    })

    it('claimUnstake by non-staker reverts', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.claimUnstake({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        }),
      ).rejects.toThrow(/AssertionFailed|802/)
    })

    it('claim by non-staker reverts', async () => {
      const fake = fungibleTestContract()
      await expect(
        StakeManager.tests.claim({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        }),
      ).rejects.toThrow(/AssertionFailed|802/)
    })
  })
})
