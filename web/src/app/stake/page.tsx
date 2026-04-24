import { PageStatusBanner } from '@/components/page-status-banner'
import { StakeActions } from './stake-actions'
import { StakeLive } from './stake-live'

export default function StakePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          Stake ABX, earn ALPH
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Protocol fees — minting, borrowing, liquidation, redemption —
          split dynamically between auction-pool depositors and ABX stakers.
          Rewards are paid in ALPH; unstaking triggers a 14-day cooldown.
        </p>
      </header>

      <PageStatusBanner feature="stake" />
      <StakeLive />
      <StakeActions />
    </div>
  )
}
