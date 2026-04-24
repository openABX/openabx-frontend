import { PageStatusBanner } from '@/components/page-status-banner'
import { RedeemForm } from './redeem-form'

export default function RedeemPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          Redeem ABD for ALPH
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Burn ABD, receive ALPH at the live oracle price minus a 1.5%
          redemption fee. Redemptions target the lowest-interest loan first —
          the mechanism that pins ABD to $1.
        </p>
      </header>

      <PageStatusBanner feature="redeem" />
      <RedeemForm />
    </div>
  )
}
