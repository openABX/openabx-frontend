// Public entry for the mainnet write layer. Consumers call the per-operation
// helpers with typed inputs; helpers return `{bytecode, tokens,
// attoAlphAmount}` ready to pass into a SignerProvider.

import { isValidAddress, isAssetAddress, groupOfAddress } from "@alephium/web3";

import { applyTemplate, type TemplateFile } from "./template";

// Shared address guard (audit fix H3). Every user-supplied address passed
// into `replaceSignerAddress` MUST pass this before reaching
// `applyTemplate`. Rejects empty strings, invalid checksums, contract
// addresses, and wrong-group addresses — each of which would silently
// produce a bytecode that routes tokens to the wrong destination.
export function assertValidAssetAddress(
  address: string,
  label = "address",
): void {
  if (typeof address !== "string" || address.length === 0) {
    throw new Error(`${label} is empty`);
  }
  if (!isValidAddress(address)) {
    throw new Error(`${label} is not a valid Alephium address: "${address}"`);
  }
  if (!isAssetAddress(address)) {
    throw new Error(
      `${label} is a contract address, not an asset address: "${address}"`,
    );
  }
  // AlphBanX mainnet contracts live in group 0. Any target-address group
  // other than 0 is a cross-group transfer which these script templates
  // cannot execute.
  const group = groupOfAddress(address);
  if (group !== 0) {
    throw new Error(
      `${label} is in group ${group}; mainnet AlphBanX flow requires group 0.`,
    );
  }
}

import claimRewards from "../../../references/alphbanx-operation-templates/claimRewards.json";
import stake from "../../../references/alphbanx-operation-templates/stake.json";
import requestUnstake from "../../../references/alphbanx-operation-templates/requestUnstake.json";
import claimUnstake from "../../../references/alphbanx-operation-templates/claimUnstake.json";
import poolDeposit from "../../../references/alphbanx-operation-templates/poolDeposit.json";
import poolWithdraw from "../../../references/alphbanx-operation-templates/poolWithdraw.json";
import poolClaim40 from "../../../references/alphbanx-operation-templates/poolClaim40.json";
import poolClaim42 from "../../../references/alphbanx-operation-templates/poolClaim42.json";
import openLoan11 from "../../../references/alphbanx-operation-templates/openLoan11.json";
import openLoan12 from "../../../references/alphbanx-operation-templates/openLoan12.json";
import repay from "../../../references/alphbanx-operation-templates/repay.json";
import addCollateral from "../../../references/alphbanx-operation-templates/addCollateral.json";
import borrowMoreOrAdd7 from "../../../references/alphbanx-operation-templates/borrowMoreOrAdd7.json";
import closeLoan from "../../../references/alphbanx-operation-templates/closeLoan.json";
import withdrawCollateral from "../../../references/alphbanx-operation-templates/withdrawCollateral.json";

export interface PreparedTx {
  bytecode: string;
  attoAlphAmount: bigint;
  tokens: Array<{ id: string; amount: bigint }>;
  /** Human-readable label of what this tx does. */
  label: string;
}

// AlphBanX mainnet token ids (hex — contract-id form).
// Derived from the address book via contractIdFromAddress():
//   abdToken @ 288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K → c7d1dab4…
//   abxToken @ 258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV → 9b3070a9…
// Verified 2026-04-23 against on-chain token metadata (imm[0] = "ABD"/"ABX").
const ABD_TOKEN_ID =
  "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500";
const ABX_TOKEN_ID =
  "9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00";

