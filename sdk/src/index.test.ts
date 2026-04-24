import { describe, expect, it, beforeEach } from "vitest";
import {
  NETWORKS,
  findMainnetMethod,
  getNetworkConfig,
  isNetwork,
  requireAddress,
  resolveAddress,
  resolveAddresses,
  setDevnetAddresses,
} from "./index";

describe("networks", () => {
  it("lists devnet, testnet, mainnet", () => {
    expect(NETWORKS).toEqual(["devnet", "testnet", "mainnet"]);
  });

  it("recognises supported network names", () => {
    expect(isNetwork("mainnet")).toBe(true);
    expect(isNetwork("sepolia")).toBe(false);
  });

  it("gives each network a well-formed config", () => {
    for (const n of NETWORKS) {
      const cfg = getNetworkConfig(n);
      expect(cfg.name).toBe(n);
      expect(cfg.nodeUrl).toMatch(/^https?:\/\//);
      expect(cfg.confirmations).toBeGreaterThan(0);
    }
  });
});

describe("addresses", () => {
  beforeEach(() => {
    setDevnetAddresses({});
  });

  it("resolves published testnet addresses", () => {
    expect(resolveAddress("testnet", "abdToken")).toBe(
      "2AEnwNzccQ3ymXLkEKqnk8Tr3pLbEoYzBtKwsiRRoy79y",
    );
    expect(resolveAddress("testnet", "loanManager")).toBe(
      "26y5AztUG2ka985W1qYzHjvd2CocDjfSGJQm9TqmiGhE7",
    );
  });

  it("returns undefined for roles not yet deployed to testnet", () => {
    expect(resolveAddress("testnet", "abxToken")).toBeUndefined();
    expect(resolveAddress("testnet", "auctionManager")).toBeUndefined();
  });

  it("resolves high-confidence mainnet addresses", () => {
    expect(resolveAddress("mainnet", "loanManager")).toBe(
      "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
    );
    expect(resolveAddress("mainnet", "auctionManager")).toBe(
      "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    );
    expect(resolveAddress("mainnet", "diaAlphPriceAdapter")).toBe(
      "2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7",
    );
  });

  it("mainnet Vesting remains unlabeled (medium-confidence)", () => {
    expect(resolveAddress("mainnet", "vesting")).toBeUndefined();
  });

  it("mainnet BorrowerOperations resolved from on-chain observation (docs/07)", () => {
    expect(resolveAddress("mainnet", "borrowerOperations")).toBe(
      "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    );
  });

  it("mainnet StakeManager resolved from live stake-tx decode (docs/07)", () => {
    expect(resolveAddress("mainnet", "stakeManager")).toBe(
      "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    );
  });

  it("devnet cache is empty by default, overridable by setDevnetAddresses", () => {
    expect(resolveAddresses("devnet")).toEqual({});
    setDevnetAddresses({ abdToken: "1111" });
    expect(resolveAddress("devnet", "abdToken")).toBe("1111");
  });

  it("requireAddress throws a useful message when role is unknown", () => {
    expect(() => requireAddress("testnet", "abxToken")).toThrow(/abxToken/);
  });
});

describe("mainnet method ABI", () => {
  it("finds a known mainnet method", () => {
    const m = findMainnetMethod("auctionManager", "getContractName");
    expect(m).toBeDefined();
    expect(m!.methodIndex).toBe(0);
  });

  it("returns undefined for an unknown mainnet method", () => {
    expect(findMainnetMethod("auctionManager", "futureMethod")).toBeUndefined();
  });
});
