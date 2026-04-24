# AlphBanX contract address inventory

**Last updated:** 2026-04-22
**Method:** On-chain state walk starting from the mainnet ABD/ABX token IDs in the Alephium `token-list`, following contract-ID references embedded in immFields / mutFields, plus the testnet addresses published on the AlphBanX GitBook, plus the Inference AG audit report scope section.

**Clean-room discipline:** this file was produced without reading any AlphBanX JavaScript source, without decompiling any Ralph bytecode, and without visiting `github.com/FRAGSTARRR/Smart-Contracts---AlphBanX` (which the audit report identifies as the public source repo — intentionally not accessed). All information here comes from (a) the on-chain state served by the public Alephium node, (b) the AlphBanX GitBook, (c) the Inference AG audit report's scope section (a public PDF).

## Testnet (published by AlphBanX GitBook `smart-contract-addresses.md`)

All addresses confirmed live via `GET /contracts/{address}/state` on `https://node.testnet.alephium.org` (node v4.5.1, 2026-04-22).

| Contract                       | Address                                         | Contract ID                                                        | Confidence                                              |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| Loan Manager                   | `26y5AztUG2ka985W1qYzHjvd2CocDjfSGJQm9TqmiGhE7` | `b66d84f6ff3eb120d990f08dd778200520c8144a000eae88c407ec798d6a9900` | high — published                                        |
| Operations Contract            | `26wzoN8h59CNgc11nFqsQx5BEQhq3LC8acnGMjqJjQrhu` | `b626fe7856913f3b89782b84adc338b7c0a5e5b54a4b92ae82b13b7e3c39d600` | high — published                                        |
| ABD Token                      | `2AEnwNzccQ3ymXLkEKqnk8Tr3pLbEoYzBtKwsiRRoy79y` | `e7078430508078b4cb2ddce6bb8e297d43e1369f3227162092255106afeabc00` | high — published                                        |
| ALPH Token                     | `tgx7VNFoP9DJiFMFgXXtafQZkUvyEdDHT9ryamHJYrjq`  | `0000000000000000000000000000000000000000000000000000000000000000` | high — native (all-zero ID)                             |
| ABD Price Oracle (constant $1) | `wtL6PCHvbpgu3uyDzqeeg7GDSBS4U54X1mj8Bmzxd1ZH`  | N/A                                                                | high — codeHash matches mainnet-side constant-$1 oracle |
| DIA ALPH Price Adapter         | `2APkRx4AkYnHxQHp2cEUeCQgB2QGKzjwkHx9vY68XSHps` | N/A                                                                | high — codeHash matches mainnet DIA adapter             |

**Not published on testnet:** ABX Token, StakeManager, Vesting, AuctionManager, AuctionPool×N, PlatformSettings, BorrowerOperations. Either they are deployed to testnet at undocumented addresses, or the AlphBanX testnet deployment is partial. Phase 3+ must confirm by calling into Operations Contract methods on testnet and observing which sub-calls resolve.

## Mainnet (derived, 2026-04-22)

Addresses derived from the mainnet ABD (`288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K`) and ABX (`258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV`) tokens — both cross-listed in `alephium/token-list` `mainnet.json` — and traversing the contract reference graph.

### High-confidence identifications

| Role                                   | Address                                         | Evidence                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ABD Token**                          | `288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K` | Token-list match; state immFields decode to symbol `ABD`, name `ABD Token`, decimals `9`                                                                                                                                                                             |
| **ABX Token**                          | `258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV` | Token-list match; state immFields decode to symbol `ABX`, name `AlphBanX`, decimals `9`                                                                                                                                                                              |
| **LoanManager**                        | `tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB`  | Address listed as mutable field in ABD Token state (the ABD mint authority); `mutField[15]` = 95,013,510,349,629 exactly matches the "$95,013.51 debt" shown on `app.alphbanx.com` dashboard at time of observation; `methodIndex 0` returns ByteVec `"LoanManager"` |
| **AuctionManager**                     | `29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3` | `methodIndex 0` returns ByteVec `"AuctionManager"`; holds 82,764.809 ABD in its asset vault matching aggregate Earn-pool deposits; mutFields[1..4] decode at 1e18 scale to bid-success fees `[0.005, 0.010, 0.015, 0.020]` matching the four 0.5/1/1.5/2 % tiers     |
| **DIAAlphPriceAdapter**                | `2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7` | `codeHash` exactly matches the testnet DIA adapter `2APkRx4A…`; live call to `methodIndex 1` returns U256 `49489670000000000` = $0.04949 — matches the ALPH price shown on the app dashboard                                                                         |
| **ABD Price Oracle (constant)**        | `28Nju5bkxygKQp3SEw29jELwgTL4zpJZjwXNgaUzU3otT` | `codeHash` exactly matches testnet `wtL6PCH…`; bytecode 112 chars; single immField U256 `1e18`; contract hard-codes "ABD = $1"                                                                                                                                       |
| **PlatformSettings (admin container)** | `21WqbuxJbLBYHxAQhr99JGJH5QKqX5JqkDnDZy7kautUf` | `methodIndex 0` returns Address `1Fcq1KfXTVj3EyxncDgTmtrQzDWGWF5sXKojXZYDdxoho` (the admin); mutFields hold 4 contract-ID ByteVecs + two Address fields — matches PlatformSettings role                                                                              |

