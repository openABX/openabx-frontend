"use client";

// Tiny inline-SVG sparkline. No external chart library. Renders a smooth
// line + a subtle fill gradient beneath, with the most-recent data point
// highlighted.

import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

export interface SparklineProps {
  /** Samples, oldest → newest. Rendered left→right. Values below 0 are clamped. */
  values: number[];
  width?: number;
  height?: number;
  /** Tailwind text color class for the line + gradient (e.g. text-primary). */
  colorClass?: string;
  className?: string;
  /** Show the last-point dot. */
  showDot?: boolean;
  /** Draw a zero-baseline axis. */
  showBaseline?: boolean;
  /** Optional label announcer for accessibility. */
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 240,
  height = 60,
  colorClass = "text-primary",
  className,
  showDot = true,
  showBaseline = false,
  ariaLabel,
}: SparklineProps) {
  const { path, area, lastX, lastY, first, last, min, max } = useMemo(() => {
    if (values.length === 0) {
      return {
        path: "",
        area: "",
        lastX: 0,
        lastY: 0,
        first: 0,
        last: 0,
        min: 0,
        max: 0,
      };
    }
    const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const pad = 4;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const step = clean.length === 1 ? 0 : w / (clean.length - 1);
    const coords = clean.map((v, i) => {
      const x = pad + step * i;
      const y = pad + h - ((v - min) / range) * h;
      return { x, y };
    });
    const d = coords
      .map(
        (c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`,
      )
      .join(" ");
    const firstCoord = coords[0]!;
    const lastCoord = coords[coords.length - 1]!;
    const areaD =
      d +
      ` L ${lastCoord.x.toFixed(2)} ${height - pad} L ${firstCoord.x.toFixed(2)} ${height - pad} Z`;
    return {
      path: d,
      area: areaD,
      lastX: lastCoord.x,
      lastY: lastCoord.y,
      first: clean[0]!,
      last: clean[clean.length - 1]!,
      min,
      max,
    };
  }, [values, width, height]);

  const trend = last - first;
  const rising = trend > 0;
  // useId gives a stable, SSR-matched unique identifier — safe for SVG
  // defs ids. Math.random() here would break hydration.
  const reactId = useId();
  const gradientId = `spark-fill-${reactId.replace(/:/g, "")}`;

  if (values.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center text-xs text-muted-foreground",
          className,
        )}
        style={{ width, height }}
      >
        <span className="animate-pulse">collecting samples…</span>
      </div>
    );
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? `trend chart, ${values.length} samples`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn(colorClass, className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {showBaseline && (
        <line
          x1="4"
          x2={width - 4}
          y1={height - 4}
          y2={height - 4}
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="1"
        />
      )}
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDot && (
        <circle
          cx={lastX}
          cy={lastY}
          r="3"
          fill="currentColor"
          className={rising ? "" : "opacity-80"}
        />
      )}
      <title>{`min ${min.toPrecision(4)} · last ${last.toPrecision(4)} · max ${max.toPrecision(4)}`}</title>
    </svg>
  );
}
