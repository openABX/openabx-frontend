import { beforeAll, describe, expect, it } from "vitest";
import { binToHex, DUST_AMOUNT } from "@alephium/web3";
import { randomBytes } from "node:crypto";
import { Vesting, type VestingTypes } from "../../artifacts/ts";
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from "../helpers";

/**
 * Vesting unit tests — getters, pure schedule math, and access control.
 * Full schedule → claim lifecycle requires pre-populated map entries and
 * lands as devnet integration in Phase 7.
 */

const ABX_SCALE = 1_000_000_000n;
const TWELVE_MONTHS_MS = 31_536_000_000n;

function baseFields(
  overrides: Partial<VestingTypes.Fields> = {},
): VestingTypes.Fields {
  return {
    abxTokenId: binToHex(randomBytes(32)),
    admin: aliceAddress,
    creator: aliceAddress,
    totalAllocated: 0n,
    totalClaimed: 0n,
    ...overrides,
  };
}

describe("Vesting", () => {
  beforeAll(setupTestProvider);

  it("exposes constructor state via getters", async () => {
    const fields = baseFields();
    const adm = await Vesting.tests.getAdmin({ initialFields: fields });
    expect(adm.returns).toBe(aliceAddress);
    const creator = await Vesting.tests.getCreator({ initialFields: fields });
    expect(creator.returns).toBe(aliceAddress);
    const alloc = await Vesting.tests.getTotalAllocated({
      initialFields: fields,
    });
    expect(alloc.returns).toBe(0n);
    const claimed = await Vesting.tests.getTotalClaimed({
      initialFields: fields,
    });
    expect(claimed.returns).toBe(0n);
    const twelve = await Vesting.tests.getTwelveMonthsMs({
      initialFields: fields,
    });
    expect(twelve.returns).toBe(TWELVE_MONTHS_MS);
  });

  it("hasSchedule is false for an unknown beneficiary", async () => {
    const r = await Vesting.tests.hasSchedule({
      initialFields: baseFields(),
      args: { who: aliceAddress },
    });
    expect(r.returns).toBe(false);
  });

  it("vestedAt returns 0 for an unknown beneficiary", async () => {
    const r = await Vesting.tests.vestedAt({
      initialFields: baseFields(),
      args: { who: aliceAddress, nowMs: 999_999_999n },
    });
    expect(r.returns).toBe(0n);
  });

  it("claimableAt returns 0 for an unknown beneficiary", async () => {
    const r = await Vesting.tests.claimableAt({
      initialFields: baseFields(),
      args: { who: aliceAddress, nowMs: 999_999_999n },
    });
    expect(r.returns).toBe(0n);
  });

  describe("admin + creator mutators", () => {
    it("setAdmin by admin swaps the admin", async () => {
      const fake = fungibleTestContract();
      const result = await Vesting.tests.setAdmin({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newAdmin: bobAddress },
      });
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as VestingTypes.State;
      expect(state.fields.admin).toBe(bobAddress);
    });

    it("setAdmin by non-admin reverts (900)", async () => {
      const fake = fungibleTestContract();
      await expect(
        Vesting.tests.setAdmin({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { newAdmin: bobAddress },
        }),
      ).rejects.toThrow(/AssertionFailed|900/);
    });

    it("setCreator by admin retargets the creator role", async () => {
      const fake = fungibleTestContract();
      const result = await Vesting.tests.setCreator({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newCreator: bobAddress },
      });
      const state = result.contracts.find(
        (c) => c.address === fake.contractAddress,
      ) as unknown as VestingTypes.State;
      expect(state.fields.creator).toBe(bobAddress);
    });

    it("setCreator by non-admin reverts (900)", async () => {
      const fake = fungibleTestContract();
      await expect(
        Vesting.tests.setCreator({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { newCreator: bobAddress },
        }),
      ).rejects.toThrow(/AssertionFailed|900/);
    });
  });

  describe("createSchedule reverts", () => {
    it("non-creator caller reverts (901)", async () => {
      const fake = fungibleTestContract();
      await expect(
        Vesting.tests.createSchedule({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: {
            beneficiary: bobAddress,
            totalAbx: 1000n * ABX_SCALE,
            startMs: 1n,
            durationMs: TWELVE_MONTHS_MS,
            source: "6561726e2d6661726d696e67", // "earn-farming"
          },
        }),
      ).rejects.toThrow(/AssertionFailed|901/);
    });

    it("zero totalAbx reverts (904)", async () => {
      const fake = fungibleTestContract();
      await expect(
        Vesting.tests.createSchedule({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
          args: {
            beneficiary: bobAddress,
            totalAbx: 0n,
            startMs: 1n,
            durationMs: TWELVE_MONTHS_MS,
            source: "",
          },
        }),
      ).rejects.toThrow(/AssertionFailed|904/);
    });

    it("zero durationMs reverts (905)", async () => {
      const fake = fungibleTestContract();
      await expect(
        Vesting.tests.createSchedule({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
          args: {
            beneficiary: bobAddress,
            totalAbx: 100n,
            startMs: 1n,
            durationMs: 0n,
            source: "",
          },
        }),
      ).rejects.toThrow(/AssertionFailed|905/);
    });
  });

  describe("claim reverts", () => {
    it("claim for unknown beneficiary reverts (903)", async () => {
      const fake = fungibleTestContract();
      await expect(
        Vesting.tests.claim({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { beneficiary: aliceAddress },
        }),
      ).rejects.toThrow(/AssertionFailed|903/);
    });
  });
});
