// Public entry points for @openabx/sdk.
// This package is consumed by @openabx/web and @openabx/indexer.

export { NETWORKS, getNetworkConfig, isNetwork } from "./networks";
export type { Network, NetworkConfig } from "./networks";

export {
  resolveAddress,
  resolveAddresses,
  requireAddress,
  setDevnetAddresses,
} from "./addresses";
export type { AddressBook, ContractRole } from "./addresses";

export {
  getClientContext,
  clearClientContext,
  getContractAddress,
} from "./client";
export type { ClientContext } from "./client";

export {
  ALPHBANX_MAINNET_METHODS,
  findMainnetMethod,
} from "./abi/alphbanx-mainnet";
export type { MainnetMethod } from "./abi/alphbanx-mainnet";

export { buildMainnetCallBytecode, submitMainnetCall } from "./mainnet-tx";
export type {
  BuildMainnetCallInput,
  MainnetArg,
  MainnetApproval,
} from "./mainnet-tx";

export {
  buildStake,
  buildClaimRewards,
  buildRequestUnstake,
  buildClaimUnstake,
  buildPoolDeposit,
  buildPoolWithdraw,
  buildPoolClaim,
  buildOpenLoan,
  buildRepay,
  buildAddCollateral,
  buildWithdrawCollateral,
  buildCloseLoan,
  buildRedeemMainnet,
  canMainnetWrite,
  POOL_DEPOSIT_MIN_ATTO_ABD,
} from "./mainnet";
export type { MainnetOperation, PreparedTx } from "./mainnet";
export { applyTemplate, simulateScript } from "./mainnet/template";
export type { TemplateFile, SubstitutionMap } from "./mainnet/template";

export {
  fetchMainnetLoanId,
  fetchMainnetPoolPositionId,
  fetchMainnetPoolPositions,
  fetchMainnetPoolsTvl,
  fetchMainnetStakePosition,
  hasMainnetLoan,
  EMPTY_MAINNET_STAKE,
  EMPTY_MAINNET_POOL_POSITIONS,
} from "./mainnet/readers";
export type {
  MainnetStakePosition,
  MainnetPoolPosition,
  MainnetPoolTvl,
} from "./mainnet/readers";

export { scanMainnetLoans } from "./mainnet/loan-scanner";
export type { LoanSnapshot } from "./mainnet/loan-scanner";
