import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-8 py-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        404 · page not found
      </div>

      <div className="space-y-3">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          That route isn&rsquo;t part of OpenABX.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          The page you asked for doesn&rsquo;t exist. You probably want one of
          the seven protocol pages below, or the dashboard.
        </p>
      </div>

      <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/", label: "Dashboard", desc: "Protocol-wide live state" },
          { href: "/borrow", label: "Borrow", desc: "Mint ABD against ALPH" },
          {
            href: "/auction",
            label: "Auction pools",
            desc: "Earn on liquidations",
          },
          { href: "/stake", label: "Stake", desc: "Protocol fee share" },
          { href: "/redeem", label: "Redeem", desc: "Burn ABD for ALPH" },
          { href: "/liquidate", label: "Liquidate", desc: "Keeper watchlist" },
          { href: "/vesting", label: "Vesting", desc: "Unlock schedule" },
          {
            href: "/dev/tokens",
            label: "Dev · tokens",
            desc: "Raw on-chain state",
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="card group flex flex-col gap-1 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40"
          >
            <span className="inline-flex items-center gap-1 text-sm font-semibold">
              {item.label}
              <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            <span className="text-xs text-muted-foreground">{item.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
