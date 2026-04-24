import { beforeAll, describe, expect, it } from "vitest";
import { addressFromContractId, binToHex, DUST_AMOUNT } from "@alephium/web3";
import { randomBytes } from "node:crypto";
import { SortedList, type SortedListTypes } from "../../artifacts/ts";
import {
  aliceAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from "../helpers";

/**
 * SortedList tests — getters + access control only. The full insert/remove
 * flow writes subcontracts via copyCreateSubContract! and depends on the
 * ListNode template being deployed in the test environment; those end-to-
 * end scenarios land as devnet integration tests in Phase 7.
 */

function baseFields(
  overrides: Partial<SortedListTypes.Fields> = {},
): SortedListTypes.Fields {
  const owner = binToHex(randomBytes(32));
  const template = binToHex(randomBytes(32));
  return {
    owner,
    nodeTemplate: template,
    head: "",
    tail: "",
    count: 0n,
    nextNonce: 0n,
    ...overrides,
  };
}

describe("SortedList", () => {
  beforeAll(setupTestProvider);

  it("exposes its constructor state via getters", async () => {
    const fields = baseFields();
    const owner = await SortedList.tests.getOwner({ initialFields: fields });
    expect(owner.returns).toBe(fields.owner);
    const head = await SortedList.tests.getHead({ initialFields: fields });
    expect(head.returns).toBe("");
    const tail = await SortedList.tests.getTail({ initialFields: fields });
    expect(tail.returns).toBe("");
    const count = await SortedList.tests.getCount({ initialFields: fields });
    expect(count.returns).toBe(0n);
    const nonce = await SortedList.tests.getNextNonce({
      initialFields: fields,
    });
    expect(nonce.returns).toBe(0n);
  });

  it("isEmpty returns true for a fresh list", async () => {
    const r = await SortedList.tests.isEmpty({ initialFields: baseFields() });
    expect(r.returns).toBe(true);
  });

  it("isEmpty returns false when count is non-zero", async () => {
    const r = await SortedList.tests.isEmpty({
      initialFields: baseFields({
        count: 1n,
        head: "aa".repeat(32),
        tail: "aa".repeat(32),
      }),
    });
    expect(r.returns).toBe(false);
  });

  it("insert by non-owner reverts with NotOwner (500)", async () => {
    const wrongCaller = addressFromContractId(binToHex(randomBytes(32)));
    const fake = fungibleTestContract();
    await expect(
      SortedList.tests.insert({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        callerContractAddress: wrongCaller,
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT * 10n)],
        args: {
          caller: aliceAddress,
          key: 1n,
          payload: "00",
          prevHint: "",
          nextHint: "",
        },
      }),
    ).rejects.toThrow(/AssertionFailed|500/);
  });

  it("remove by non-owner reverts", async () => {
    const wrongCaller = addressFromContractId(binToHex(randomBytes(32)));
    const fake = fungibleTestContract();
    await expect(
      SortedList.tests.remove({
        initialFields: baseFields({ count: 1n }),
        contractAddress: fake.contractAddress,
        callerContractAddress: wrongCaller,
        args: { nodeId: "aa".repeat(32), refundTo: aliceAddress },
      }),
    ).rejects.toThrow(/AssertionFailed|500/);
  });
});
