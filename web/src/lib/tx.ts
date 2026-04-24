// Wallet-signed transaction helpers. Every state-changing action a user can
// take on a protocol page lands here. The actual call into the wallet
// provider happens via the .transact.xxx methods on the typed contract
// instances generated from the Ralph artifacts (@openabx/contracts).
//
// Writes currently work on networks where we deployed our clean-room
// contracts (devnet, testnet). Mainnet writes are gated until we observe
// AlphBanX's method-index ABI from on-chain transactions — tracked in
// docs/07-mainnet-write-path.md. `canTransact(network)` centralizes the
// policy so pages can disable buttons without scattering the check.

import { DUST_AMOUNT, ONE_ALPH, type SignerProvider } from "@alephium/web3";
import {
  AuctionPool,
  BorrowerOperations,
  StakeManager,
  Vesting,
} from "@openabx/contracts";
import type { MainnetOperation, Network, PreparedTx } from "@openabx/sdk";
import {
  buildAddCollateral as mnBuildAddCollateral,
  buildClaimRewards as mnBuildClaimRewards,
  buildClaimUnstake as mnBuildClaimUnstake,
  buildCloseLoan as mnBuildCloseLoan,
  buildOpenLoan as mnBuildOpenLoan,
  buildPoolClaim as mnBuildPoolClaim,
  buildPoolDeposit as mnBuildPoolDeposit,
  buildPoolWithdraw as mnBuildPoolWithdraw,
  buildRedeemMainnet as mnBuildRedeem,
  buildRepay as mnBuildRepay,
  buildRequestUnstake as mnBuildRequestUnstake,
  buildStake as mnBuildStake,
  buildWithdrawCollateral as mnBuildWithdrawCollateral,
  canMainnetWrite,
  fetchMainnetStakePosition,
  getNetworkConfig,
  resolveAddress,
  simulateScript,
} from "@openabx/sdk";
import { tokenIdFromAddress } from "./user-position";

export function canTransact(network: Network): boolean {
  return getNetworkConfig(network).isOpenAbxDeployment;
}

/**
 * Per-operation gate for mainnet. Returns true on testnet/devnet for every
 * operation (our typed clients handle those) and only for simulation-
 * verified operations on mainnet.
 */
export function canTransactOp(network: Network, op: MainnetOperation): boolean {
  if (getNetworkConfig(network).isOpenAbxDeployment) return true;
  return canMainnetWrite(op);
}

async function submitPrepared(
  network: Network,
  signer: SignerProvider,
  prepared: PreparedTx,
): Promise<TxResult> {
  const account = await signer.getSelectedAccount();
  const signerAddress = account.address;
  // Defense in depth: simulate before sign to catch any bytecode regression.
  const sim = await simulateScript(
    getNetworkConfig(network).nodeUrl,
    prepared.bytecode,
    signerAddress,
    {
      attoAlphAmount: prepared.attoAlphAmount + ONE_ALPH, // buffer for gas
      tokens: prepared.tokens,
    },
  );
  if (!sim.ok) {
    throw new Error(`Simulation failed (would revert on-chain): ${sim.error}`);
  }
  const res = await signer.signAndSubmitExecuteScriptTx({
    signerAddress,
    bytecode: prepared.bytecode,
    attoAlphAmount: prepared.attoAlphAmount.toString(),
    tokens: prepared.tokens.map((t) => ({
      id: t.id,
      amount: t.amount.toString(),
    })),
  });
  return { txId: res.txId };
}

// -------- Common helpers -----------------------------------------------------

function requireSigner(signer: SignerProvider | undefined): SignerProvider {
  if (!signer) throw new Error("Wallet not connected");
  return signer;
}

function requireAddress(
  network: Network,
  role: Parameters<typeof resolveAddress>[1],
): string {
  const addr = resolveAddress(network, role);
  if (!addr)
    throw new Error(
      `${role} is not deployed on ${network}. Run pnpm -C contracts run deploy:${network}.`,
    );
  return addr;
}

export interface TxResult {
  txId: string;
}

// -------- Borrow / Loan ------------------------------------------------------

export interface OpenLoanParams {
  collateralAlphAtto: bigint; // ALPH collateral (1e18)
  borrowAbdAtto: bigint; // ABD debt (1e9)
  interestRate1e18: bigint; // one of 8 tier values
}

