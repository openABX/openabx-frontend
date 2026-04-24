"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// Next.js App Router error boundary. Wraps the page tree; if a render
// throws, we show this instead of a blank screen. Keeps the Providers
// tree mounted above us so wallet state survives.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("OpenABX render error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-6 py-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        Something broke
      </div>

      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          We hit an error rendering this page.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Your wallet is still connected — the problem is confined to this view.
          Try reloading the section; if it happens again, file a bug with the
          message below.
        </p>
      </div>

      <button
        type="button"
        onClick={reset}
        className="btn-primary inline-flex items-center gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </button>

      <details className="w-full max-w-2xl rounded-md border border-border bg-[hsl(var(--surface-2))] p-4 text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground">
          Technical details
        </summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <a
          href="https://github.com/openABX/openABX-frontend/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs text-primary underline-offset-4 hover:underline"
        >
          Report on GitHub →
        </a>
      </details>
    </div>
  );
}
