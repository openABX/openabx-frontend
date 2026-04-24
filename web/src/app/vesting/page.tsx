import { PageStatusBanner } from "@/components/page-status-banner";
import { VestingActions } from "./vesting-actions";

export default function VestingPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          Earn-pool ABX vesting
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          When you deposit ABD into an auction pool and a liquidation absorbs
          some of it, the protocol credits you with ABX locked in a 12-month
          linear vesting schedule.
        </p>
      </header>

      <PageStatusBanner feature="vesting" />

      <section className="grid gap-4 sm:grid-cols-3">
        <Card label="Vesting mechanism">
          <span className="font-mono text-xl">12-month linear</span>
          <span className="block text-xs text-muted-foreground">
            default per protocol spec
          </span>
        </Card>
        <Card label="Allocation pool">
          <span className="font-mono text-xl">7,000,000 ABX</span>
          <span className="block text-xs text-muted-foreground">
            community reserve
          </span>
        </Card>
        <Card label="Trigger">
          <span className="font-mono text-xl">On liquidation</span>
          <span className="block text-xs text-muted-foreground">
            your pool absorbs debt → you earn ABX
          </span>
        </Card>
      </section>

      <section className="card p-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How the schedule works
        </h3>
        <p className="text-sm">
          Each time your auction pool absorbs debt, AuctionFarming registers a
          12-month linear-unlock schedule. At time{" "}
          <span className="font-mono">t</span> after start:
        </p>
        <pre className="mt-3 rounded-md bg-background/60 px-3 py-2 font-mono text-xs">
          vested = total_abx × min(1, t / 12 months)
        </pre>
      </section>

      <VestingActions />
    </div>
  );
}

function Card({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
