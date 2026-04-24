import { beforeAll, describe, expect, it } from "vitest";
import { addressFromContractId, binToHex, DUST_AMOUNT } from "@alephium/web3";
import { randomBytes } from "node:crypto";
import { AuctionManager, type AuctionManagerTypes } from "../../artifacts/ts";
import {
  aliceAddress,
  bobAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from "../helpers";

/**
 * AuctionManager unit tests — math + access control. The full cascade
 * (absorbDebt across all four pools) requires four deployed AuctionPool
 * instances as `existingContracts`; that end-to-end scenario is covered
 * by the Phase 7 devnet integration suite.
 */

const BPS_SCALE = 10_000n;
const ABD_SCALE = 1_000_000_000n; // 1e9
const PRECISION = 1_000_000_000_000_000_000n; // 1e18
const PRICE_5_CENTS = 50_000_000_000_000_000n; // $0.05 at 1e18

// Deterministic USD→ALPH atto conversion matching the contract formula.
function expectedAlphForDebt(
  debt: bigint,
  discountBps: bigint,
  price: bigint,
): bigint {
  return (
    (debt * (BPS_SCALE + discountBps) * PRECISION * ABD_SCALE) /
    (BPS_SCALE * price)
  );
}

function baseFields(
  overrides: Partial<AuctionManagerTypes.Fields> = {},
): AuctionManagerTypes.Fields {
  return {
    abdTokenId: binToHex(randomBytes(32)),
    admin: aliceAddress,
    loanManager: "",
    pool5: "",
    pool10: "",
    pool15: "",
    pool20: "",
    circuitBreaker: "", // empty in tests = requireHealthy is a no-op (audit O-02/D-23)
    ...overrides,
  };
}

function wiredFields(): AuctionManagerTypes.Fields {
  return baseFields({
    loanManager: binToHex(randomBytes(32)),
    pool5: binToHex(randomBytes(32)),
    pool10: binToHex(randomBytes(32)),
    pool15: binToHex(randomBytes(32)),
    pool20: binToHex(randomBytes(32)),
  });
}

describe("AuctionManager", () => {
  beforeAll(setupTestProvider);

  it("exposes configured fields via getters", async () => {
    const fields = wiredFields();
    const admin = await AuctionManager.tests.getAdmin({
      initialFields: fields,
    });
    expect(admin.returns).toBe(aliceAddress);
    const lm = await AuctionManager.tests.getLoanManager({
      initialFields: fields,
    });
    expect(lm.returns).toBe(fields.loanManager);
    const p5 = await AuctionManager.tests.getPool5({ initialFields: fields });
    expect(p5.returns).toBe(fields.pool5);
  });

  it("isWired is false when any reference is empty", async () => {
    const r1 = await AuctionManager.tests.isWired({
      initialFields: baseFields(),
    });
    expect(r1.returns).toBe(false);

    const missingOne = baseFields({
      loanManager: binToHex(randomBytes(32)),
      pool5: binToHex(randomBytes(32)),
      pool10: binToHex(randomBytes(32)),
      pool15: binToHex(randomBytes(32)),
      // pool20 missing
    });
    const r2 = await AuctionManager.tests.isWired({
      initialFields: missingOne,
    });
    expect(r2.returns).toBe(false);
  });

  it("isWired is true when all references are set", async () => {
    const r = await AuctionManager.tests.isWired({
      initialFields: wiredFields(),
    });
    expect(r.returns).toBe(true);
  });

  describe("computePoolShare", () => {
    it("returns zero when inputs are zero", async () => {
      const r = await AuctionManager.tests.computePoolShare({
        initialFields: baseFields(),
        args: {
          poolTotalAbd: 0n,
          discountBps: 500n,
          desiredDebt: 100n,
          maxAlph: 100n,
          price: PRICE_5_CENTS,
        },
      });
      expect(r.returns).toEqual([0n, 0n]);
    });

    it("pool absorbs full desired debt when it has capacity and ALPH is sufficient", async () => {
      // Pool has 1000 ABD, desired 500, price $0.05, 5% discount. MaxAlph huge.
      const desiredDebt = 500n * ABD_SCALE;
      const poolTotalAbd = 1000n * ABD_SCALE;
      const expectedAlph = expectedAlphForDebt(
        desiredDebt,
        500n,
        PRICE_5_CENTS,
      );
      // Sanity: 500 ABD × 1.05 / $0.05 = 10500 ALPH
      expect(expectedAlph).toBe(10_500n * PRECISION);

      const r = await AuctionManager.tests.computePoolShare({
        initialFields: baseFields(),
        args: {
          poolTotalAbd,
          discountBps: 500n,
          desiredDebt,
          maxAlph: 100_000n * PRECISION,
          price: PRICE_5_CENTS,
        },
      });
      const [debtAbsorbed, alphConsumed] = r.returns;
      expect(debtAbsorbed).toBe(desiredDebt);
      expect(alphConsumed).toBe(expectedAlph);
    });

    it("clamps debt to poolTotalAbd when desired exceeds pool size", async () => {
      const poolTotalAbd = 300n * ABD_SCALE;
      const desiredDebt = 1000n * ABD_SCALE;
      const expectedAlph = expectedAlphForDebt(
        poolTotalAbd,
        1000n,
        PRICE_5_CENTS,
      );

      const r = await AuctionManager.tests.computePoolShare({
        initialFields: baseFields(),
        args: {
          poolTotalAbd,
          discountBps: 1000n,
          desiredDebt,
          maxAlph: 100_000n * PRECISION,
          price: PRICE_5_CENTS,
        },
      });
      const [debtAbsorbed, alphConsumed] = r.returns;
      expect(debtAbsorbed).toBe(poolTotalAbd);
      expect(alphConsumed).toBe(expectedAlph);
    });

    it("clamps to maxAlph when collateral is the binding constraint", async () => {
      // Want to absorb 1000 ABD at 5%. That would need 10500 ALPH.
      // Give only 5000 ALPH: expect partial absorption.
      const desiredDebt = 1000n * ABD_SCALE;
      const poolTotalAbd = 10_000n * ABD_SCALE;
      const maxAlph = 5_000n * PRECISION;
      const r = await AuctionManager.tests.computePoolShare({
        initialFields: baseFields(),
        args: {
          poolTotalAbd,
          discountBps: 500n,
          desiredDebt,
          maxAlph,
          price: PRICE_5_CENTS,
        },
      });
      const [debtAbsorbed, alphConsumed] = r.returns;
      expect(alphConsumed).toBe(maxAlph);
      // Inverse formula: debt = alph × BPS × price / ((BPS + d) × PRECISION × ABD_SCALE)
      const expectedDebt =
        (maxAlph * BPS_SCALE * PRICE_5_CENTS) /
        ((BPS_SCALE + 500n) * PRECISION * ABD_SCALE);
      expect(debtAbsorbed).toBe(expectedDebt);
      // Sanity: 5000 ALPH × $0.05 = $250 USD of collateral; at 5% discount
      // absorbs $250 / 1.05 ≈ $238.095 ABD
      expect(debtAbsorbed).toBeGreaterThan(238n * ABD_SCALE);
      expect(debtAbsorbed).toBeLessThan(239n * ABD_SCALE);
    });

    it("20% tier returns ×1.2 more ALPH than 5% tier for same debt", async () => {
      const desiredDebt = 100n * ABD_SCALE;
      const a5 = await AuctionManager.tests.computePoolShare({
        initialFields: baseFields(),
        args: {
          poolTotalAbd: desiredDebt,
          discountBps: 500n,
          desiredDebt,
          maxAlph: 10_000_000n * PRECISION,
          price: PRICE_5_CENTS,
        },
      });
      const a20 = await AuctionManager.tests.computePoolShare({
        initialFields: baseFields(),
        args: {
          poolTotalAbd: desiredDebt,
          discountBps: 2000n,
          desiredDebt,
          maxAlph: 10_000_000n * PRECISION,
          price: PRICE_5_CENTS,
        },
      });
      // 20% discount pool receives 1.20 ALPH per $ vs 5% pool's 1.05.
      // Ratio 1.20 / 1.05 = 8/7. So a20/a5 == 1200/1050 == 8/7 at bigint precision.
      expect(a20.returns[1] * 1050n).toBe(a5.returns[1] * 1200n);
    });
  });

  describe("admin mutators", () => {
    it("setAdmin by admin swaps the admin", async () => {
      const fake = fungibleTestContract();
      const result = await AuctionManager.tests.setAdmin({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newAdmin: bobAddress },
      });
      const state = result.contracts.find(
        (c): c is AuctionManagerTypes.State =>
          c.codeHash === AuctionManager.contract.codeHash,
      );
      expect(state!.fields.admin).toBe(bobAddress);
    });

    it("setAdmin by non-admin reverts with NotAdmin (700)", async () => {
      const fake = fungibleTestContract();
      await expect(
        AuctionManager.tests.setAdmin({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: { newAdmin: bobAddress },
        }),
      ).rejects.toThrow(/AssertionFailed|700/);
    });

    it("setPools by admin wires four pool refs", async () => {
      const fake = fungibleTestContract();
      const p5 = binToHex(randomBytes(32));
      const p10 = binToHex(randomBytes(32));
      const p15 = binToHex(randomBytes(32));
      const p20 = binToHex(randomBytes(32));
      const result = await AuctionManager.tests.setPools({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { p5, p10, p15, p20 },
      });
      const state = result.contracts.find(
        (c): c is AuctionManagerTypes.State =>
          c.codeHash === AuctionManager.contract.codeHash,
      );
      expect(state!.fields.pool5).toBe(p5);
      expect(state!.fields.pool10).toBe(p10);
      expect(state!.fields.pool15).toBe(p15);
      expect(state!.fields.pool20).toBe(p20);
    });

    it("setPools by non-admin reverts", async () => {
      const fake = fungibleTestContract();
      await expect(
        AuctionManager.tests.setPools({
          initialFields: baseFields(),
          contractAddress: fake.contractAddress,
          inputAssets: [inputFrom(bobAddress, DUST_AMOUNT)],
          args: {
            p5: binToHex(randomBytes(32)),
            p10: binToHex(randomBytes(32)),
            p15: binToHex(randomBytes(32)),
            p20: binToHex(randomBytes(32)),
          },
        }),
      ).rejects.toThrow(/AssertionFailed|700/);
    });

    it("setLoanManager by admin updates the reference", async () => {
      const fake = fungibleTestContract();
      const newRef = binToHex(randomBytes(32));
      const result = await AuctionManager.tests.setLoanManager({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { newRef },
      });
      const state = result.contracts.find(
        (c): c is AuctionManagerTypes.State =>
          c.codeHash === AuctionManager.contract.codeHash,
      );
      expect(state!.fields.loanManager).toBe(newRef);
    });
  });

  describe("absorbDebt access control", () => {
    it("absorbDebt by non-LoanManager reverts with NotLoanManager (701)", async () => {
      const fake = fungibleTestContract();
      const wrongCaller = addressFromContractId(binToHex(randomBytes(32)));
      await expect(
        AuctionManager.tests.absorbDebt({
          initialFields: wiredFields(),
          contractAddress: fake.contractAddress,
          callerContractAddress: wrongCaller,
          inputAssets: [inputFrom(aliceAddress, 100n * PRECISION)],
          args: {
            loanDebt: 100n * ABD_SCALE,
            availableAlph: 50n * PRECISION,
            price: PRICE_5_CENTS,
            refundTo: aliceAddress,
          },
        }),
      ).rejects.toThrow(/AssertionFailed|701/);
    });

    it("absorbDebt when not wired reverts with PoolsNotWired (702)", async () => {
      const fake = fungibleTestContract();
      const lmId = binToHex(randomBytes(32));
      const lmAddress = addressFromContractId(lmId);
      await expect(
        AuctionManager.tests.absorbDebt({
          initialFields: baseFields({ loanManager: lmId }),
          contractAddress: fake.contractAddress,
          callerContractAddress: lmAddress,
          inputAssets: [inputFrom(aliceAddress, 100n * PRECISION)],
          args: {
            loanDebt: 100n * ABD_SCALE,
            availableAlph: 50n * PRECISION,
            price: PRICE_5_CENTS,
            refundTo: aliceAddress,
          },
        }),
      ).rejects.toThrow(/AssertionFailed|702/);
    });
  });
});
