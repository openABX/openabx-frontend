// Template-based TxScript builder for AlphBanX's mainnet contracts.
//
// Strategy: take a known-good scriptOpt from a real user transaction
// (observed in the blockchain's public history), decode it via
// @alephium/web3's script codec, substitute the user-specific values
// (amounts, addresses), and re-encode. Safer than emitting bytecode from
// scratch because the call-convention, any pre-fetch helper calls (like
// StakeManager's CallExternal[23] to look up the user's subcontract id),
// and the APS approval sequence all come pre-baked from a proven-working
// transaction.
//
// Every template is a JSON artifact in references/alphbanx-operation-templates/
// produced by scripts/fetch-operation-templates.ts.

import {
  addressToBytes,
  binToHex,
  codec,
  hexToBinUnsafe,
} from "@alephium/web3";

const scriptCodec = codec.script.scriptCodec;
const lockupScriptCodec = codec.lockupScript.lockupScriptCodec;

export interface TemplateFileInstr {
  name: string;
  index?: number;
  offset?: number;
  selector?: number;
  value?: unknown;
  valueHex?: string;
  asAddress?: string;
}

export interface TemplateFile {
  operation: string;
  contract: string;
  methodIndex: number;
  txId: string;
  scriptOpt: string;
  contractInputs: string[];
  methods: Array<{
    index: number;
    argsLength: number;
    localsLength: number;
    returnLength: number;
    instrs: TemplateFileInstr[];
  }>;
}

