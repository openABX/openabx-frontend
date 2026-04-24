import { beforeAll, describe, expect, it } from "vitest";
import {
  addressFromContractId,
  binToHex,
  DUST_AMOUNT,
  ONE_ALPH,
} from "@alephium/web3";
import { randomBytes } from "node:crypto";
import { ListNode, type ListNodeTypes } from "../../artifacts/ts";
import {
  aliceAddress,
  fungibleTestContract,
  inputFrom,
  setupTestProvider,
} from "../helpers";

/**
 * ListNode is a pure state holder mutated only by its parent SortedList.
 * These tests verify: (a) read-only accessors return constructor state,
 * (b) every mutator rejects non-parent callers.
 */

function parentCtx() {
  const parentId = binToHex(randomBytes(32));
  const parentAddress = addressFromContractId(parentId);
  return { parentId, parentAddress };
}

function nodeAddress() {
  return addressFromContractId(binToHex(randomBytes(32)));
}

describe("ListNode", () => {
  beforeAll(setupTestProvider);

  function baseFields(
    overrides: Partial<ListNodeTypes.Fields> = {},
  ): ListNodeTypes.Fields {
    return {
      parent: binToHex(randomBytes(32)),
      key: 42n,
      payload: binToHex(randomBytes(16)),
      prevId: "",
      nextId: "",
      ...overrides,
    };
  }

  it("exposes immutable and mutable fields via getters", async () => {
    const fields = baseFields({
      key: 999n,
      prevId: "aa".repeat(32),
      nextId: "bb".repeat(32),
    });
    const p = await ListNode.tests.getParent({ initialFields: fields });
    expect(p.returns).toBe(fields.parent);
    const k = await ListNode.tests.getKey({ initialFields: fields });
    expect(k.returns).toBe(999n);
    const pay = await ListNode.tests.getPayload({ initialFields: fields });
    expect(pay.returns).toBe(fields.payload);
    const prev = await ListNode.tests.getPrevId({ initialFields: fields });
    expect(prev.returns).toBe("aa".repeat(32));
    const next = await ListNode.tests.getNextId({ initialFields: fields });
    expect(next.returns).toBe("bb".repeat(32));
  });

  it("setPrevId by parent updates prevId", async () => {
    const ctx = parentCtx();
    const newPrev = "cc".repeat(32);
    const result = await ListNode.tests.setPrevId({
      initialFields: baseFields({ parent: ctx.parentId }),
      contractAddress: nodeAddress(),
      callerContractAddress: ctx.parentAddress,
      args: { newPrev },
    });
    const state = result.contracts.find(
      (c): c is ListNodeTypes.State =>
        c.codeHash === ListNode.contract.codeHash,
    );
    expect(state!.fields.prevId).toBe(newPrev);
  });

  it("setPrevId by non-parent reverts with NotParent (400)", async () => {
    const wrongParent = parentCtx();
    await expect(
      ListNode.tests.setPrevId({
        initialFields: baseFields(),
        contractAddress: nodeAddress(),
        callerContractAddress: wrongParent.parentAddress,
        args: { newPrev: "dd".repeat(32) },
      }),
    ).rejects.toThrow(/AssertionFailed|400/);
  });

  it("setNextId by parent updates nextId", async () => {
    const ctx = parentCtx();
    const newNext = "ee".repeat(32);
    const result = await ListNode.tests.setNextId({
      initialFields: baseFields({ parent: ctx.parentId }),
      contractAddress: nodeAddress(),
      callerContractAddress: ctx.parentAddress,
      args: { newNext },
    });
    const state = result.contracts.find(
      (c): c is ListNodeTypes.State =>
        c.codeHash === ListNode.contract.codeHash,
    );
    expect(state!.fields.nextId).toBe(newNext);
  });

  it("setNextId by non-parent reverts", async () => {
    const wrongParent = parentCtx();
    await expect(
      ListNode.tests.setNextId({
        initialFields: baseFields(),
        contractAddress: nodeAddress(),
        callerContractAddress: wrongParent.parentAddress,
        args: { newNext: "ff".repeat(32) },
      }),
    ).rejects.toThrow(/AssertionFailed|400/);
  });

  it("destroy by non-parent reverts", async () => {
    const wrongParent = parentCtx();
    const fake = fungibleTestContract();
    await expect(
      ListNode.tests.destroy({
        initialFields: baseFields(),
        contractAddress: fake.contractAddress,
        callerContractAddress: wrongParent.parentAddress,
        initialAsset: { alphAmount: ONE_ALPH, tokens: [] },
        inputAssets: [inputFrom(aliceAddress, DUST_AMOUNT)],
        args: { refundTo: aliceAddress },
      }),
    ).rejects.toThrow(/AssertionFailed|400/);
  });
});
