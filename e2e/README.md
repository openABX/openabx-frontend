# `@openabx/e2e`

Playwright end-to-end tests.

## Commands

```
pnpm install:browsers   # one-time, installs Chromium
pnpm smoke              # headless smoke suite
pnpm test               # all tests
```

The default `webServer` config builds and starts `@openabx/web` on port 3000.
To point at an already-running instance (e.g., a Vercel preview), set
`E2E_BASE_URL`.
