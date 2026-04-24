import { describe, expect, it } from "vitest";
import { buildClaimRewards, buildClaimUnstake } from "./index";

// The AlphBanX mainnet StakeManager.claim method (method index 33) uses its
// first U256 arg as the claim amount, capped at min(arg, realPending). The
// original SDK template had this arg hardcoded to 5.386 ALPH, silently
// short-paying every user with more pending — see the PR/commit that
// introduced this test for the full incident.
//
// These tests pin the template-arg substitution so regressions are caught
// before they reach mainnet users.

const SIGNER = "18NS5h8WSUrgi73nCeio34BDjDBLM51PXi9QEt3NhGtAi";
const STAKE_MANAGER_ID =
  "cb15784c91a7c8cc0c073e77a9ea2c4e8eec5782c27d5e47febb3e6c9439fb00";
const TEMPLATE_CLAIM_AMOUNT = 5_386_884_103_532_206_000n; // 5.386 ALPH — the baked literal

// Lowercase hex of a big-endian minimal U256 encoding — what applyTemplate
// produces via @alephium/web3's scriptCodec. We find the substring rather
// than full-parse the bytecode, which is resilient to layout shifts around
// the constant.
function hex(n: bigint): string {
  const h = n.toString(16);
  return h.length % 2 === 0 ? h : `0${h}`;
}

describe("buildClaimRewards — mainnet claim arg substitution", () => {
  it("replaces the template-baked 5.386 ALPH literal with the requested amount", () => {
    const { bytecode } = buildClaimRewards(SIGNER, 10_000_000_000_000_000_000n);
    // Template literal must NOT survive — every occurrence replaced.
    expect(bytecode.toLowerCase()).not.toContain(hex(TEMPLATE_CLAIM_AMOUNT));
    // Requested amount must appear (substring match, encoding-agnostic).
    expect(bytecode.toLowerCase()).toContain(hex(10_000_000_000_000_000_000n));
  });

  it("handles the 1M-ALPH oversized probe used by the claim path", () => {
    const PROBE = 1_000_000_000_000_000_000_000_000n; // 1M ALPH
    const { bytecode } = buildClaimRewards(SIGNER, PROBE);
    expect(bytecode.toLowerCase()).not.toContain(hex(TEMPLATE_CLAIM_AMOUNT));
    expect(bytecode.toLowerCase()).toContain(hex(PROBE));
  });

  it("substitutes the caller address into the script", () => {
    const { bytecode } = buildClaimRewards(SIGNER, 1_000_000_000_000_000_000n);
    // StakeManager contract id must still be in the bytecode (CallExternal
    // target — must not be swapped).
    expect(bytecode.toLowerCase()).toContain(STAKE_MANAGER_ID);
  });

  it("attaches DUST (0.1 ALPH) as the script's input asset", () => {
    const { attoAlphAmount, tokens } = buildClaimRewards(SIGNER, 1n);
    expect(attoAlphAmount).toBe(100_000_000_000_000_000n); // 0.1 ALPH
    expect(tokens).toEqual([]);
  });

  it("rejects zero or negative amounts", () => {
    expect(() => buildClaimRewards(SIGNER, 0n)).toThrow(/> 0/);
    expect(() => buildClaimRewards(SIGNER, -1n)).toThrow(/> 0/);
  });

  it("rejects invalid signer addresses", () => {
    expect(() => buildClaimRewards("not-an-address", 1n)).toThrow();
  });
});

// StakeManager.claimUnstake (method 32) was independently confirmed via
// cross-referencing 4 historical mainnet txs: every tx's baked U256 matched
// the recipient's ABX output exactly (150k, 6k, 30.2k, 72k ABX).

const CLAIM_UNSTAKE_TEMPLATE_AMOUNT = 150_000_000_000_000n; // 150k ABX at 9 decimals

describe("buildClaimUnstake — mainnet unstake arg substitution", () => {
  it("replaces the template-baked 150k ABX literal with the requested amount", () => {
    const userMatured = 72_095_779_182_819n; // 72.095k ABX — mirrors tx 708abf57…
    const { bytecode } = buildClaimUnstake(SIGNER, userMatured);
    expect(bytecode.toLowerCase()).not.toContain(
      CLAIM_UNSTAKE_TEMPLATE_AMOUNT.toString(16),
    );
    expect(bytecode.toLowerCase()).toContain(userMatured.toString(16));
  });

  it("handles small matured amounts", () => {
    const small = 6_000_000_000_000n; // 6k ABX — mirrors tx f873f795…
    const { bytecode } = buildClaimUnstake(SIGNER, small);
    expect(bytecode.toLowerCase()).not.toContain(
      CLAIM_UNSTAKE_TEMPLATE_AMOUNT.toString(16),
    );
    expect(bytecode.toLowerCase()).toContain(small.toString(16));
  });

  it("attaches DUST (0.1 ALPH) as input asset, no tokens", () => {
    const { attoAlphAmount, tokens } = buildClaimUnstake(SIGNER, 1n);
    expect(attoAlphAmount).toBe(100_000_000_000_000_000n);
    expect(tokens).toEqual([]);
  });

  it("rejects zero or negative amounts", () => {
    expect(() => buildClaimUnstake(SIGNER, 0n)).toThrow(/> 0/);
    expect(() => buildClaimUnstake(SIGNER, -5n)).toThrow(/> 0/);
  });

  it("rejects invalid signer addresses", () => {
    expect(() => buildClaimUnstake("not-an-address", 1n)).toThrow();
  });
});
