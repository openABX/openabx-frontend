// OpenABX indexer — Phase 1 skeleton.
//
// Phase 3+ maintains the cross-tier sorted-loans view and exposes /hints/*
// HTTP endpoints that the frontend calls to construct valid insertion and
// redemption transactions (ADR-002).
//
// At Phase 1 this is a smoke test: confirms SDK wiring works, polls the node,
// prints a heartbeat. No persistence, no HTTP server yet.

import { getClientContext, isNetwork, type Network } from "@openabx/sdk";

const DEFAULT_INTERVAL_MS = 15_000;

function resolveNetwork(): Network {
  const raw = process.env["NETWORK"] ?? "testnet";
  if (!isNetwork(raw)) {
    throw new Error(
      `NETWORK must be one of devnet|testnet|mainnet, got: ${raw}`,
    );
  }
  return raw;
}

async function heartbeat(network: Network): Promise<void> {
  const ctx = getClientContext(network);
  const chainInfo = await ctx.provider.infos.getInfosChainParams();
  const ts = new Date().toISOString();
  console.log(
    JSON.stringify({
      t: ts,
      network,
      kind: "heartbeat",
      networkId: chainInfo.networkId,
      isOpenAbxDeployment: ctx.isOpenAbxDeployment,
      loanManager: ctx.addresses.loanManager ?? null,
      auctionManager: ctx.addresses.auctionManager ?? null,
    }),
  );
}

async function main(): Promise<void> {
  const network = resolveNetwork();
  const intervalMs = Number(process.env["INTERVAL_MS"] ?? DEFAULT_INTERVAL_MS);

  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      kind: "start",
      network,
      intervalMs,
    }),
  );

  // First tick eagerly so operators see output immediately.
  try {
    await heartbeat(network);
  } catch (err) {
    console.error("heartbeat error:", err);
  }

  const timer = setInterval(() => {
    heartbeat(network).catch((err) => console.error("heartbeat error:", err));
  }, intervalMs);

  const stop = (): void => {
    clearInterval(timer);
    console.log(JSON.stringify({ t: new Date().toISOString(), kind: "stop" }));
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
