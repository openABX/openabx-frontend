// Translates raw Alephium VM / WalletConnect errors into messages a user
// can act on. Unknown errors fall through as their original text — don't
// fabricate when we don't know.

interface MatchRule {
  test: (err: string) => boolean;
  message: (err: string) => string;
}

const RULES: MatchRule[] = [
  // Pool / stake / loan — "Contract does not exist"
  {
    test: (e) => /Contract \w+ does not exist/i.test(e),
    message: () =>
      "You don't have an active position this action targets. If you're " +
      "trying to withdraw or claim, you need to deposit first; if repaying, " +
      "you need an open loan.",
  },
  // Min pool deposit — error 3010
  {
    test: (e) => /Error Code: 3010/.test(e),
    message: () => "Pool deposit below minimum (50 ABD). Increase the amount.",
  },
  // Generic pool assertion — 3004
  {
    test: (e) => /Error Code: 3004/.test(e),
    message: () =>
      "Pool operation rejected by the contract — typically because you have " +
      "no position in that pool.",
  },
  // Loan-side 5004
  {
    test: (e) => /Error Code: 5004/.test(e),
    message: () =>
      "Loan operation rejected — you may not have an active loan or the " +
      "input amount exceeds what you can withdraw / repay.",
  },
  // Generic stake 4000
  {
    test: (e) => /Error Code: 4000/.test(e),
    message: () =>
      "Nothing to claim right now. Your stake rewards are already claimed " +
      "or not yet accrued.",
  },
  // Arithmetic underflow (pool claim over-claim)
  {
    test: (e) => /ArithmeticError.*U256Sub/.test(e),
    message: () =>
      "Amount exceeds what the contract has for you. If claiming, reduce " +
      "the amount below your actual claimable balance.",
  },
  // Not enough approved balance
  {
    test: (e) => /Not enough approved balance/i.test(e),
    message: (e) => {
      const tok = e.match(/tokenId:\s*([a-f0-9]+)/)?.[1] ?? "";
      const expected = e.match(/expected:\s*(\d+)/)?.[1] ?? "";
      const got = e.match(/got:\s*(\d+)/)?.[1] ?? "";
      const tokenName =
        tok ===
        "9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00"
          ? "ABX"
          : tok ===
              "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500"
            ? "ABD"
            : "token";
      return `Your wallet doesn't have enough ${tokenName} — needs ${expected}${got ? `, has ${got}` : ""}.`;
    },
  },
  // Group mismatch
  {
    test: (e) => /Group mismatch/i.test(e),
    message: () =>
      "Wallet address group mismatch. Switch to a group-0 address in your " +
      "Alephium wallet.",
  },
  // WalletConnect required chains
  {
    test: (e) => /does not include.*required chain/i.test(e),
    message: () =>
      "Your wallet rejected the session proposal. Update your Alephium " +
      "mobile / desktop wallet to the latest version, or use the Alephium " +
      "Extension Wallet which bypasses WalletConnect.",
  },
  // Gas
  {
    test: (e) => /insufficient gas|gas limit/i.test(e),
    message: () =>
      "Not enough ALPH in your wallet to pay for gas. Add a bit of ALPH " +
      "and retry.",
  },
  // User rejected
  {
    test: (e) => /user rejected|rejected by user/i.test(e),
    message: () => "You declined the signature request in your wallet.",
  },
  // NoTxInput (simulation called without input assets)
  {
    test: (e) => /NoTxInput/.test(e),
    message: () =>
      "Simulation needs input-asset context. Connect a wallet with enough " +
      "ALPH + the relevant token to proceed.",
  },
];

export function translateTxError(raw: string | undefined | null): string {
  if (!raw) return "Unknown error";
  const trimmed = raw.trim();
  for (const r of RULES) {
    if (r.test(trimmed)) return r.message(trimmed);
  }
  // Fall through — show the underlying text, but shortened
  return trimmed.length > 240 ? trimmed.slice(0, 240) + "…" : trimmed;
}
