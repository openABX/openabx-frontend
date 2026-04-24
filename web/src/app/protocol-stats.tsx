"use client";

import { useProtocolGlobals } from "@/lib/hooks";
import { bigintToNumber, formatAmount, formatUsd } from "@/lib/format";

export function ProtocolStats() {
  const { data: g } = useProtocolGlobals();

  const priceUsd = g?.alphUsd1e18 ? bigintToNumber(g.alphUsd1e18, 18) : null;

  const tvlAlph = g?.totalCollateralAlph
    ? bigintToNumber(g.totalCollateralAlph, 18)
    : null;
  const tvlUsd =
    tvlAlph != null && priceUsd != null ? tvlAlph * priceUsd : null;

  const poolAbd = g?.totalPoolAbd ? bigintToNumber(g.totalPoolAbd, 9) : null;

  const abdSupply = g?.abdTotalSupply
    ? bigintToNumber(g.abdTotalSupply, 9)
    : null;
  const abxSupply = g?.abxTotalSupply
    ? bigintToNumber(g.abxTotalSupply, 9)
    : null;

  const protocolCrPct =
    tvlAlph != null &&
    g?.totalDebtAbd != null &&
    g.totalDebtAbd > 0n &&
    priceUsd != null
      ? ((tvlAlph * priceUsd) / bigintToNumber(g.totalDebtAbd, 9)) * 100
      : null;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Protocol TVL"
        main={tvlUsd != null ? `$${formatUsd(tvlUsd, 0)}` : "—"}
        sub={
          tvlAlph != null
            ? `${formatAmount(g!.totalCollateralAlph!, 18, 0)} ALPH`
            : null
        }
      />
      <Stat
        label="ABD supply"
        main={
          abdSupply != null ? `${formatAmount(g!.abdTotalSupply!, 9, 0)}` : "—"
        }
        sub={
          protocolCrPct != null
            ? `protocol CR ${protocolCrPct.toFixed(0)}%`
            : null
        }
      />
      <Stat
        label="ABX circulating"
        main={
          abxSupply != null ? `${formatAmount(g!.abxTotalSupply!, 9, 0)}` : "—"
        }
        sub={null}
      />
      <Stat
        label="ABD in pools"
        main={poolAbd != null ? `${formatAmount(g!.totalPoolAbd!, 9, 0)}` : "—"}
        sub={
          priceUsd != null
            ? `ALPH @ $${priceUsd.toFixed(6)}`
            : "live ALPH/USD pending…"
        }
      />
    </section>
  );
}

function Stat({
  label,
  main,
  sub,
}: {
  label: string;
  main: string;
  sub: string | null;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl">{main}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
