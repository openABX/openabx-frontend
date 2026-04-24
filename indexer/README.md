# `@openabx/indexer`

Off-chain indexer for OpenABX. Maintains the cross-tier sorted-loans view
and exposes `/hints/*` HTTP endpoints consumed by the frontend (ADR-002).

At Phase 1 this is a heartbeat-only smoke test. Phase 3 adds event
subscription + SQLite persistence + HTTP server.

```
NETWORK=testnet pnpm dev
NETWORK=devnet  pnpm dev
```

Outputs newline-delimited JSON. Each line is a structured log event
(`kind: start|heartbeat|stop`).
