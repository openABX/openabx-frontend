import {
  Deployer,
  DeployFunction,
  Network,
} from '@alephium/cli'
import { web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import {
  AbdToken,
  AuctionFarming,
  AuctionManager,
  AuctionPool,
  LoanManager,
  Vesting,
} from '../artifacts/ts'

/**
 * Post-deploy wiring executor (audit fixes D-01, D-02, D-03, A-01, A-04,
 * O-02/D-23).
 *
 * After `0_deploy.ts` lands, the following cross-contract fields are still
 * unset:
 *
 *   1-4. AuctionPool[0..3].owner  → AuctionManager.contractId
 *   5.   LoanManager.borrowerOperations → BorrowerOperations.contractId
 *   6.   AbdToken.mintAuthority → LoanManager.address
 *   7.   AuctionManager.loanManager → LoanManager.contractId
 *   8.   Vesting.creator → AuctionFarming.address
 *   9.   AuctionFarming.notifier → AuctionManager.contractId  (already set
 *        at deploy but re-verified — operator may have retargeted)
 *
 * Until every one of these is set, the system is unsafe to use:
 *   - `LoanManager.borrowerOperations` empty → caller check is a no-op and
 *     ANYONE can call mutators with attacker-supplied prices (A-01).
 *   - `AuctionPool.owner` empty → liquidation reverts forever (D-01).
 *   - `AbdToken.mintAuthority` still the deployer EOA → user mints fail.
 *
 * This script previously only *reported* missing wiring for a human
 * operator to sign. That is the classic operator-forgets-a-step footgun,
 * so the script now **executes** each step itself with the same signer
 * that ran `0_deploy.ts`. A final verification pass re-reads every field
 * and aborts if anything still looks wrong.
 *
 * Idempotency: each setter is invoked only when the current value differs
 * from the target (read via the .view accessor). Running this script
 * twice is safe and a no-op on the second pass.
 *
 * Run: `pnpm -C contracts run wire:testnet`
 *       (or :devnet, :mainnet — controlled by alephium.config.ts env).
 */

type SignerSource = { signer: PrivateKeyWallet }

function buildSigner(network: Network<unknown>): SignerSource {
  const { privateKeys, nodeUrl } = network
  web3.setCurrentNodeProvider(nodeUrl, undefined, fetch)
  const pk = Array.isArray(privateKeys) ? privateKeys[0] : privateKeys
  if (!pk || pk.length === 0) {
    throw new Error(
      'wire: network.privateKeys is empty — set TESTNET_PRIVATE_KEYS (or equivalent) in your env.',
    )
  }
  const signer = new PrivateKeyWallet({
    privateKey: pk,
    nodeProvider: web3.getCurrentNodeProvider(),
  })
  return { signer }
}

interface Step {
  name: string
  /** Reads the current value. */
  read: () => Promise<string>
  /** Desired target (contractId for ByteVec setters, address for Address setters). */
  target: string
  /** Executes the setter when current !== target. */
  execute: (signer: PrivateKeyWallet) => Promise<string>
}

const wire: DeployFunction<Network<unknown>> = async (
  deployer: Deployer,
  network: Network<unknown>,
): Promise<void> => {
  const abd = deployer.getDeployContractResult('AbdToken')
  const loanManager = deployer.getDeployContractResult('LoanManager')
  const borrowerOps = deployer.getDeployContractResult('BorrowerOperations')
  const auctionManager = deployer.getDeployContractResult('AuctionManager')
  const vesting = deployer.getDeployContractResult('Vesting')
  const auctionFarming = deployer.getDeployContractResult('AuctionFarming')
  const pool5 = deployer.getDeployContractResult('AuctionPool:0')
  const pool10 = deployer.getDeployContractResult('AuctionPool:1')
  const pool15 = deployer.getDeployContractResult('AuctionPool:2')
  const pool20 = deployer.getDeployContractResult('AuctionPool:3')

  const { signer } = buildSigner(network)

  const steps: Step[] = []

  // Steps 1-4: AuctionPool[i].setOwner → AuctionManager.contractId.
  for (const [idx, pool] of [pool5, pool10, pool15, pool20].entries()) {
    const inst = AuctionPool.at(pool.contractInstance.address)
    const target = auctionManager.contractInstance.contractId
    steps.push({
      name: `AuctionPool[${idx}].setOwner`,
      target,
      read: async () => (await inst.view.getOwner()).returns,
      execute: async (s) =>
        (await inst.transact.setOwner({ signer: s, args: { newOwner: target } }))
          .txId,
    })
  }

  // Step 5: LoanManager.borrowerOperations → BorrowerOperations.contractId.
  {
    const inst = LoanManager.at(loanManager.contractInstance.address)
    const target = borrowerOps.contractInstance.contractId
    steps.push({
      name: 'LoanManager.setBorrowerOperations',
      target,
      read: async () => (await inst.view.getBorrowerOperations()).returns,
      execute: async (s) =>
        (
          await inst.transact.setBorrowerOperations({
            signer: s,
            args: { newRef: target },
          })
        ).txId,
    })
  }

  // Step 6: AbdToken.transferMintAuthority → LoanManager.address.
  {
    const inst = AbdToken.at(abd.contractInstance.address)
    const target = loanManager.contractInstance.address
    steps.push({
      name: 'AbdToken.transferMintAuthority',
      target,
      read: async () => (await inst.view.getMintAuthority()).returns,
      execute: async (s) =>
        (
          await inst.transact.transferMintAuthority({
            signer: s,
            args: { newAuthority: target },
          })
        ).txId,
    })
  }

  // Step 7: AuctionManager.setLoanManager → LoanManager.contractId.
  {
    const inst = AuctionManager.at(auctionManager.contractInstance.address)
    const target = loanManager.contractInstance.contractId
    steps.push({
      name: 'AuctionManager.setLoanManager',
      target,
      read: async () => (await inst.view.getLoanManager()).returns,
      execute: async (s) =>
        (
          await inst.transact.setLoanManager({
            signer: s,
            args: { newRef: target },
          })
        ).txId,
    })
  }

  // Step 8: Vesting.setCreator → AuctionFarming.address.
  {
    const inst = Vesting.at(vesting.contractInstance.address)
    const target = auctionFarming.contractInstance.address
    steps.push({
      name: 'Vesting.setCreator',
      target,
      read: async () => (await inst.view.getCreator()).returns,
      execute: async (s) =>
        (
          await inst.transact.setCreator({
            signer: s,
            args: { newCreator: target },
          })
        ).txId,
    })
  }

  // Step 9: AuctionFarming.notifier → AuctionManager.contractId (idempotent
  // verify; constructor value should already match).
  {
    const inst = AuctionFarming.at(auctionFarming.contractInstance.address)
    const target = auctionManager.contractInstance.contractId
    steps.push({
      name: 'AuctionFarming.setNotifier',
      target,
      read: async () => (await inst.view.getNotifier()).returns,
      execute: async (s) =>
        (
          await inst.transact.setNotifier({
            signer: s,
            args: { newRef: target },
          })
        ).txId,
    })
  }

  console.log(`\n=== OpenABX wiring ===\nnetwork: ${network.networkId ?? 'unknown'}\n`)

  let applied = 0
  for (const step of steps) {
    const current = await step.read()
    if (current === step.target) {
      console.log(`✓ ${step.name} — already correct`)
      continue
    }
    console.log(`→ ${step.name} ...`)
    const txId = await step.execute(signer)
    console.log(`  tx: ${txId}`)
    applied += 1
  }

  // Final verification: re-read every field and refuse to exit cleanly if
  // any setter silently failed to update state (e.g., node ordering or
  // dropped tx). This is the hard guard against "the script printed 'done'
  // but the chain did not accept one of the txs".
  const failures: string[] = []
  for (const step of steps) {
    const current = await step.read()
    if (current !== step.target) {
      failures.push(
        `${step.name}: current="${current}", expected="${step.target}"`,
      )
    }
  }

  if (failures.length > 0) {
    console.error(`\n❌ Wiring verification FAILED for ${failures.length} step(s):`)
    for (const f of failures) console.error(`   - ${f}`)
    throw new Error('Post-wire verification failed — system is NOT safe to use.')
  }

  console.log(
    `\n✅ ${applied} step(s) applied, ${steps.length - applied} already correct; all ${steps.length} verified.`,
  )
  console.log(
    `   Next: run scripts/verify-mainnet-addresses.ts daily in CI (.github/workflows/verify-mainnet.yml),`,
  )
  console.log(`   and the contract test suite on every PR.`)
}

export default wire
