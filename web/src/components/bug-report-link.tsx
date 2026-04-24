"use client";

import { useEffect, useState } from "react";
import { NETWORK } from "@/lib/env";

const REPO = "openABX/openABX-frontend";
const TEMPLATE = "bug_report.yml";

function detectBrowserOs(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  // Keep it simple — the form asks the user to verify. We just pre-fill a
  // plausible guess so they don't stare at a blank input.
  const browserMatch =
    /(Firefox|Chrome|Safari|Edg|OPR)\/([\d.]+)/.exec(ua) ?? [];
  const browser = browserMatch[1]
    ? `${browserMatch[1] === "Edg" ? "Edge" : browserMatch[1] === "OPR" ? "Opera" : browserMatch[1]} ${browserMatch[2]}`
    : "";
  let os = "";
  if (/Windows NT ([\d.]+)/.test(ua))
    os = `Windows ${RegExp.$1 === "10.0" ? "10/11" : RegExp.$1}`;
  else if (/Mac OS X ([\d_.]+)/.test(ua))
    os = `macOS ${RegExp.$1.replace(/_/g, ".")}`;
  else if (/Android ([\d.]+)/.test(ua)) os = `Android ${RegExp.$1}`;
  else if (/iPhone OS ([\d_]+)/.test(ua))
    os = `iOS ${RegExp.$1.replace(/_/g, ".")}`;
  else if (/Linux/.test(ua)) os = "Linux";
  return [browser, os].filter(Boolean).join(" on ") || "";
}

function detectPageOption(pathname: string): string {
  // The issue form's dropdown options must match one of these strings
  // verbatim. Keep in sync with .github/ISSUE_TEMPLATE/bug_report.yml.
  if (pathname === "/" || pathname === "") return "/ (landing)";
  if (pathname.startsWith("/dashboard")) return "/dashboard";
  if (pathname.startsWith("/borrow")) return "/borrow";
  if (pathname.startsWith("/redeem")) return "/redeem";
  if (pathname.startsWith("/stake")) return "/stake";
  if (pathname.startsWith("/auction")) return "/auction";
  if (pathname.startsWith("/liquidate")) return "/liquidate";
  if (pathname.startsWith("/vesting")) return "/vesting";
  if (pathname.startsWith("/dev/tokens")) return "/dev/tokens";
  return "Other (describe below)";
}

export function BugReportLink() {
  // Build the URL on the client only — server-render a static link that
  // still works even if JS never boots.
  const [href, setHref] = useState(
    `https://github.com/${REPO}/issues/new?template=${TEMPLATE}`,
  );

  useEffect(() => {
    const params = new URLSearchParams({
      template: TEMPLATE,
      network: NETWORK,
      page: detectPageOption(window.location.pathname),
      browser_os: detectBrowserOs(),
    });
    setHref(`https://github.com/${REPO}/issues/new?${params.toString()}`);
  }, []);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-primary"
    >
      Report a bug
    </a>
  );
}
