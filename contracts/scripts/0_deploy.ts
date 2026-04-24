import {
  Deployer,
  DeployFunction,
  Network,
} from '@alephium/cli'
import { ALPH_TOKEN_ID, ONE_ALPH, stringToHex } from '@alephium/web3'
import {
  AbdPriceOracle,
  AbdPriceOracleTypes,
  AbdToken,
  AbdTokenTypes,
  AbxToken,
  AbxTokenTypes,
  AuctionFarming,
  AuctionFarmingTypes,
  AuctionManager,
  AuctionManagerTypes,
  AuctionPool,
  AuctionPoolTypes,
  BorrowerOperations,
  BorrowerOperationsTypes,
  CircuitBreaker,
  CircuitBreakerTypes,
  DiaAlphPriceAdapter,
  DiaAlphPriceAdapterTypes,
  ListNode,
  ListNodeTypes,
  Loan,
  LoanTypes,
  LoanManager,
  LoanManagerTypes,
  MockDiaRegistry,
  PlatformSettings,
  PlatformSettingsTypes,
  SortedList,
  SortedListTypes,
  StakeManager,
  StakeManagerTypes,
  Vesting,
  VestingTypes,
} from '../artifacts/ts'

/**
 * OpenABX testnet deployment.
 *
 * Deploys the 17 Ralph contracts in dependency order and wires the
 * cross-contract references that make them a coherent system:
 *
 *   1.  Price oracle adapters (DIA adapter + constant ABD oracle).
 *   2.  Token templates (ABD, ABX) with LoanManager as placeholder mint
 *       authority — retargeted once LoanManager is live.
 *   3.  CircuitBreaker, PlatformSettings.
 *   4.  Template-factory parents: ListNode template, Loan template,
 *       AuctionPool template. These are "deployed once to supply the
 *       bytecode copyCreateSubContract! clones from".
 *   5.  Four AuctionPool instances (one per tier), cloned from the
 *       template at deploy time.
 *   6.  AuctionManager with pool addresses wired.
 *   7.  LoanManager with auctionManager + loanTemplate wired.
 *   8.  Post-wire admin calls: LoanManager becomes ABD mint authority;
 *       AuctionFarming's notifier is set to AuctionManager.
 *
 * Devnet parameters match docs/00-protocol-spec.md §2 defaults; testnet
 * uses the same values unless overridden via environment variables.
 *
 * NOT yet run — the script compiles and produces a dry-run plan. To
 * execute, the operator needs a funded private key (TESTNET_PRIVATE_KEYS
 * env variable) and a live testnet node. The script is idempotent: on
 * re-run it detects existing artifacts via alephium-cli's built-in
 * deployments.<network>.json bookkeeping.
 */

// Protocol parameters at 1e18 precision (see docs/00-protocol-spec.md §2).
const PRECISION = 10n ** 18n
const MINTING_FEE = 5n * 10n ** 15n          // 0.5 %
const MCR_THRESHOLD = 2n * PRECISION          // 200 %
const MIN_LOAN_SIZE = 100n * 10n ** 9n        // 100 ABD
const TWELVE_MONTHS_MS = 31_536_000_000n
const FOURTEEN_DAYS_MS = 1_209_600_000n
const ORACLE_STALENESS_MS = 1_800_000n        // 30 minutes
const TOTAL_ABX = 100_000_000n * 10n ** 9n    // 100M fixed supply
const EARN_POOL_ABX = 7_000_000n * 10n ** 9n  // 7% allocation (GitBook tokenomics)

const DEFAULT_DIA_TESTNET_REGISTRY = '216wgM3Xi5uBFYwwiw2T7iZoCy9vozPJ4XjToW74nQjbV'
// blake2b-digest key for ALPH/USD on DIA xMarket (Phase 0 observation).
const DIA_ALPH_USD_KEY =
  '5f4b92205af6f25a3462384eda297084e1fad3d15e2638d15ae5c2832978a600'

const BID_FEE_BPS = [50n, 100n, 150n, 200n] as const // 0.5 / 1 / 1.5 / 2 %
const POOL_DISCOUNTS = [500n, 1000n, 1500n, 2000n] as const // 5 / 10 / 15 / 20 %