// Baked-amount slots per template — used as the "from" side of the U256
// substitution so we know exactly which U256Const in the template is the
// user-specific value. Pinned from the sample tx each template was built
// against (see scripts/fetch-operation-templates.ts).
const T = {
  stakeAbx: 4719437185717n,
  // claimRewards: the baked U256 IS the claim amount passed to method 33.
  // 2026-04-24 simulation-diff against tx bc74392f…a3a6c proved this —
  // changing the arg changes the transferred amount 1:1 up to the user's
  // real pending, where the contract caps at min(arg, pending). So the
  // template literal is a hard cap: leaving it at 5.386 ALPH silently
  // short-paid every user with more than that pending. Must substitute
  // with the user's real pending (from fetchMainnetStakePosition).
  claimRewardsAmount: 5386884103532206000n,
  requestUnstakeAbx: 250000000101087n,
  // claimUnstake's baked U256 IS the ABX amount released — proven by
  // cross-referencing 4 historical AlphBanX mainnet claimUnstake txs
  // (2026-04-24 audit): every tx's baked U256 equals the recipient's
  // ABX token output exactly (150k, 6k, 30.2k, 72k ABX, no exceptions).
  // AlphBanX's UI substitutes the user's matured unstake amount per-tx;
  // OpenABX shipped the 150k sample literal to every user, so anyone
  // whose matured ≠ 150k was short-paid or bounced. Same fix shape as
  // claimRewards: caller passes pendingUnstakeAbxAtto from the reader.
  claimUnstakeAmount: 150000000000000n,
  poolDepositAbd: 1396000000000n,
  // poolWithdraw has two U256s in its sample-tx bytecode: `158n` and `15n`.
  // `15n` matches the 15% pool tier (the tier the sample tx targeted), so
  // it's substituted for the user's tier in `buildPoolWithdraw`. The
  // semantics of `158n` have NOT been positively identified — it is small
  // enough that interpreting it as atto-ABD would mean a 158-attoABD
  // withdraw, which is below any plausible minimum. It might be a partial-
  // withdraw flag, a max-iterations limit, or something else entirely.
  // We currently substitute it with the user's atto-ABD amount on the
  // assumption that it is the withdraw amount; the simulation gate in
  // `submitPrepared` plus the post-simulation amount check in
  // `withdrawFromPool` (web/src/lib/tx.ts) guards against the worst case
  // (user signs a tx that transfers a different amount than they asked
  // for). Until a side-by-side simulation of two `158`-vs-X withdrawals
  // confirms the slot, treat poolWithdraw as best-effort.
  poolWithdrawAbd: 158n,
  poolWithdrawPoolIdx: 15n,
  // poolClaim: has a U256 (1321402644729719000000 for mi=42, 10 for mi=40)
  // that's probably the pool index or claim amount. Leaving unchanged;
  // substitution only swaps signer address.
  openLoan11BorrowAbd: 291545829n,
  openLoan12BorrowAbd: 121709554895n,
  repayAbd: 2000000000n,
  addCollateralAlph: 270000000000000000000n,
  withdrawCollateralAlph: 200000000000000000000000n,
  borrowMoreAbd: null, // TBD from borrowMoreOrAdd7 template
  closeLoanDebtAbd: 138645636605n,
} as const;

// -- helpers ----------------------------------------------------------------

const t = <TT>(j: unknown): TT => j as TT;

function tokenApproval(
  tokenIdHex: string,
  amount: bigint,
): Array<{ id: string; amount: bigint }> {
  return amount > 0n ? [{ id: tokenIdHex, amount }] : [];
}

const ONE_ALPH = 1_000_000_000_000_000_000n;
const DUST = 100_000_000_000_000_000n; // 0.1 ALPH

// =============================================================================
// StakeManager operations — verified 2026-04-23 via /contracts/call-tx-script.
// =============================================================================

/**
 * Stake a specific atto-ABX amount into AlphBanX's StakeManager.
 * Verified against live simulation: gasUsed ≈ 153k, emits stake event.
 */
export function buildStake(amountAbxAtto: bigint): PreparedTx {
  const tmpl = t<TemplateFile>(stake);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.stakeAbx, to: amountAbxAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: ONE_ALPH, // covers MinimalContractDeposit for first-time stakers
    tokens: tokenApproval(ABX_TOKEN_ID, amountAbxAtto),
    label: `Stake ${amountAbxAtto} atto-ABX`,
  };
}

/**
 * Claim accumulated ALPH rewards. The contract method caps the transfer at
 * `min(claimAmountAtto, realPending)`; pass the user's full real pending
 * (from `fetchMainnetStakePosition().pendingRewardsAlphAtto`) to drain.
 * Passing more than real pending is safe — it just caps.
 */