export interface SubstitutionMap {
  /** Replace every `U256Const` whose current value matches `from` with `to`. */
  replaceU256?: Array<{ from: bigint; to: bigint }>;
  /**
   * Swap any P2PKH `AddressConst` in the script for the current signer's
   * address. Templates baked from a specific historical user hold the
   * original signer; we swap for the caller.
   */
  replaceSignerAddress?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInstr = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethod = any;

/**
 * Convert a base58 wallet address into the structured `LockupScript`
 * object that the script codec emits via `AddressConst`.
 *
 * `addressToBytes(addr)` returns the canonical serialization. The first
 * byte is the lockup-script tag and the remainder is the hash. We feed
 * the bytes directly into `lockupScriptCodec.decode`.
 */
function lockupScriptFromAddress(address: string): unknown {
  const bytes = addressToBytes(address);
  return lockupScriptCodec.decode(bytes);
}

/**
 * Convert one of our TemplateFileInstr entries back into an `Instr` the
 * script codec can re-encode.
 */
function rehydrateInstr(src: TemplateFileInstr): AnyInstr {
  const { name } = src;
  switch (name) {
    case "U256Const":
      return {
        name: "U256Const",
        code: 0x13,
        value: BigInt(String(src.value)),
      };
    case "I256Const":
      return {
        name: "I256Const",
        code: 0x12,
        value: BigInt(String(src.value)),
      };
    case "BytesConst": {
      // Empty string ("") is a legal encoding: BytesConst(<0 bytes>). Only
      // reject undefined.
      const hex =
        src.valueHex !== undefined
          ? src.valueHex
          : typeof src.value === "string"
            ? src.value
            : undefined;
      if (hex === undefined) throw new Error("BytesConst missing valueHex");
      return {
        name: "BytesConst",
        code: 0x14,
        value: hex.length === 0 ? new Uint8Array() : hexToBinUnsafe(hex),
      };
    }
    case "AddressConst": {
      const v = src.value as { kind?: string; value?: unknown };
      if (!v) throw new Error("AddressConst missing value");
      // Templates may serialize the LockupScript value as hex, a byte array,
      // or an {n: ...} map — normalize to a byte array and re-emit.
      const toBytes = (x: unknown): Uint8Array => {
        if (x instanceof Uint8Array) return x;
        if (typeof x === "string") return hexToBinUnsafe(x);
        if (x && typeof x === "object") {
          const values = Object.values(x as Record<string, number>);
          return Uint8Array.from(values);
        }
        throw new Error("AddressConst: cannot coerce value to bytes");
      };
      if (v.kind === "P2PKH") {
        return {
          name: "AddressConst",
          code: 0x15,
          value: { kind: "P2PKH", value: toBytes(v.value) },
        };
      }
      if (v.kind === "P2SH") {
        return {
          name: "AddressConst",
          code: 0x15,
          value: { kind: "P2SH", value: toBytes(v.value) },
        };
      }
      throw new Error(
        `AddressConst kind=${v.kind} not yet supported by the rehydrator`,
      );
    }
    case "LoadLocal":
      return { name: "LoadLocal", code: 0x16, index: src.index! };
    case "StoreLocal":
      return { name: "StoreLocal", code: 0x17, index: src.index! };
    case "LoadMutField":
      return { name: "LoadMutField", code: 0xa0, index: src.index! };
    case "StoreMutField":
      return { name: "StoreMutField", code: 0xa1, index: src.index! };
    case "LoadImmField":
      return { name: "LoadImmField", code: 0xce, index: src.index! };
    case "CallLocal":
      return { name: "CallLocal", code: 0x00, index: src.index! };
    case "CallExternal":
      return { name: "CallExternal", code: 0x01, index: src.index! };
    case "Jump":
      return { name: "Jump", code: 0x4a, offset: src.offset! };
    case "IfTrue":
      return { name: "IfTrue", code: 0x4b, offset: src.offset! };
    case "IfFalse":
      return { name: "IfFalse", code: 0x4c, offset: src.offset! };
    case "MethodSelector":
      return { name: "MethodSelector", code: 0xd3, selector: src.selector! };
    case "CallExternalBySelector":
      return {
        name: "CallExternalBySelector",
        code: 0xd4,
        selector: src.selector!,
      };
    case "CreateMapEntry": {
      const v = src.value as {
        immFieldsNum: number;
        mutFieldsNum: number;
      };
      return {
        name: "CreateMapEntry",
        code: 0xd2,
        immFieldsNum: v.immFieldsNum,
        mutFieldsNum: v.mutFieldsNum,
      };
    }
    default: {
      // Zero-operand opcodes — lookup by name.
      const opcodeByName: Record<string, number> = {
        Return: 0x02,
        ConstTrue: 0x03,
        ConstFalse: 0x04,
        I256Const0: 0x05,
        I256Const1: 0x06,
        I256Const2: 0x07,
        I256Const3: 0x08,
        I256Const4: 0x09,
        I256Const5: 0x0a,
        I256ConstN1: 0x0b,
        U256Const0: 0x0c,
        U256Const1: 0x0d,
        U256Const2: 0x0e,
        U256Const3: 0x0f,
        U256Const4: 0x10,
        U256Const5: 0x11,
        Pop: 0x18,
        BoolNot: 0x19,
        BoolAnd: 0x1a,
        BoolOr: 0x1b,
        BoolEq: 0x1c,
        BoolNeq: 0x1d,
        BoolToByteVec: 0x1e,
        U256Add: 0x2a,
        U256Sub: 0x2b,
        U256Mul: 0x2c,
        U256Div: 0x2d,
        U256Eq: 0x2f,
        U256Neq: 0x30,
        U256Lt: 0x31,
        U256Ge: 0x34,
        Assert: 0x4d,
        CallerAddress: 0xb4,
        CallerContractId: 0xb3,
        SelfContractId: 0xb1,
        SelfAddress: 0xb2,
        ContractExists: 0xc5,
        ApproveAlph: 0xa2,
        ApproveToken: 0xa3,
        TransferAlph: 0xa7,
        TransferAlphFromSelf: 0xa8,
        TransferAlphToSelf: 0xa9,
        TransferToken: 0xaa,
        TransferTokenFromSelf: 0xab,
        TransferTokenToSelf: 0xac,
        MinimalContractDeposit: 0xd1,
        Dup: 0x7a,
        Swap: 0x7c,
        BlockTimeStamp: 0x56,
        TxId: 0x58,
        TxInputAddressAt: 0x59,
        AddressEq: 0x45,
        AddressNeq: 0x46,
        AddressToByteVec: 0x47,
        IsAssetAddress: 0x48,
        IsContractAddress: 0x49,
        ByteVecEq: 0x41,
        ByteVecNeq: 0x42,
        ByteVecConcat: 0x44,
        ALPHTokenId: 0xcd,
      };
      const code = opcodeByName[name];
      if (code === undefined) {
        throw new Error(`rehydrateInstr: unhandled opcode "${name}"`);
      }
      return { name, code } as AnyInstr;
    }
  }
}

/**
 * Re-encode a TemplateFile after applying `subs` into a hex scriptOpt ready
 * for `SignerProvider.signAndSubmitExecuteScriptTx({ bytecode })`.
 */
export function applyTemplate(
  template: TemplateFile,
  subs: SubstitutionMap,
): string {
  const methods: AnyMethod[] = template.methods.map((m) => ({
    isPublic: true,
    usePreapprovedAssets: true,
    useContractAssets: false,
    usePayToContractOnly: false,
    argsLength: m.argsLength,
    localsLength: m.localsLength,
    returnLength: m.returnLength,
    instrs: m.instrs.map((ins) => {
      if (
        ins.name === "U256Const" &&
        subs.replaceU256 &&
        typeof ins.value === "string"
      ) {
        const current = BigInt(ins.value);
        const hit = subs.replaceU256.find((r) => r.from === current);
        if (hit) {
          return rehydrateInstr({ ...ins, value: hit.to.toString() });
        }
      }
      if (ins.name === "AddressConst" && subs.replaceSignerAddress) {
        return {
          name: "AddressConst",
          code: 0x15,
          value: lockupScriptFromAddress(subs.replaceSignerAddress),
        };
      }
      return rehydrateInstr(ins);
    }),
  }));
  const bytes = scriptCodec.encode({ methods } as AnyInstr);
  return binToHex(bytes);
}

export interface SimulateScriptInput {
  /** atto-ALPH the user has available (e.g., 5 ALPH). */
  attoAlphAmount?: bigint;
  /** Tokens the user approves for the script's ApproveToken ops. */
  tokens?: Array<{ id: string; amount: bigint }>;
}

/**
 * Simulate a candidate bytecode against mainnet state without committing.
 * If this succeeds with the given input asset balances, the same bytecode
 * is safe to sign and submit (assuming the user actually holds those
 * assets).
 */
export async function simulateScript(
  nodeUrl: string,
  bytecode: string,
  callerAddress: string,
  input: SimulateScriptInput = {},
): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const body: Record<string, unknown> = { group: 0, bytecode, callerAddress };
  if (input.attoAlphAmount !== undefined || input.tokens?.length) {
    body["inputAssets"] = [
      {
        address: callerAddress,
        asset: {
          attoAlphAmount: (input.attoAlphAmount ?? 0n).toString(),
          ...(input.tokens?.length
            ? {
                tokens: input.tokens.map((t) => ({
                  id: t.id,
                  amount: t.amount.toString(),
                })),
              }
            : {}),
        },
      },
    ];
  }
  try {
    const res = await fetch(`${nodeUrl}/contracts/call-tx-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
    }
    const json = (await res.json()) as { type?: string; error?: string };
    if (json.type && json.type !== "CallTxScriptSucceeded") {
      return { ok: false, error: json.error ?? json.type, result: json };
    }
    return { ok: true, result: json };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