export async function openLoan(
  network: Network,
  signer: SignerProvider,
  params: OpenLoanParams,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const prepared = mnBuildOpenLoan(
      params.collateralAlphAtto,
      params.borrowAbdAtto,
      params.interestRate1e18,
    );
    return submitPrepared(network, signer, prepared);
  }
  const boAddr = requireAddress(network, "borrowerOperations");
  const bo = BorrowerOperations.at(boAddr);
  const res = await bo.transact.openLoan({
    signer,
    args: {
      collateralAmount: params.collateralAlphAtto,
      borrowAmount: params.borrowAbdAtto,
      interestRate: params.interestRate1e18,
    },
    attoAlphAmount: params.collateralAlphAtto + ONE_ALPH,
  });
  return { txId: res.txId };
}

export async function addCollateral(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    return submitPrepared(network, signer, mnBuildAddCollateral(amountAtto));
  }
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const res = await bo.transact.addCollateral({
    signer,
    args: { amount: amountAtto },
    attoAlphAmount: amountAtto + DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function withdrawCollateral(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const account = await signer.getSelectedAccount();
    return submitPrepared(
      network,
      signer,
      mnBuildWithdrawCollateral(amountAtto, account.address),
    );
  }
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const res = await bo.transact.withdrawCollateral({
    signer,
    args: { amount: amountAtto },
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function borrowMore(
  network: Network,
  signer: SignerProvider,
  additionalDebtAtto: bigint,
): Promise<TxResult> {
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const res = await bo.transact.borrowMore({
    signer,
    args: { additionalDebt: additionalDebtAtto },
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function repay(
  network: Network,
  signer: SignerProvider,
  ownerAddress: string,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    return submitPrepared(network, signer, mnBuildRepay(amountAbdAtto));
  }
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const abdId = tokenIdFromAddress(requireAddress(network, "abdToken"));
  if (!abdId) throw new Error("ABD token id could not be derived");
  const res = await bo.transact.repay({
    signer,
    args: { owner: ownerAddress, amount: amountAbdAtto },
    tokens: [{ id: abdId, amount: amountAbdAtto }],
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function closeLoan(
  network: Network,
  signer: SignerProvider,
  remainingDebtAbdAtto: bigint = 0n,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const account = await signer.getSelectedAccount();
    return submitPrepared(
      network,
      signer,
      mnBuildCloseLoan(remainingDebtAbdAtto, account.address),
    );
  }
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const res = await bo.transact.closeLoan({
    signer,
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

// -------- Redemption / Liquidation -------------------------------------------

export async function redeem(
  network: Network,
  signer: SignerProvider,
  targetOwner: string,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    return submitPrepared(
      network,
      signer,
      mnBuildRedeem(targetOwner, amountAbdAtto),
    );
  }
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const abdId = tokenIdFromAddress(requireAddress(network, "abdToken"));
  if (!abdId) throw new Error("ABD token id could not be derived");
  const res = await bo.transact.redeem({
    signer,
    args: { owner: targetOwner, amount: amountAbdAtto },
    tokens: [{ id: abdId, amount: amountAbdAtto }],
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function liquidate(
  network: Network,
  signer: SignerProvider,
  targetOwner: string,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    throw new Error(
      "Mainnet liquidate is pending — no observed sample tx yet in our catalog. " +
        "Liquidations are typically bot-driven; once one lands with a clear " +
        "token-flow signature, the cataloguer will surface it.",
    );
  }
  const bo = BorrowerOperations.at(
    requireAddress(network, "borrowerOperations"),
  );
  const res = await bo.transact.liquidate({
    signer,
    args: { owner: targetOwner },
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

// -------- Auction pools ------------------------------------------------------

export type PoolTier = 500 | 1000 | 1500 | 2000;

export function poolRoleForTier(
  tier: PoolTier,
): Parameters<typeof resolveAddress>[1] {
  switch (tier) {
    case 500:
      return "auctionPool5";
    case 1000:
      return "auctionPool10";
    case 1500:
      return "auctionPool15";
    case 2000:
      return "auctionPool20";
  }
}

export async function depositToPool(
  network: Network,
  signer: SignerProvider,
  tier: PoolTier,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    return submitPrepared(
      network,
      signer,
      mnBuildPoolDeposit(tier, amountAbdAtto),
    );
  }
  const pool = AuctionPool.at(requireAddress(network, poolRoleForTier(tier)));
  const abdId = tokenIdFromAddress(requireAddress(network, "abdToken"));
  if (!abdId) throw new Error("ABD token id could not be derived");
  const res = await pool.transact.deposit({
    signer,
    args: { amount: amountAbdAtto },
    tokens: [{ id: abdId, amount: amountAbdAtto }],
    attoAlphAmount: ONE_ALPH,
  });
  return { txId: res.txId };
}

export async function withdrawFromPool(
  network: Network,
  signer: SignerProvider,
  tier: PoolTier,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const account = await signer.getSelectedAccount();
    return submitPrepared(
      network,
      signer,
      mnBuildPoolWithdraw(tier, amountAbdAtto, account.address),
    );
  }
  const pool = AuctionPool.at(requireAddress(network, poolRoleForTier(tier)));
  const res = await pool.transact.withdraw({
    signer,
    args: { amount: amountAbdAtto },
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function claimFromPool(
  network: Network,
  signer: SignerProvider,
  tier: PoolTier,
  claimableAlphAtto: bigint = 1n,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const account = await signer.getSelectedAccount();
    return submitPrepared(
      network,
      signer,
      mnBuildPoolClaim(tier, account.address, claimableAlphAtto),
    );
  }
  const pool = AuctionPool.at(requireAddress(network, poolRoleForTier(tier)));
  const res = await pool.transact.claim({
    signer,
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

// -------- Staking ------------------------------------------------------------

export async function stakeAbx(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    return submitPrepared(network, signer, mnBuildStake(amountAtto));
  }
  const sm = StakeManager.at(requireAddress(network, "stakeManager"));
  const abxId = tokenIdFromAddress(requireAddress(network, "abxToken"));
  if (!abxId) throw new Error("ABX token id could not be derived");
  const res = await sm.transact.stake({
    signer,
    args: { amount: amountAtto },
    tokens: [{ id: abxId, amount: amountAtto }],
    attoAlphAmount: ONE_ALPH,
  });
  return { txId: res.txId };
}

export async function requestUnstake(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    return submitPrepared(network, signer, mnBuildRequestUnstake(amountAtto));
  }
  const sm = StakeManager.at(requireAddress(network, "stakeManager"));
  const res = await sm.transact.requestUnstake({
    signer,
    args: { amount: amountAtto },
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function claimUnstake(
  network: Network,
  signer: SignerProvider,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const account = await signer.getSelectedAccount();
    return submitPrepared(
      network,
      signer,
      mnBuildClaimUnstake(account.address),
    );
  }
  const sm = StakeManager.at(requireAddress(network, "stakeManager"));
  const res = await sm.transact.claimUnstake({
    signer,
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

export async function claimStakingRewards(
  network: Network,
  signer: SignerProvider,
): Promise<TxResult> {
  requireSigner(signer);
  if (network === "mainnet") {
    const account = await signer.getSelectedAccount();
    // Read real pending only to decide whether the claim is worth submitting.
    // We DON'T pass `pos.pendingRewardsAlphAtto` as the claim arg: rewards
    // accrue continuously, so by the time the signed tx lands on-chain the
    // true pending is slightly higher than what we probed. Instead pass an
    // oversized arg (1M ALPH) — the StakeManager caps at min(arg, pending)
    // so the user drains whatever is actually available at tx-inclusion
    // time. This is the same arg shape used by the read-side probe.
    const pos = await fetchMainnetStakePosition(network, account.address);
    if (pos.pendingRewardsAlphAtto <= 0n) {
      throw new Error("No claimable ALPH rewards");
    }
    const OVERSIZED_CLAIM_ATTO = 1_000_000_000_000_000_000_000_000n; // 1M ALPH
    return submitPrepared(
      network,
      signer,
      mnBuildClaimRewards(account.address, OVERSIZED_CLAIM_ATTO),
    );
  }
  const sm = StakeManager.at(requireAddress(network, "stakeManager"));
  const res = await sm.transact.claim({
    signer,
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}

// -------- Vesting ------------------------------------------------------------

export async function claimVesting(
  network: Network,
  signer: SignerProvider,
  beneficiary: string,
): Promise<TxResult> {
  const v = Vesting.at(requireAddress(network, "vesting"));
  const res = await v.transact.claim({
    signer,
    args: { beneficiary },
    attoAlphAmount: DUST_AMOUNT,
  });
  return { txId: res.txId };
}
