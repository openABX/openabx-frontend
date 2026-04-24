import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-base font-semibold">
            open<span className="text-primary">ABX</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Independent, open-source interface to the ABD stablecoin protocol on
            Alephium. MIT licensed. We did not author or deploy the contracts,
            operate no backend, and never custody your funds.
          </p>
        </div>

        <FooterCol
          title="Protocol"
          links={[
            { href: "/borrow", label: "Borrow" },
            { href: "/auction", label: "Auction pools" },
            { href: "/stake", label: "Stake ABX" },
            { href: "/redeem", label: "Redeem" },
            { href: "/liquidate", label: "Liquidate" },
          ]}
        />

        <FooterCol
          title="Resources"
          links={[
            {
              href: "https://github.com/openabx/openabx/blob/main/docs/00-protocol-spec.md",
              label: "Protocol spec",
              external: true,
            },
            {
              href: "https://docs.alephium.org/",
              label: "Alephium docs",
              external: true,
            },
            {
              href: "https://explorer.alephium.org/",
              label: "Alephium explorer",
              external: true,
            },
          ]}
        />

        <FooterCol
          title="OpenABX"
          links={[
            {
              href: "https://github.com/openabx/openabx",
              label: "Source on GitHub",
              external: true,
            },
            {
              href: "https://github.com/openabx/openabx/issues/new",
              label: "Report a bug",
              external: true,
            },
            {
              href: "https://github.com/openabx/openabx/security/advisories/new",
              label: "Security disclosure",
              external: true,
            },
            {
              href: "https://github.com/openabx/openabx/blob/main/RELEASE-CANDIDATE.md",
              label: "Release notes",
              external: true,
            },
            {
              href: "https://github.com/openabx/openabx/blob/main/docs/05-security.md",
              label: "Incident response",
              external: true,
            },
          ]}
        />
      </div>

      <div className="border-t border-border/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4 text-[11px] text-muted-foreground">
          <span>
            © {new Date().getFullYear()} OpenABX contributors · MIT licensed ·
            pre-audit beta · independent project, not affiliated with the
            contract authors
          </span>
          <span>
            Built on{" "}
            <Link
              href="https://alephium.org"
              className="text-foreground hover:text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Alephium
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              target={l.external ? "_blank" : undefined}
              rel={l.external ? "noreferrer" : undefined}
              className="text-muted-foreground hover:text-primary"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
