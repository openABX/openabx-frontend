import { beforeAll, describe, expect, it } from "vitest";
import { DUST_AMOUNT, ONE_ALPH } from "@alephium/web3";
import { CircuitBreaker, type CircuitBreakerTypes } from "../../artifacts/ts";
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from "../helpers";

describe("CircuitBreaker", () => {
  beforeAll(setupTestProvider);

  const ONE_HOUR_MILLIS = 60n * 60n * 1000n;

  function baseFields(
    overrides: Partial<CircuitBreakerTypes.Fields> = {},
  ): CircuitBreakerTypes.Fields {
    return {
      paused: false,
      pauser: aliceAddress,
      oracleStalenessMillis: 1_800_000n, // 30 min
      ...overrides,
    };
  }

  it("read-only accessors reflect constructor state", async () => {
    const fields = baseFields();
    const isPaused = await CircuitBreaker.tests.isPaused({
      initialFields: fields,
    });
    expect(isPaused.returns).toBe(false);

    const pauser = await CircuitBreaker.tests.getPauser({
      initialFields: fields,
    });
    expect(pauser.returns).toBe(aliceAddress);

    const stale = await CircuitBreaker.tests.getOracleStalenessMillis({
      initialFields: fields,
    });
    expect(stale.returns).toBe(1_800_000n);
  });

  it("requireNotPaused succeeds when not paused", async () => {
    await expect(
      CircuitBreaker.tests.requireNotPaused({
        initialFields: baseFields({ paused: false }),
      }),
    ).resolves.toBeDefined();
  });

  it("requireNotPaused reverts with Paused (101) when paused", async () => {
    await expect(
      CircuitBreaker.tests.requireNotPaused({
        initialFields: baseFields({ paused: true }),
      }),
    ).rejects.toThrow(/AssertionFailed|101/);
  });

  it("requireOracleFresh accepts a fresh timestamp (now)", async () => {
    const nowMillis = BigInt(Date.now());
    await expect(
      CircuitBreaker.tests.requireOracleFresh({
        initialFields: baseFields({ oracleStalenessMillis: ONE_HOUR_MILLIS }),
        args: { lastUpdateMillis: nowMillis },
      }),
    ).resolves.toBeDefined();
  });

  it("requireOracleFresh rejects a timestamp beyond the staleness threshold", async () => {
    const nowMillis = BigInt(Date.now());
    const staleMillis = nowMillis - 2n * ONE_HOUR_MILLIS;
    await expect(
      CircuitBreaker.tests.requireOracleFresh({
        initialFields: baseFields({ oracleStalenessMillis: ONE_HOUR_MILLIS }),
        args: { lastUpdateMillis: staleMillis },
      }),
    ).rejects.toThrow(/AssertionFailed|102/);
  });

  it("pauser can pause and unpause", async () => {
    const fake = fungibleTestContract();
    const paused = await CircuitBreaker.tests.pause({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
    });
    const s1 = paused.contracts.find(
      (c): c is CircuitBreakerTypes.State =>
        c.codeHash === CircuitBreaker.contract.codeHash,
    );
    expect(s1!.fields.paused).toBe(true);

    const unpaused = await CircuitBreaker.tests.unpause({
      initialFields: baseFields({ paused: true }),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
    });
    const s2 = unpaused.contracts.find(
      (c): c is CircuitBreakerTypes.State =>
        c.codeHash === CircuitBreaker.contract.codeHash,
    );
    expect(s2!.fields.paused).toBe(false);
  });

  it("non-pauser pause reverts", async () => {
    const fake = fungibleTestContract();
    await expect(
      CircuitBreaker.tests.pause({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
      }),
    ).rejects.toThrow(/AssertionFailed|100/);
  });

  it("transferPauser swaps the pauser", async () => {
    const fake = fungibleTestContract();
    const result = await CircuitBreaker.tests.transferPauser({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: { newPauser: bobAddress },
    });
    const state = result.contracts.find(
      (c): c is CircuitBreakerTypes.State =>
        c.codeHash === CircuitBreaker.contract.codeHash,
    );
    expect(state!.fields.pauser).toBe(bobAddress);
  });

  it("setOracleStalenessMillis rejects 0", async () => {
    const fake = fungibleTestContract();
    await expect(
      CircuitBreaker.tests.setOracleStalenessMillis({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newMillis: 0n },
      }),
    ).rejects.toThrow(/AssertionFailed|103/);
  });

  it("setOracleStalenessMillis rejects > 1 day", async () => {
    const fake = fungibleTestContract();
    const overOneDay = 86_400_001n;
    await expect(
      CircuitBreaker.tests.setOracleStalenessMillis({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newMillis: overOneDay },
      }),
    ).rejects.toThrow(/AssertionFailed|103/);
  });

  it("setOracleStalenessMillis accepts a valid threshold", async () => {
    const fake = fungibleTestContract();
    const newThreshold = 60n * 60n * 1000n; // 1 hour
    const result = await CircuitBreaker.tests.setOracleStalenessMillis({
      initialFields: baseFields(),
      contractAddress: fake.contractAddress,
      inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
      args: { newMillis: newThreshold },
    });
    const state = result.contracts.find(
      (c): c is CircuitBreakerTypes.State =>
        c.codeHash === CircuitBreaker.contract.codeHash,
    );
    expect(state!.fields.oracleStalenessMillis).toBe(newThreshold);
  });
});
