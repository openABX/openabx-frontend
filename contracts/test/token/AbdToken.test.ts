import { beforeAll, describe, expect, it } from 'vitest'
import { DUST_AMOUNT, ONE_ALPH } from '@alephium/web3'
import { AbdToken, type AbdTokenTypes } from '../../artifacts/ts'
import {
  ABX_TOTAL_SUPPLY,
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  hexString,
  inputFrom,
  setupTestProvider,
  U256_MAX,
} from '../helpers'

describe('AbdToken', () => {
  beforeAll(setupTestProvider)

  function baseFields(
    overrides: Partial<AbdTokenTypes.Fields> = {},
  ): AbdTokenTypes.Fields {
    return {
      symbol: hexString('ABD'),
      name: hexString('ABD Token'),
      decimals: 9n,
      mintAuthority: aliceAddress,
      totalSupply: 0n,
      ...overrides,
    }
  }

  it('exposes symbol, name, decimals, totalSupply', async () => {
    const symbol = await AbdToken.tests.getSymbol({ initialFields: baseFields() })
    expect(Buffer.from(symbol.returns, 'hex').toString('utf-8')).toBe('ABD')

    const name = await AbdToken.tests.getName({ initialFields: baseFields() })
    expect(Buffer.from(name.returns, 'hex').toString('utf-8')).toBe('ABD Token')

    const decimals = await AbdToken.tests.getDecimals({ initialFields: baseFields() })
    expect(decimals.returns).toBe(9n)

    const supply = await AbdToken.tests.getTotalSupply({
      initialFields: baseFields({ totalSupply: 42n }),
    })
    expect(supply.returns).toBe(42n)

    const authority = await AbdToken.tests.getMintAuthority({ initialFields: baseFields() })
    expect(authority.returns).toBe(aliceAddress)
  })

  it('mint by authority increases totalSupply and transfers tokens out', async () => {
    const fake = fungibleTestContract()
    const mintAmount = 1_000n * 10n ** 9n
    const result = await AbdToken.tests.mint({
      initialFields: baseFields({ totalSupply: 0n }),
      contractAddress: fake.contractAddress,
      initialAsset: {
        alphAmount: ONE_ALPH,
        tokens: [{ id: fake.tokenId, amount: U256_MAX }],
      },
      inputAssets: [inputFrom(aliceAddress)],
      args: { to: bobAddress, amount: mintAmount },
    })
    const state = result.contracts.find(
      (c): c is AbdTokenTypes.State => c.codeHash === AbdToken.contract.codeHash,
    )
    expect(state).toBeDefined()
    expect(state!.fields.totalSupply).toBe(mintAmount)

    // Bob's output appears in txOutputs and carries the minted ABD.
    const deliveredToBob = result.txOutputs.find(
      (o) => o.address === bobAddress && o.tokens?.some((t) => t.id === fake.tokenId),
    )
    expect(deliveredToBob).toBeDefined()
    const bobAbdBalance = deliveredToBob!.tokens!.find((t) => t.id === fake.tokenId)!.amount
    expect(BigInt(bobAbdBalance)).toBe(mintAmount)
  })

  it('mint by non-authority reverts with NotAuthorized (100)', async () => {
    const fake = fungibleTestContract()
    await expect(
      AbdToken.tests.mint({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: fake.tokenId, amount: U256_MAX }],
        },
        inputAssets: [inputFrom(bobAddress)],
        args: { to: bobAddress, amount: 1n },
      }),
    ).rejects.toThrow(/NotAuthorized|100|AssertionFailed/)
  })

  it('mint with zero amount reverts with ZeroAmount (101)', async () => {
    const fake = fungibleTestContract()
    await expect(
      AbdToken.tests.mint({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: fake.tokenId, amount: U256_MAX }],
        },
        inputAssets: [inputFrom(aliceAddress)],
        args: { to: bobAddress, amount: 0n },
      }),
    ).rejects.toThrow(/ZeroAmount|101|AssertionFailed/)
  })

  it('burn by authority decreases totalSupply', async () => {
    const fake = fungibleTestContract()
    const startSupply = 500n * 10n ** 9n
    const burnAmount = 100n * 10n ** 9n
    const contractTokenBalance = U256_MAX - startSupply
    const result = await AbdToken.tests.burn({
      initialFields: baseFields({ totalSupply: startSupply }),
      contractAddress: fake.contractAddress,
      initialAsset: {
        alphAmount: ONE_ALPH,
        tokens: [{ id: fake.tokenId, amount: contractTokenBalance }],
      },
      inputAssets: [
        {
          address: aliceAddress,
          asset: {
            alphAmount: ONE_ALPH,
            tokens: [{ id: fake.tokenId, amount: burnAmount }],
          },
        },
      ],
      args: { from: aliceAddress, amount: burnAmount },
    })
    const state = result.contracts.find(
      (c): c is AbdTokenTypes.State => c.codeHash === AbdToken.contract.codeHash,
    )
    expect(state!.fields.totalSupply).toBe(startSupply - burnAmount)
  })

  it('burn by non-authority reverts', async () => {
    const fake = fungibleTestContract()
    await expect(
      AbdToken.tests.burn({
        initialFields: baseFields({ totalSupply: 10n }),
        contractAddress: fake.contractAddress,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: fake.tokenId, amount: U256_MAX - 10n }],
        },
        inputAssets: [
          {
            address: bobAddress,
            asset: { alphAmount: ONE_ALPH, tokens: [{ id: fake.tokenId, amount: 1n }] },
          },
        ],
        args: { from: bobAddress, amount: 1n },
      }),
    ).rejects.toThrow(/NotAuthorized|100|AssertionFailed/)
  })

  it('transferMintAuthority swaps the authority to bob', async () => {
    const fake = fungibleTestContract()
    const result = await AbdToken.tests.transferMintAuthority({
      initialFields: baseFields({ mintAuthority: aliceAddress }),
      contractAddress: fake.contractAddress,
      initialAsset: {
        alphAmount: ONE_ALPH,
        tokens: [{ id: fake.tokenId, amount: U256_MAX }],
      },
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: { newAuthority: bobAddress },
    })
    const state = result.contracts.find(
      (c): c is AbdTokenTypes.State => c.codeHash === AbdToken.contract.codeHash,
    )
    expect(state!.fields.mintAuthority).toBe(bobAddress)
  })

  it('transferMintAuthority by non-authority reverts', async () => {
    const fake = fungibleTestContract()
    await expect(
      AbdToken.tests.transferMintAuthority({
        initialFields: baseFields({ mintAuthority: aliceAddress }),
        contractAddress: fake.contractAddress,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: fake.tokenId, amount: U256_MAX }],
        },
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
        args: { newAuthority: bobAddress },
      }),
    ).rejects.toThrow(/NotAuthorized|100|AssertionFailed/)
  })

  it('ABX total supply constant matches GitBook tokenomics', () => {
    expect(ABX_TOTAL_SUPPLY).toBe(100_000_000_000_000_000n) // 100M at 9 decimals
  })
})
