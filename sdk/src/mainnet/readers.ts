// Mainnet-specific read helpers. Used by the frontend to fetch per-user
// state that our typed @openabx/contracts clients can't read (they use
// OpenABX's clean-room method indices, which don't match AlphBanX's).
//
// Observed 2026-04-23:
//   LoanManager.mi=23(address)       → ByteVec: user's Loan subcontract id
//   AuctionManager.mi=28(address)    → ByteVec: user's pool-position sub id

import { getNetworkConfig, type Network } from "../networks";
import { resolveAddress } from "../addresses";
import { buildClaimRewards } from "./index";
import { simulateScript } from "./template";

interface NodeCallResponse {
  type: string;
  returns?: Array<{ type: string; value: string }>;
  error?: string;
  gasUsed?: number;
}

// Audit fix H4: runtime shape validation before `as` casts. A malicious,
// proxy-cached, or misconfigured RPC endpoint can return arbitrary JSON;
// silently casting and then reading `.returns[0].value` as if it were
// trusted data is a quiet-failure footgun — missing fields surface as
// `undefined`, junk strings as plausible zeros, etc. Validate that the
// top-level shape is an object with string `type` and, if `returns` is
// present, that each entry matches `{type: string, value: string}` before
// handing the response back.
function isNodeCallResponse(x: unknown): x is NodeCallResponse {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj["type"] !== "string") return false;
  if (obj["returns"] !== undefined) {
    if (!Array.isArray(obj["returns"])) return false;
    for (const entry of obj["returns"]) {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      if (typeof e["type"] !== "string") return false;
      if (typeof e["value"] !== "string") return false;
    }
  }
  if (obj["error"] !== undefined && typeof obj["error"] !== "string")
    return false;
  if (obj["gasUsed"] !== undefined && typeof obj["gasUsed"] !== "number")
    return false;
  return true;
}

