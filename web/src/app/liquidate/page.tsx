import { PageStatusBanner } from "@/components/page-status-banner";
import { LiquidateForm } from "./liquidate-form";

export default function LiquidatePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          Trigger a liquidation
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Any loan whose CR falls below 200% can be liquidated by anyone. The
          auction pools absorb the debt and receive the ALPH at a discount.
          Permissionless; automated keepers handle most calls.
        </p>
      </header>

      <PageStatusBanner feature="liquidate" />
      <LiquidateForm />
    </div>
  );
}