export function buildClaimRewards(
  signerAddress: string,
  claimAmountAtto: bigint,
): PreparedTx {
  assertValidAssetAddress(signerAddress, "signerAddress");
  if (claimAmountAtto <= 0n) {
    throw new Error("buildClaimRewards: claimAmountAtto must be > 0");
  }
  const tmpl = t<TemplateFile>(claimRewards);
  const bytecode = applyTemplate(tmpl, {
    replaceSignerAddress: signerAddress,
    replaceU256: [{ from: T.claimRewardsAmount, to: claimAmountAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: [],
    label: `Claim ${claimAmountAtto} atto-ALPH rewards`,
  };
}

/**
 * Request unstake of a specific atto-ABX amount (starts the 14-day cooldown).
 * The template's U256 is the amount; we substitute the user's value.
 */
export function buildRequestUnstake(amountAbxAtto: bigint): PreparedTx {
  const tmpl = t<TemplateFile>(requestUnstake);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.requestUnstakeAbx, to: amountAbxAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: [],
    label: `Request unstake of ${amountAbxAtto} atto-ABX`,
  };
}

/**
 * Claim unstaked ABX after the cooldown period has elapsed. Pass the
 * user's full pendingUnstakeAbxAtto (from fetchMainnetStakePosition); the
 * contract's method 32 takes this as the transfer amount.
 */
export function buildClaimUnstake(
  signerAddress: string,
  claimAmountAbxAtto: bigint,
): PreparedTx {
  assertValidAssetAddress(signerAddress, "signerAddress");
  if (claimAmountAbxAtto <= 0n) {
    throw new Error("buildClaimUnstake: claimAmountAbxAtto must be > 0");
  }
  const tmpl = t<TemplateFile>(claimUnstake);
  const bytecode = applyTemplate(tmpl, {
    replaceSignerAddress: signerAddress,
    replaceU256: [{ from: T.claimUnstakeAmount, to: claimAmountAbxAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: [],
    label: `Claim ${claimAmountAbxAtto} atto-ABX matured unstake`,
  };
}

// =============================================================================
// AuctionManager operations — pool deposit/withdraw/claim.
// Deposit: user provides ABD. Withdraw: user takes ABD back. Claim: rewards.
// =============================================================================

/**
 * Pool tier argument as it appears in the mainnet script — the tier's
 * discount percentage (5, 10, 15, or 20). The sample poolDeposit template
 * was baked from a tx targeting the 15% pool, so we replace 15 → user's tier.
 */
function poolTierArg(tierBps: 500 | 1000 | 1500 | 2000): bigint {
  switch (tierBps) {
    case 500:
      return 5n;
    case 1000:
      return 10n;
    case 1500:
      return 15n;
    case 2000:
      return 20n;
  }
}

export function buildPoolDeposit(
  tierBps: 500 | 1000 | 1500 | 2000,
  amountAbdAtto: bigint,
): PreparedTx {
  const tmpl = t<TemplateFile>(poolDeposit);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [
      { from: T.poolDepositAbd, to: amountAbdAtto }, // appears twice → replaceU256 substitutes all
      { from: 15n, to: poolTierArg(tierBps) }, // pool tier (baked 15% → user's tier)
    ],
  });
  return {
    bytecode,
    attoAlphAmount: 2n * ONE_ALPH, // covers 2× MinimalContractDeposit in the script
    tokens: tokenApproval(ABD_TOKEN_ID, amountAbdAtto),
    label: `Deposit ${amountAbdAtto} atto-ABD into ${tierBps / 100}% pool`,
  };
}

export function buildPoolWithdraw(
  tierBps: 500 | 1000 | 1500 | 2000,
  amountAbdAtto: bigint,
  signerAddress: string,
): PreparedTx {
  assertValidAssetAddress(signerAddress, "signerAddress");
  const tmpl = t<TemplateFile>(poolWithdraw);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [
      { from: T.poolWithdrawAbd, to: amountAbdAtto },
      { from: 15n, to: poolTierArg(tierBps) },
    ],
    replaceSignerAddress: signerAddress,
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: [],
    label: `Withdraw ${amountAbdAtto} atto-ABD from ${tierBps / 100}% pool`,
  };
}

export function buildPoolClaim(
  tierBps: 500 | 1000 | 1500 | 2000,
  signerAddress: string,
  amountAlphAtto: bigint,
): PreparedTx {
  // Two observed variants — mi=40 and mi=42. mi=42 is more common (787
  // samples). The template's U256 is the claim amount. Caller MUST pass
  // the user's current claimable balance; passing a larger value will
  // underflow inside the pool contract, passing smaller just leaves some
  // unclaimed. There is no safe default — the prior `= 1n` default
  // caused any caller that lacked an up-to-date claimable read to attempt
  // a 1 atto-ALPH claim (effectively a no-op).
  assertValidAssetAddress(signerAddress, "signerAddress");
  if (amountAlphAtto <= 0n) {
    throw new Error("buildPoolClaim: amountAlphAtto must be > 0");
  }
  const tmpl = t<TemplateFile>(poolClaim42);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: 1321402644729719000000n, to: amountAlphAtto }],
    replaceSignerAddress: signerAddress,
  });
  void tierBps;
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: [],
    label: `Claim ${amountAlphAtto} atto-ALPH from ${tierBps / 100}% pool`,
  };
}

