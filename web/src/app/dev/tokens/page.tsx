import { notFound } from "next/navigation";
import { ENABLE_DEV_ROUTES, NETWORK } from "@/lib/env";
import { LiveState } from "./live-state";

export default function DevTokensPage() {
  if (!ENABLE_DEV_ROUTES) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">/dev/tokens</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only page. Reads ABD/ABX/DIA state from the configured network (
          <span className="font-mono text-xs">{NETWORK}</span>). Mint controls
          only work on devnet deployments — set{" "}
          <span className="font-mono text-xs">NEXT_PUBLIC_NETWORK=devnet</span>{" "}
          after running{" "}
          <span className="font-mono text-xs">
            pnpm contracts:deploy:devnet
          </span>
          .
        </p>
      </header>

      <LiveState />
    </main>
  );
}
