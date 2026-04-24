import { PageStatusBanner } from '@/components/page-status-banner'
import { AuctionActions } from './auction-actions'
import { AuctionLive } from './auction-live'

export default function AuctionPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          Earn from liquidations
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Deposit ABD into one of four discount pools (5, 10, 15, 20%). When
          a vault&rsquo;s CR falls below 200%, pools absorb the debt in
          ascending-discount order and receive ALPH at a premium equal to
          their discount.
        </p>
      </header>

      <PageStatusBanner feature="auction" />
      <AuctionLive />
      <AuctionActions />
    </div>
  )
}