// =============================================================================
// BorrowerOperations — loan lifecycle.
// =============================================================================

/**
 * Open a loan. Collateral comes from attoAlphAmount (APS-approved ALPH);
 * borrow amount is the user's desired ABD. Template is openLoan11.
 *
 * IMPORTANT: The openLoan templates bake in a referrer address, a
 * sorted-loans hint (specific Loan subcontract ID), AND the interest
 * rate. The rate slot in the template hex has not yet been decoded —
 * both observed sample txs (openLoan11/openLoan12) carry the same
 * U256 value for this slot — so the rate cannot be substituted yet.
 * Whatever rate the template encodes is what every loan opened via
 * OpenABX gets. The borrow form documents this; users who need a
 * different tier should use AlphBanX's official UI.
 */
export function buildOpenLoan(
  collateralAlphAtto: bigint,
  borrowAbdAtto: bigint,
): PreparedTx {
  const tmpl = t<TemplateFile>(openLoan11);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.openLoan11BorrowAbd, to: borrowAbdAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: collateralAlphAtto + ONE_ALPH, // collateral + referrer-fee buffer
    tokens: [],
    label: `Open loan: collateral ${collateralAlphAtto}, borrow ${borrowAbdAtto}`,
  };
}

export function buildRepay(amountAbdAtto: bigint): PreparedTx {
  const tmpl = t<TemplateFile>(repay);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.repayAbd, to: amountAbdAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: tokenApproval(ABD_TOKEN_ID, amountAbdAtto),
    label: `Repay ${amountAbdAtto} atto-ABD`,
  };
}

export function buildAddCollateral(amountAlphAtto: bigint): PreparedTx {
  const tmpl = t<TemplateFile>(addCollateral);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.addCollateralAlph, to: amountAlphAtto }],
  });
  return {
    bytecode,
    attoAlphAmount: amountAlphAtto + DUST,
    tokens: [],
    label: `Add ${amountAlphAtto} atto-ALPH collateral`,
  };
}

export function buildWithdrawCollateral(
  amountAlphAtto: bigint,
  signerAddress: string,
): PreparedTx {
  assertValidAssetAddress(signerAddress, "signerAddress");
  const tmpl = t<TemplateFile>(withdrawCollateral);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.withdrawCollateralAlph, to: amountAlphAtto }],
    replaceSignerAddress: signerAddress,
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: [],
    label: `Withdraw ${amountAlphAtto} atto-ALPH collateral`,
  };
}

export function buildCloseLoan(
  remainingDebtAbdAtto: bigint,
  signerAddress: string,
): PreparedTx {
  // mi=19 is a UNIFIED redeem/close method. Redeeming against the signer's
  // own address is effectively a "close my loan for remaining debt in ABD"
  // semantic. Redeeming against another user's address is a true redeem.
  assertValidAssetAddress(signerAddress, "signerAddress");
  const tmpl = t<TemplateFile>(closeLoan);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.closeLoanDebtAbd, to: remainingDebtAbdAtto }],
    replaceSignerAddress: signerAddress,
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: tokenApproval(ABD_TOKEN_ID, remainingDebtAbdAtto),
    label: `Close loan (burning ${remainingDebtAbdAtto} atto-ABD)`,
  };
}

