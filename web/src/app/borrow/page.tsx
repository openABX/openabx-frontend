import { PageStatusBanner } from "@/components/page-status-banner";
import { BorrowForm } from "./borrow-form";
import { LoanManage } from "./loan-manage";

export default function BorrowPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          Borrow ABD against ALPH
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Deposit ALPH, choose an interest tier from 1–30%, and mint ABD (1 ABD
          = $1 USD). Keep your collateral value above 200% of debt or the loan
          becomes eligible for liquidation.
        </p>
      </header>

      <PageStatusBanner feature="borrow" />
      <LoanManage />
      <BorrowForm />
    </div>
  );
}