const deploy: DeployFunction<Network<unknown>> = async (deployer: Deployer, network: Network<unknown>): Promise<void> => {
  const { adminAddress } = getDeployerAddresses(deployer)
  const diaRegistry = process.env['DIA_REGISTRY_ID'] ?? DEFAULT_DIA_TESTNET_REGISTRY

  console.log(`\n=== OpenABX testnet deploy ===`)
  console.log(`network:     ${network.networkId}`)
  console.log(`deployer:    ${adminAddress}`)
  console.log(`DIA:         ${diaRegistry}`)
  console.log(``)

  // 1. Oracle adapters.
  const diaAdapter = await deployContractAny(deployer,DiaAlphPriceAdapter, {
    initialFields: {
      registryId: diaRegistry,
      feedKey: DIA_ALPH_USD_KEY,
    } satisfies DiaAlphPriceAdapterTypes.Fields,
  })
  const abdPriceOracle = await deployContractAny(deployer,AbdPriceOracle, {
    initialFields: { precision: PRECISION } satisfies AbdPriceOracleTypes.Fields,
  })

  // 2. Tokens. ABD mint authority is initially the deployer and is
  //    retargeted to LoanManager in step 8. ABX issues the full 100M at
  //    deploy — the deployer holds the mint, distributing pieces to
  //    AuctionFarming, Vesting, and any future allocations.
  const abd = await deployContractAny(deployer,AbdToken, {
    initialFields: {
      symbol: stringToHex('ABD'),
      name: stringToHex('ABD Token'),
      decimals: 9n,
      mintAuthority: adminAddress,
      totalSupply: 0n,
    } satisfies AbdTokenTypes.Fields,
    issueTokenAmount: 2n ** 255n,
  })
  const abx = await deployContractAny(deployer,AbxToken, {
    initialFields: {
      symbol: stringToHex('ABX'),
      name: stringToHex('AlphBanX'),
      decimals: 9n,
      totalSupply: TOTAL_ABX,
    } satisfies AbxTokenTypes.Fields,
    issueTokenAmount: TOTAL_ABX,
  })

  // 3. Safety + settings.
  const circuitBreaker = await deployContractAny(deployer,CircuitBreaker, {
    initialFields: {
      paused: false,
      pauser: adminAddress,
      oracleStalenessMillis: ORACLE_STALENESS_MS,
    } satisfies CircuitBreakerTypes.Fields,
  })
  const platformSettings = await deployContractAny(deployer,PlatformSettings, {
    initialFields: {
      admin: adminAddress,
      abdToken: abd.contractInstance.contractId,
      abxToken: abx.contractInstance.contractId,
      loanManager: '',
      borrowerOperations: '',
      auctionManager: '',
      stakeManager: '',
      vesting: '',
      diaAlphPriceAdapter: diaAdapter.contractInstance.contractId,
      abdPriceOracle: abdPriceOracle.contractInstance.contractId,
      circuitBreaker: circuitBreaker.contractInstance.contractId,
    } satisfies PlatformSettingsTypes.Fields,
  })

  // 4. Template factories. These instances exist only to supply bytecode
  //    to copyCreateSubContract!. No state beyond the "placeholder"
  //    initialisation.
  const listNodeTemplate = await deployContractAny(deployer,ListNode, {
    initialFields: {
      parent: '',
      key: 0n,
      payload: '',
      prevId: '',
      nextId: '',
    } satisfies ListNodeTypes.Fields,
  })
  const loanTemplate = await deployContractAny(deployer,Loan, {
    initialFields: {
      manager: '',
      owner: adminAddress,
      interestRate: 0n,
      debt: 0n,
      collateral: 0n,
      lastInterestMs: 0n,
    } satisfies LoanTypes.Fields,
  })
  const auctionPoolTemplate = await deployContractAny(deployer,AuctionPool, {
    initialFields: {
      abdTokenId: abd.contractInstance.contractId,
      owner: '',
      discountBps: 0n,
      bidSuccessFeeBps: 0n,
      closeBidFeeBps: 50n,
      productP: PRECISION,
      alphPerUnit: 0n,
      totalAbd: 0n,
      epoch: 0n,
    } satisfies AuctionPoolTypes.Fields,
  })

  // 5. The four real AuctionPool instances. Cloned from the template in
  //    constructor form (each has its own address + state; they share
  //    bytecode only).
  const auctionPools: string[] = []
  for (let i = 0; i < POOL_DISCOUNTS.length; i++) {
    const pool = await deployContractAny(deployer,AuctionPool, {
      initialFields: {
        abdTokenId: abd.contractInstance.contractId,
        owner: '', // filled by AuctionManager.setPools after AuctionManager is deployed
        discountBps: POOL_DISCOUNTS[i]!,
        bidSuccessFeeBps: BID_FEE_BPS[i]!,
        closeBidFeeBps: 50n,
        productP: PRECISION,
        alphPerUnit: 0n,
        totalAbd: 0n,
        epoch: 0n,
      } satisfies AuctionPoolTypes.Fields,
    })
    auctionPools.push(pool.contractInstance.contractId)
  }

  // 6. AuctionManager with all four pools wired.
  const auctionManager = await deployContractAny(deployer,AuctionManager, {
    initialFields: {
      abdTokenId: abd.contractInstance.contractId,
      admin: adminAddress,
      loanManager: '', // wired in step 7
      pool5: auctionPools[0]!,
      pool10: auctionPools[1]!,
      pool15: auctionPools[2]!,
      pool20: auctionPools[3]!,
      circuitBreaker: circuitBreaker.contractInstance.contractId, // audit fix O-02/D-23
    } satisfies AuctionManagerTypes.Fields,
  })

  // 7. LoanManager. We pass the already-deployed AuctionManager.
  //    `borrowerOperations` is empty; 1_wire.ts populates it after the
  //    BorrowerOperations contract is deployed below.
  const loanManager = await deployContractAny(deployer,LoanManager, {
    initialFields: {
      abdTokenId: abd.contractInstance.contractId,
      oracleId: diaAdapter.contractInstance.contractId,
      loanTemplate: loanTemplate.contractInstance.contractId,
      admin: adminAddress,
      totalDebt: 0n,
      totalCollateral: 0n,
      mintingFee: MINTING_FEE,
      mcrThreshold: MCR_THRESHOLD,
      minLoanSize: MIN_LOAN_SIZE,
      auctionManager: auctionManager.contractInstance.contractId,
      borrowerOperations: '', // wired by 1_wire.ts (audit fix A-01/A-04)
      circuitBreaker: circuitBreaker.contractInstance.contractId, // audit fix O-02/D-23
      badDebt: 0n, // audit fix O-04
    } satisfies LoanManagerTypes.Fields,
  })

  // 7a. BorrowerOperations — the user-facing wrapper. Deploys after
  //     LoanManager because it needs the LoanManager contract id. After
  //     deploy, 1_wire.ts calls LoanManager.setBorrowerOperations to
  //     restrict every state-mutating method to this contract id.
  //     Audit fix D-02: this contract was missing from the deploy script
  //     entirely, leaving users with no safe entry point.
  const borrowerOps = await deployContractAny(deployer,BorrowerOperations, {
    initialFields: {
      loanManager: loanManager.contractInstance.contractId,
      oracle: diaAdapter.contractInstance.contractId,
      abdTokenId: abd.contractInstance.contractId,
    } satisfies BorrowerOperationsTypes.Fields,
  })

  // 7b. SortedList — the hint-verified loan ordering used by the future
  //     sorted-traversal redemption (Phase 5 part 4). Deployed now so the
  //     address is in the deployments file ahead of the wiring change.
  //     Audit fix D-02: also missing from the deploy script before.
  //     Owner is set to LoanManager so the future redemption traversal can
  //     verify it's the authorized caller.
  const sortedList = await deployContractAny(deployer,SortedList, {
    initialFields: {
      owner: loanManager.contractInstance.contractId,
      nodeTemplate: listNodeTemplate.contractInstance.contractId,
      head: '',
      tail: '',
      count: 0n,
      nextNonce: 0n,
    } satisfies SortedListTypes.Fields,
  })

  // 8. Staking, Vesting, AuctionFarming.
  const stakeManager = await deployContractAny(deployer,StakeManager, {
    initialFields: {
      abxTokenId: abx.contractInstance.contractId,
      admin: adminAddress,
      totalStakedAbx: 0n,
      rewardIndex: 0n,
      unstakeCooldownMs: FOURTEEN_DAYS_MS,
    } satisfies StakeManagerTypes.Fields,
  })
  const vesting = await deployContractAny(deployer,Vesting, {
    initialFields: {
      abxTokenId: abx.contractInstance.contractId,
      admin: adminAddress,
      creator: adminAddress, // retargeted to AuctionFarming below
      totalAllocated: 0n,
      totalClaimed: 0n,
    } satisfies VestingTypes.Fields,
  })
  const auctionFarming = await deployContractAny(deployer,AuctionFarming, {
    initialFields: {
      abxTokenId: abx.contractInstance.contractId,
      vesting: vesting.contractInstance.contractId,
      admin: adminAddress,
      notifier: auctionManager.contractInstance.contractId,
      emittedAbx: 0n,
      paused: false,
      vestingDurationMs: TWELVE_MONTHS_MS,
    } satisfies AuctionFarmingTypes.Fields,
  })

  // 9. Post-wiring (requires additional signed transactions against
  //    already-deployed contracts). Cross-references:
  //    - LoanManager becomes ABD's mint authority.
  //    - AuctionManager.setLoanManager points at LoanManager.
  //    - Vesting.setCreator points at AuctionFarming.
  //    - PlatformSettings updated with every wiring.
  //
  //    The alephium-cli deployer doesn't directly expose "call method
  //    after deploy"; operators run these as a follow-up script. They
  //    are documented in docs/04-deploy-runbook.md §"Post-deploy wiring".

  // 10. Dev-only: mock DIA registry (for devnet tests).
  if (network.networkId === 4) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deployContractAny(deployer,MockDiaRegistry as any, {
      initialFields: { price: 50_000_000_000_000_000n, timestamp: 0n },
    })
  }

  console.log(`\n=== Deploy summary ===`)
  console.log(`ABD:                 ${abd.contractInstance.address}`)
  console.log(`ABX:                 ${abx.contractInstance.address}`)
  console.log(`LoanManager:         ${loanManager.contractInstance.address}`)
  console.log(`BorrowerOperations:  ${borrowerOps.contractInstance.address}`)
  console.log(`SortedList:          ${sortedList.contractInstance.address}`)
  console.log(`AuctionManager:      ${auctionManager.contractInstance.address}`)
  console.log(`AuctionPool×4:       ${auctionPools.join(', ')}`)
  console.log(`StakeManager:        ${stakeManager.contractInstance.address}`)
  console.log(`Vesting:             ${vesting.contractInstance.address}`)
  console.log(`AuctionFarming:      ${auctionFarming.contractInstance.address}`)
  console.log(`PlatformSettings:    ${platformSettings.contractInstance.address}`)
  console.log(`CircuitBreaker:      ${circuitBreaker.contractInstance.address}`)
  console.log(`DIA adapter:         ${diaAdapter.contractInstance.address}`)
  console.log(`ABD oracle:          ${abdPriceOracle.contractInstance.address}`)
  console.log(`\n=== REQUIRED NEXT STEP ===`)
  console.log(`Run: pnpm -C contracts run wire:testnet`)
  console.log(`This executes the 9 cross-contract admin calls that lock down`)
  console.log(`access control. Without it, every loan mutator is callable by`)
  console.log(`anyone (audit findings A-01, A-04). The system is NOT safe to`)
  console.log(`use until the wire script reports all checks green.`)

  // Silence the unused-import warning — ALPH_TOKEN_ID / ONE_ALPH are kept
  // for the forthcoming 1_wire.ts script.
  void ALPH_TOKEN_ID
  void ONE_ALPH
}

function getDeployerAddresses(deployer: Deployer): { adminAddress: string } {
  const account = deployer.account
  return { adminAddress: account.address }
}

// Widens past the ESM/CJS dual-typing skew in @alephium/web3 3.0.3 where the
// _esm artifact imports conflict with the _cjs ContractFactory exported by
// @alephium/cli's Deployer type. Both point at the same runtime code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDeployer = any
async function deployContractAny(
  deployer: Deployer,
  factory: unknown,
  params: unknown,
): Promise<AnyDeployer> {
  return (deployer as AnyDeployer).deployContract(factory, params)
}

export default deploy