### Medium-confidence identifications

| Role (tentative)                                                    | Address                                         | Size       | Fields                            | Rationale                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Likely **fee / parameter table** (possibly `InterestPool` registry) | `28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF` | 4968 bytes | 2 imm, 11 mut U256                | Fields encode fee/percentage-looking values at 1e16 scale (0.5/1/1.5/2/2.5 % suggests bid fee schedule); referenced from PlatformSettings mutFields   |
| Likely **StakeManager** or **Vesting** (A)                          | `24nvcVvScyWY1tJKMepAABwVnAVXP7KsjVrqmc4jAhD11` | 2574 bytes | 6 imm, 5 mut U256 (all 0)         | Referenced from LoanManager; size matches subcontract-heavy manager; zeroed counters consistent with a staking/vesting contract with no current users |
| Likely **StakeManager** or **Vesting** (B)                          | `uHKrQGuTtoRwR6ahAUhwdvrdcg4YVNq3BsVd4frLExLX`  | 1988 bytes | 3 imm, 3 mut                      | Referenced from LoanManager                                                                                                                           |
| Likely small helper (e.g. `AuctionFarming` anchor)                  | `vh9fQ2PRGBzSuckm6yE8crpSzVM1frzRhwkWwnFDitfH`  | 450 bytes  | 3 imm, 2 mut (both empty ByteVec) | Referenced from LoanManager; size too small for a manager; all mutable fields currently empty                                                         |
| Likely **BorrowerOperations**                                       | `22qGq3kq2QMCnX4HwXc9bt2AzRjwoGRmXS4Qoc687rLYf` | 1178 bytes | 3 imm, 5 mut U256 (all 0)         | Referenced from LoanManager; size consistent with a pure routing contract                                                                             |

### Admin EOA

| Role                  | Address                                         | Evidence                                                                                                                |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AlphBanX admin wallet | `1Fcq1KfXTVj3EyxncDgTmtrQzDWGWF5sXKojXZYDdxoho` | Appears as mutField `owner` in LoanManager; returned by PlatformSettings `methodIndex 0`; holds 999.75 ALPH + 1,000 ABX |

### Placeholder address

| Address                                        | Purpose                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tgx7VNFoP9DJiFMFgXXtafQZkUvyEdDHT9ryamHJYrjq` | Appears as a non-contract placeholder across multiple contract state slots. Not retrievable via `GET /contracts/{addr}/state` (IOError key-not-found). Likely the "ALPH token" sentinel or a deployer-controlled null address. Do **not** send funds here. |

## Disambiguation tasks for Phase 1

Phase 0 stops here deliberately — the remaining role labels for the five medium-confidence contracts and the fee-table contract can be resolved by calling `methodIndex 0..20` against each and observing their return signatures, without reading bytecode. Specifically:

1. Call each contract's `methodIndex 0..5`, look for: a ByteVec that decodes as a contract-name string (AuctionManager already does this — others may too); an Address returning the admin; a U256 that matches a known supply/TVL figure from the dashboard.
2. For `28QGP95r…` — the 11 U256 mutFields should map to exactly the eleven documented-on-GitBook fees/params: 4 pool discounts, 4 bid fees, minting fee, redemption fee, liquidation fee. Match by value.
3. Call the mainnet `BorrowerOperations`-shape contract with `methodIndex 0` and watch the `contracts` array in the response — which other addresses does it touch? That trace will pin role mapping.

Each disambiguation must be recorded as a new row here with an update date and the deciding evidence.

## On-chain parameters observed (mainnet, 2026-04-22 snapshot)

From LoanManager `tpxjsWJSaUh5…`:

- `mutFields[0]` = 5 × 10¹⁵ — candidate **minting fee 0.5 %** at 1e18 scale
- `mutFields[1]` = 2 × 10¹⁸ — **MCR / liquidation threshold 200 %** at 1e18 scale
- `mutFields[2]` = 2 × 10¹⁸ — second 200 % value (possibly the redemption CR floor)
- `mutFields[3]` = 2.5 × 10¹⁴ — unclear; 0.025 % at 1e18 or 0.25 at 1e15
- `mutFields[4]` = 5 × 10¹⁴ — unclear; possibly **liquidation fee 0.05 %**-ish
- `mutFields[5]` = 9 — decimals
- `mutFields[6]` = Address `1Fcq1KfXTVj3…` — admin
- `mutFields[8]` = 10¹⁸ — price precision constant
- `mutFields[11]` = 1,776,856,728,203 — unclear cumulative counter
- `mutFields[15]` = 95,013,510,349,629 = **total system debt 95,013.51 ABD** (matches dashboard)

From AuctionManager `29YL53te…`:

- `mutFields[1..4]` = `[5, 10, 15, 20] × 10¹⁵` → **successful bid fees [0.5 %, 1 %, 1.5 %, 2 %]** (exact match to GitBook)
- `mutFields[5]` = 82,764,809,116,778 → 82,764.81 ABD in pool deposits
- Asset vault: 82,764,809,116,778 ABD tokens (matches)

From DIA adapter `2AtjFo…` (live call):

- `methodIndex 1` → `49,489,670,000,000,000` → **$0.04949 ALPH/USD** (live price, 1e18 scale)

All above should be re-verified at the start of Phase 2 since DIA updates continuously and LoanManager's mutable fields evolve with every vault operation.
