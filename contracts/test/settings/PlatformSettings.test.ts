import { beforeAll, describe, expect, it } from "vitest";
import { DUST_AMOUNT } from "@alephium/web3";
import {
  PlatformSettings,
  type PlatformSettingsTypes,
} from "../../artifacts/ts";
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from "../helpers";

describe("PlatformSettings", () => {
  beforeAll(setupTestProvider);

  const emptyId =
    "0000000000000000000000000000000000000000000000000000000000000000";

  function baseFields(
    overrides: Partial<PlatformSettingsTypes.Fields> = {},
  ): PlatformSettingsTypes.Fields {
    return {
      admin: aliceAddress,
      abdToken: emptyId,
      abxToken: emptyId,
      loanManager: emptyId,
      borrowerOperations: emptyId,
      auctionManager: emptyId,
      stakeManager: emptyId,
      vesting: emptyId,
      diaAlphPriceAdapter: emptyId,
      abdPriceOracle: emptyId,
      circuitBreaker: emptyId,
      ...overrides,
    };
  }

  it("getAdmin returns the admin address", async () => {
    const result = await PlatformSettings.tests.getAdmin({
      initialFields: baseFields(),
    });
    expect(result.returns).toBe(aliceAddress);
  });

  it("setAdmin by admin works", async () => {
    const fake = fungibleTestContract();
    const result = await PlatformSettings.tests.setAdmin({
      initialFields: baseFields({ admin: aliceAddress }),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: { newAdmin: bobAddress },
    });
    const state = result.contracts.find(
      (c): c is PlatformSettingsTypes.State =>
        c.codeHash === PlatformSettings.contract.codeHash,
    );
    expect(state!.fields.admin).toBe(bobAddress);
  });

  it("setAdmin by non-admin reverts with NotAdmin (100)", async () => {
    const fake = fungibleTestContract();
    await expect(
      PlatformSettings.tests.setAdmin({
        initialFields: baseFields({ admin: aliceAddress }),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
        args: { newAdmin: bobAddress },
      }),
    ).rejects.toThrow(/AssertionFailed|100/);
  });

  const contractSetters = [
    ["setAbdToken", "abdToken"],
    ["setAbxToken", "abxToken"],
    ["setLoanManager", "loanManager"],
    ["setBorrowerOperations", "borrowerOperations"],
    ["setAuctionManager", "auctionManager"],
    ["setStakeManager", "stakeManager"],
    ["setVesting", "vesting"],
    ["setDiaAlphPriceAdapter", "diaAlphPriceAdapter"],
    ["setAbdPriceOracle", "abdPriceOracle"],
    ["setCircuitBreaker", "circuitBreaker"],
  ] as const;

  for (const [setter, fieldName] of contractSetters) {
    it(`${setter} updates ${fieldName} when admin calls it`, async () => {
      const fake = fungibleTestContract();
      const newRef = "aa".repeat(32);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tests = PlatformSettings.tests as any;
      const result = await tests[setter]({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newRef },
      });
      const state = result.contracts.find(
        (c: { codeHash: string }) =>
          c.codeHash === PlatformSettings.contract.codeHash,
      ) as PlatformSettingsTypes.State;
      expect(
        state.fields[fieldName as keyof PlatformSettingsTypes.Fields],
      ).toBe(newRef);
    });
  }

  it("setLoanManager by non-admin reverts", async () => {
    const fake = fungibleTestContract();
    await expect(
      PlatformSettings.tests.setLoanManager({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
        args: { newRef: "bb".repeat(32) },
      }),
    ).rejects.toThrow(/AssertionFailed|100/);
  });
});
