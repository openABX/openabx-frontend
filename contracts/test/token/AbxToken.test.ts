import { beforeAll, describe, expect, it } from "vitest";
import { ONE_ALPH } from "@alephium/web3";
import { AbxToken, type AbxTokenTypes } from "../../artifacts/ts";
import {
  ABX_TOTAL_SUPPLY,
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  hexString,
  inputFrom,
  setupTestProvider,
  U256_MAX,
} from "../helpers";

describe("AbxToken", () => {
  beforeAll(setupTestProvider);

  function baseFields(
    overrides: Partial<AbxTokenTypes.Fields> = {},
  ): AbxTokenTypes.Fields {
    return {
      symbol: hexString("ABX"),
      name: hexString("AlphBanX"),
      decimals: 9n,
      totalSupply: ABX_TOTAL_SUPPLY,
      ...overrides,
    };
  }

  it("exposes symbol, name, decimals, totalSupply", async () => {
    const symbol = await AbxToken.tests.getSymbol({
      initialFields: baseFields(),
    });
    expect(Buffer.from(symbol.returns, "hex").toString("utf-8")).toBe("ABX");

    const name = await AbxToken.tests.getName({ initialFields: baseFields() });
    expect(Buffer.from(name.returns, "hex").toString("utf-8")).toBe("AlphBanX");

    const decimals = await AbxToken.tests.getDecimals({
      initialFields: baseFields(),
    });
    expect(decimals.returns).toBe(9n);

    const supply = await AbxToken.tests.getTotalSupply({
      initialFields: baseFields(),
    });
    expect(supply.returns).toBe(ABX_TOTAL_SUPPLY);
  });

  it("self-burn by the holder decreases totalSupply", async () => {
    const fake = fungibleTestContract();
    const burnAmount = 10n * 10n ** 9n;
    const startSupply = ABX_TOTAL_SUPPLY;
    const result = await AbxToken.tests.burn({
      initialFields: baseFields({ totalSupply: startSupply }),
      contractAddress: fake.contractAddress,
      initialAsset: {
        alphAmount: ONE_ALPH,
        tokens: [{ id: fake.tokenId, amount: U256_MAX - startSupply }],
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
    });
    const state = result.contracts.find(
      (c): c is AbxTokenTypes.State =>
        c.codeHash === AbxToken.contract.codeHash,
    );
    expect(state!.fields.totalSupply).toBe(startSupply - burnAmount);
  });

  it("burn with from != caller reverts", async () => {
    const fake = fungibleTestContract();
    await expect(
      AbxToken.tests.burn({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: fake.tokenId, amount: U256_MAX - ABX_TOTAL_SUPPLY }],
        },
        inputAssets: [inputFrom(aliceAddress)],
        args: { from: bobAddress, amount: 1n }, // bob != aliceAddress (caller)
      }),
    ).rejects.toThrow(/AssertionFailed|100/);
  });

  it("burn with zero amount reverts", async () => {
    const fake = fungibleTestContract();
    await expect(
      AbxToken.tests.burn({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        initialAsset: {
          alphAmount: ONE_ALPH,
          tokens: [{ id: fake.tokenId, amount: U256_MAX - ABX_TOTAL_SUPPLY }],
        },
        inputAssets: [inputFrom(aliceAddress)],
        args: { from: aliceAddress, amount: 0n },
      }),
    ).rejects.toThrow(/AssertionFailed|100/);
  });
});