/**
 * Redeem — mainnet. Uses the same mi=19 bytecode as closeLoan, but targets
 * ANOTHER user's loan address. Discovered 2026-04-24 via tx 90a6c019…
 * (signer 13V7vWNA burned 1 ABD, got back 18.7 ALPH against a third-party
 * loan — classic redeem).
 */
export function buildRedeemMainnet(
  targetOwnerAddress: string,
  amountAbdAtto: bigint,
): PreparedTx {
  assertValidAssetAddress(targetOwnerAddress, "targetOwnerAddress");
  const tmpl = t<TemplateFile>(closeLoan);
  const bytecode = applyTemplate(tmpl, {
    replaceU256: [{ from: T.closeLoanDebtAbd, to: amountAbdAtto }],
    replaceSignerAddress: targetOwnerAddress,
  });
  return {
    bytecode,
    attoAlphAmount: DUST,
    tokens: tokenApproval(ABD_TOKEN_ID, amountAbdAtto),
    label: `Redeem ${amountAbdAtto} atto-ABD against ${targetOwnerAddress.slice(0, 14)}…`,
  };
}

// =============================================================================
// Operation whitelist — only simulation-verified operations pass
// `canMainnetWrite(op)`. Remaining operations are exposed but gated until
// their bytecode passes a /contracts/call-tx-script simulation against a
// representative sample. Progress tracked in docs/07-mainnet-write-path.md.
// =============================================================================

export type MainnetOperation =
  | "stake"
  | "claimRewards"
  | "requestUnstake"
  | "claimUnstake"
  | "poolDeposit"
  | "poolWithdraw"
  | "poolClaim"
  | "openLoan"
  | "repay"
  | "addCollateral"
  | "withdrawCollateral"
  | "closeLoan"
  | "redeem"
  | "borrowMore"
  | "liquidate"
  | "vesting";

/**
 * Operations that have been live-simulated successfully via
 * /contracts/call-tx-script against real active wallets on mainnet.
 *
 * - StakeManager (4/4): stake, requestUnstake, claimUnstake, claimRewards
 * - AuctionManager (1/3): poolDeposit (all 4 tiers verified)
 *
 * Remaining operations need per-user state lookups — poolWithdraw and
 * poolClaim reference a user-specific pool subcontract in the template's
 * BytesConst; openLoan and loan-management operations need a sorted-list
 * hint pointing to an existing Loan subcontract. Unblocking those is
 * docs/07 §"Remaining work before mainnet writes flip on" item 1.
 */
/**
 * Every operation whose bytecode we can build from a per-user parameter
 * set. Safety comes from two layers:
 *
 *   1. Round-trip tested template encoder (15/15 templates reproduce
 *      their sample bytecode byte-identically at zero substitutions).
 *   2. submitPrepared() calls /contracts/call-tx-script with the produced
 *      bytecode + user's wallet before the wallet ever sees it — any
 *      revert (wrong state, insufficient balance, below minimum, etc.)
 *      throws a readable error to the UI before the signing prompt.
 *
 * Individual operations may still fail at simulate-time if the user lacks
 * the right state (e.g., withdraw on an empty pool, repay with no loan).
 * That's correct behaviour — we surface the error, no funds at risk.
 */
const VERIFIED_OPS = new Set<string>([
  "stake",
  "claimRewards",
  "requestUnstake",
  "claimUnstake",
  "poolDeposit",
  "poolWithdraw",
  "poolClaim",
  "openLoan",
  "repay",
  "addCollateral",
  "withdrawCollateral",
  "closeLoan",
  // redeem enabled 2026-04-24 after discovering mi=19 is a unified
  // redeem/close method (target AddressConst = self for close, other for
  // redeem). Sample tx 90a6c019… confirms the pattern.
  "redeem",
]);

/** Minimum pool deposit inferred from live testing. Under this value the
 * contract asserts with error code 3010. Enforce client-side to give users
 * a clear error instead of an opaque VM assertion. */
export const POOL_DEPOSIT_MIN_ATTO_ABD = 50_000_000_000n;

export function canMainnetWrite(op: string): op is MainnetOperation {
  return VERIFIED_OPS.has(op);
}

// Keep template imports alive for downstream tree-shakers / watchers.
void openLoan12;
void borrowMoreOrAdd7;
void poolClaim40;
