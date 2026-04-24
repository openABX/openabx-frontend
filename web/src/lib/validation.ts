import { isValidAddress, isAssetAddress } from "@alephium/web3";

const EXPLORER_BASE = "https://explorer.alephium.org";

export function explorerAddressUrl(addr: string): string {
  return `${EXPLORER_BASE}/addresses/${encodeURIComponent(addr)}`;
}

export function explorerTxUrl(txId: string): string {
  return `${EXPLORER_BASE}/transactions/${encodeURIComponent(txId)}`;
}

export type AddressValidation =
  | { ok: true; address: string }
  | { ok: false; reason: string };

/**
 * Validate a user-supplied Alephium address string. Accepts only asset
 * addresses (user wallets) — not contract addresses, not groupless
 * without a group index, not garbage. Call this before any tx builder
 * that would otherwise fail at simulation time with a confusing error.
 */
export function validateUserAddress(
  raw: string | null | undefined,
): AddressValidation {
  if (!raw) return { ok: false, reason: "Address required." };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "Address required." };
  if (!isValidAddress(trimmed)) {
    return { ok: false, reason: "Not a valid Alephium address." };
  }
  if (!isAssetAddress(trimmed)) {
    return {
      ok: false,
      reason: "Contract addresses are not accepted — pass a wallet address.",
    };
  }
  return { ok: true, address: trimmed };
}