async function call(
  nodeUrl: string,
  address: string,
  methodIndex: number,
  args: Array<{ type: string; value: string }>,
): Promise<NodeCallResponse> {
  const res = await fetch(`${nodeUrl}/contracts/call-contract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group: 0, address, methodIndex, args }),
  });
  if (!res.ok) {
    return { type: "HttpError", error: `HTTP ${res.status}` };
  }
  const json: unknown = await res.json();
  if (!isNodeCallResponse(json)) {
    return {
      type: "MalformedResponse",
      error: `node response did not match expected NodeCallResponse shape`,
    };
  }
  return json;
}

// Helper: check that a hex string is lowercase hex of the expected length.
function isHexOfLen(v: string, len: number): boolean {
  if (v.length !== len) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    const digit = c >= 48 && c <= 57;
    const lower = c >= 97 && c <= 102;
    const upper = c >= 65 && c <= 70;
    if (!digit && !lower && !upper) return false;
  }
  return true;
}

/**
 * Returns the user's per-account Loan sub-contract id on AlphBanX's
 * mainnet, or null if the user has no loan. Wraps
 * `LoanManager.mi=23(address)`.
 */
export async function fetchMainnetLoanId(
  network: Network,
  userAddress: string,
): Promise<string | null> {
  const lm = resolveAddress(network, "loanManager");
  if (!lm) return null;
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const res = await call(nodeUrl, lm, 23, [
    { type: "Address", value: userAddress },
  ]);
  if (res.type !== "CallContractSucceeded" || !res.returns?.[0]) return null;
  const value = res.returns[0];
  if (value.type !== "ByteVec" || !isHexOfLen(value.value, 64)) return null;
  return value.value;
}

/**
 * Returns the user's AlphBanX mainnet pool-position sub-contract id, or
 * null if the user has never deposited. Wraps `AuctionManager.mi=28(address)`.
 *
 * Note: the method returns the same sub-contract id regardless of pool
 * tier — AlphBanX appears to use a single per-user subcontract that
 * tracks positions across all tiers.
 */
export async function fetchMainnetPoolPositionId(
  network: Network,
  userAddress: string,
): Promise<string | null> {
  const am = resolveAddress(network, "auctionManager");
  if (!am) return null;
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const res = await call(nodeUrl, am, 28, [
    { type: "Address", value: userAddress },
  ]);
  if (res.type !== "CallContractSucceeded" || !res.returns?.[0]) return null;
  const value = res.returns[0];
  if (value.type !== "ByteVec" || !isHexOfLen(value.value, 64)) return null;
  return value.value;
}

/**
 * Returns whether the user currently has an active Loan on mainnet. A cheap
 * check — just the loanIdOf lookup followed by a contract-exists query.
 */
export async function hasMainnetLoan(
  network: Network,
  userAddress: string,
): Promise<boolean> {
  const id = await fetchMainnetLoanId(network, userAddress);
  if (!id) return false;
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  try {
    const res = await fetch(`${nodeUrl}/contracts/${id}/state`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface MainnetStakePosition {
  stakedAbxAtto: bigint;
  pendingUnstakeAbxAtto: bigint;
  unstakeReadyAtMs: bigint;
  snapshotIndex: bigint;
  /** Exact pending ALPH rewards — the amount the contract would transfer
   * RIGHT NOW if the user claimed. Obtained by simulating a claim with an
   * oversized arg and reading the capped `txOutputs[0].attoAlphAmount`
   * minus the attached DUST. Reliable because the AlphBanX StakeManager
   * caps the payout at `min(arg, realPending)` (verified 2026-04-24 via
   * simulation-diff against tx bc74392f…a3a6c). */
  pendingRewardsAlphAtto: bigint;
}

export const EMPTY_MAINNET_STAKE: MainnetStakePosition = {
  stakedAbxAtto: 0n,
  pendingUnstakeAbxAtto: 0n,
  unstakeReadyAtMs: 0n,
  snapshotIndex: 0n,
  pendingRewardsAlphAtto: 0n,
};

interface ContractStateResponse {
  immFields: Array<{ type: string; value: string }>;
  mutFields: Array<{ type: string; value: string }>;
}

function isFieldSlot(x: unknown): x is { type: string; value: string } {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return typeof e["type"] === "string" && typeof e["value"] === "string";
}

function isContractStateResponse(x: unknown): x is ContractStateResponse {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  if (!Array.isArray(obj["immFields"]) || !Array.isArray(obj["mutFields"])) {
    return false;
  }
  for (const v of obj["immFields"] as unknown[]) {
    if (!isFieldSlot(v)) return false;
  }
  for (const v of obj["mutFields"] as unknown[]) {
    if (!isFieldSlot(v)) return false;
  }
  return true;
}

/**
 * Parse a /contracts/{addr}/state response, returning null if the body
 * doesn't match the expected shape. Adding this runtime guard (audit fix
 * H4) replaces the silent `as ContractStateResponse` cast that would let
 * a malformed response flow through and produce silent 0n values via
 * `decodeU256`.
 */
async function readContractState(
  nodeUrl: string,
  contractAddress: string,
): Promise<ContractStateResponse | null> {
  const res = await fetch(`${nodeUrl}/contracts/${contractAddress}/state`);
  if (!res.ok) return null;
  const json: unknown = await res.json();
  return isContractStateResponse(json) ? json : null;
}

function decodeU256(slot: { type: string; value: string } | undefined): bigint {
  if (!slot || slot.type !== "U256") return 0n;
  try {
    return BigInt(slot.value);
  } catch {
    return 0n;
  }
}

// 0.1 ALPH — the attoAlphAmount buildClaimRewards attaches, returned to the
// user as part of their asset output (not reward).
const CLAIM_ATTACHED_DUST_ATTO = 100_000_000_000_000_000n;

// 1,000,000 ALPH — effectively unbounded. The StakeManager claim caps at
// min(arg, realPending) (verified 2026-04-24 simulation-diff), so a probe
// arg this large lets the contract tell us realPending via the txOutputs.
// Any realistic user has < 1M ALPH in pending so the cap is always tight.
const CLAIM_PROBE_ATTO = 1_000_000_000_000_000_000_000_000n;

function isProbeOutput(
  x: unknown,
): x is { type: string; address: string; attoAlphAmount: string } {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e["type"] === "string" &&
    typeof e["address"] === "string" &&
    typeof e["attoAlphAmount"] === "string"
  );
}

/**
 * Probe the user's real pending ALPH rewards by simulating a claim with an
 * oversized arg. AlphBanX's StakeManager caps the transfer at
 * `min(arg, realPending)`, so `txOutputs[*].attoAlphAmount - DUST` summed
 * over asset outputs back to the user equals realPending. Returns 0n if
 * the user has nothing to claim (simulation reverts).
 *
 * Verified 2026-04-24 against wallet 18NS5h8W… (tx bc74392f…a3a6c):
 *   probe=15 ALPH → output 13.954 ALPH  (= 13.854 reward + 0.1 DUST)
 *   probe=18 ALPH → output 13.954 ALPH  (same cap confirms real pending)
 *   probe=1 ALPH  → output 1.1 ALPH     (arg < pending, no cap)
 */
async function probeMainnetClaimableRewards(
  network: Network,
  userAddress: string,
): Promise<bigint> {
  let bytecode: string;
  let attoAlphAmount: bigint;
  try {
    const built = buildClaimRewards(userAddress, CLAIM_PROBE_ATTO);
    bytecode = built.bytecode;
    attoAlphAmount = built.attoAlphAmount;
  } catch (err) {
    console.warn("[openabx] claim-probe: failed to build bytecode:", err);
    return 0n;
  }
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const sim = await simulateScript(nodeUrl, bytecode, userAddress, {
    attoAlphAmount,
  });
  if (!sim.ok) {
    // A revert means "no pending to claim" (or the contract rejected the
    // arg for some other reason). Distinguish a genuine empty state from a
    // network failure so the UI can show "0" confidently vs degrading.
    console.info(
      `[openabx] claim-probe: simulation did not succeed for ${userAddress}: ${sim.error ?? "unknown"}`,
    );
    return 0n;
  }
  const result = sim.result as { txOutputs?: unknown } | null | undefined;
  const rawOutputs = Array.isArray(result?.txOutputs) ? result!.txOutputs : [];
  let total = 0n;
  for (const o of rawOutputs) {
    if (!isProbeOutput(o)) continue;
    if (o.type !== "AssetOutput" || o.address !== userAddress) continue;
    try {
      total += BigInt(o.attoAlphAmount);
    } catch {
      /* skip malformed entry */
    }
  }
  return total > CLAIM_ATTACHED_DUST_ATTO
    ? total - CLAIM_ATTACHED_DUST_ATTO
    : 0n;
}

/**
 * Reads the user's live stake position from AlphBanX's mainnet
 * StakeManager.
 *
 *   1. `StakeManager.mi=28(userAddress)`  → user's stake-sub contract id
 *   2. `GET /contracts/<subAddr>/state`   → mutable fields:
 *        mut[0] snapshotIndex, mut[1] stakedAbxAtto,
 *        mut[2] pendingUnstakeAbxAtto, mut[3] unstakeReadyAtMs
 *      (layout confirmed 2026-04-23 against wallet 18NS5h8W…)
 *   3. Simulate claimRewards with a huge arg → real pending is the
 *      contract-capped transfer minus attached DUST. Replaces the earlier
 *      `(staked × delta) / 1e36` formula, which under-reported by ~1.6×
 *      for wallet 18NS5h8W… (shown 12 ALPH vs real 19.24 ALPH, 2026-04-24).
 */
export async function fetchMainnetStakePosition(
  network: Network,
  userAddress: string,
): Promise<MainnetStakePosition> {
  const sm = resolveAddress(network, "stakeManager");
  if (!sm) return EMPTY_MAINNET_STAKE;
  const nodeUrl = getNetworkConfig(network).nodeUrl;

  try {
    // 1. user stake sub id
    const subIdRes = await call(nodeUrl, sm, 28, [
      { type: "Address", value: userAddress },
    ]);
    const subIdHex =
      subIdRes.type === "CallContractSucceeded" &&
      subIdRes.returns?.[0]?.type === "ByteVec"
        ? subIdRes.returns[0].value
        : null;
    if (!subIdHex || !isHexOfLen(subIdHex, 64)) return EMPTY_MAINNET_STAKE;

    // Convert hex id to contract address
    const { addressFromContractId } = await import("@alephium/web3");
    const subAddr = addressFromContractId(subIdHex);

    // 2. fetch sub state (shape-validated)
    const state = await readContractState(nodeUrl, subAddr);
    if (!state) return EMPTY_MAINNET_STAKE;
    const snapshotIndex = decodeU256(state.mutFields[0]);
    const stakedAbxAtto = decodeU256(state.mutFields[1]);
    const pendingUnstakeAbxAtto = decodeU256(state.mutFields[2]);
    const unstakeReadyAtMs = decodeU256(state.mutFields[3]);

    // 3. exact pending rewards via claim-simulation probe
    const pendingRewardsAlphAtto = await probeMainnetClaimableRewards(
      network,
      userAddress,
    );

    return {
      stakedAbxAtto,
      pendingUnstakeAbxAtto,
      unstakeReadyAtMs,
      snapshotIndex,
      pendingRewardsAlphAtto,
    };
  } catch {
    return EMPTY_MAINNET_STAKE;
  }
}

export interface MainnetPoolPosition {
  tierBps: 500 | 1000 | 1500 | 2000;
  depositedAbdAtto: bigint;
  claimableAlphAtto: bigint;
  subAddress: string | null;
}

export interface MainnetPoolTvl {
  tierBps: 500 | 1000 | 1500 | 2000;
  totalAbdAtto: bigint;
  poolAddress: string;
}

/**
 * Fetch per-tier pool TVL. Uses the per-tier pool addresses we resolved via
 * `AuctionManager.mi=30(tierBps/100)` and cached in the SDK address book.
 * Each pool's mut[0] is the total ABD deposited (at 1e9 scale).
 */
export async function fetchMainnetPoolsTvl(
  network: Network,
): Promise<MainnetPoolTvl[]> {
  const tiers: Array<
    [500 | 1000 | 1500 | 2000, Parameters<typeof resolveAddress>[1]]
  > = [
    [500, "auctionPool5"],
    [1000, "auctionPool10"],
    [1500, "auctionPool15"],
    [2000, "auctionPool20"],
  ];
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const out: MainnetPoolTvl[] = [];
  for (const [bps, role] of tiers) {
    const addr = resolveAddress(network, role);
    if (!addr) continue;
    try {
      const st = await readContractState(nodeUrl, addr);
      if (!st) {
        out.push({ tierBps: bps, totalAbdAtto: 0n, poolAddress: addr });
        continue;
      }
      const total = decodeU256(st.mutFields[0]);
      out.push({ tierBps: bps, totalAbdAtto: total, poolAddress: addr });
    } catch {
      out.push({ tierBps: bps, totalAbdAtto: 0n, poolAddress: addr });
    }
  }
  return out;
}

export const EMPTY_MAINNET_POOL_POSITIONS: MainnetPoolPosition[] = [
  {
    tierBps: 500,
    depositedAbdAtto: 0n,
    claimableAlphAtto: 0n,
    subAddress: null,
  },
  {
    tierBps: 1000,
    depositedAbdAtto: 0n,
    claimableAlphAtto: 0n,
    subAddress: null,
  },
  {
    tierBps: 1500,
    depositedAbdAtto: 0n,
    claimableAlphAtto: 0n,
    subAddress: null,
  },
  {
    tierBps: 2000,
    depositedAbdAtto: 0n,
    claimableAlphAtto: 0n,
    subAddress: null,
  },
];

/**
 * Reads the user's pool position on AlphBanX mainnet.
 *
 *   1. `AuctionManager.mi=28(userAddress)` → user's pool-position sub id.
 *   2. `GET /contracts/<subAddr>/state` → mut[2] = deposited ABD (atto).
 *   3. `sub.mi=6()` → claimable ALPH (atto).
 *
 * Observed 2026-04-23 against wallet 13V7vWNA…:
 *   mut[0] snapshotP (1e36-scaled reward index)
 *   mut[1] snapshotS (1e36-scaled reward index)
 *   mut[2] deposited ABD
 *   sub.mi=6 returns claimable ALPH
 *
 * AlphBanX's pool accounting appears to use a single per-user sub that
 * tracks ONE tier at a time (switching tiers requires withdraw + redeposit).
 * The sub doesn't expose its current tier cleanly; we try best-effort to
 * detect it, but for the UI we report a single "pool position" rather than
 * per-tier breakdown. Per-tier TVL is still shown on /auction from
 * AuctionManager state.
 */
export async function fetchMainnetPoolPositions(
  network: Network,
  userAddress: string,
): Promise<MainnetPoolPosition[]> {
  const am = resolveAddress(network, "auctionManager");
  if (!am) return EMPTY_MAINNET_POOL_POSITIONS;
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  try {
    const subIdRes = await call(nodeUrl, am, 28, [
      { type: "Address", value: userAddress },
    ]);
    const subIdHex =
      subIdRes.type === "CallContractSucceeded" &&
      subIdRes.returns?.[0]?.type === "ByteVec"
        ? subIdRes.returns[0].value
        : null;
    if (!subIdHex || !isHexOfLen(subIdHex, 64)) {
      return EMPTY_MAINNET_POOL_POSITIONS;
    }

    const { addressFromContractId } = await import("@alephium/web3");
    const subAddr = addressFromContractId(subIdHex);

    const state = await readContractState(nodeUrl, subAddr);
    if (!state) return EMPTY_MAINNET_POOL_POSITIONS;

    const deposited = decodeU256(state.mutFields[2]);

    // Fetch claimable via sub.mi=6 (observed to return claimable ALPH)
    let claimable = 0n;
    try {
      const claimRes = await call(nodeUrl, subAddr, 6, []);
      if (
        claimRes.type === "CallContractSucceeded" &&
        claimRes.returns?.[0]?.type === "U256"
      ) {
        claimable = BigInt(claimRes.returns[0].value);
      }
    } catch {
      /* ignore — show 0 */
    }

    // If user has no deposit, return empty. Otherwise we don't know which
    // tier; report the deposit under the 15% slot (most popular from
    // observation), leave others at zero. UI on /auction shows a
    // "position" summary that's tier-agnostic.
    if (deposited === 0n) return EMPTY_MAINNET_POOL_POSITIONS;
    const tiers: Array<500 | 1000 | 1500 | 2000> = [500, 1000, 1500, 2000];
    return tiers.map((tier) => ({
      tierBps: tier,
      // Only report on one tier so we don't quadruple-count. The 15% tier
      // is AlphBanX's default deposit target per their UI; users can still
      // claim / withdraw via /auction.
      depositedAbdAtto: tier === 1500 ? deposited : 0n,
      claimableAlphAtto: tier === 1500 ? claimable : 0n,
      subAddress: subAddr,
    }));
  } catch {
    return EMPTY_MAINNET_POOL_POSITIONS;
  }
}
