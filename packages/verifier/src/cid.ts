import { CID } from "multiformats/cid";
import { bytesToHex, sha256 } from "viem";

const RAW_CODEC = 0x55;
const SHA2_256 = 0x12;

export type CidCheck = { kind: "passed" } | { kind: "failed" } | { kind: "not-checked"; reason: string };

export function checkRawCid(cid: string, bytes: Uint8Array): CidCheck {
  let parsed: CID;
  try {
    parsed = CID.parse(cid);
  } catch {
    return { kind: "not-checked", reason: "the CID could not be decoded as base32 CIDv1 or CIDv0" };
  }
  if (parsed.version !== 1 || parsed.code !== RAW_CODEC || parsed.multihash.code !== SHA2_256) {
    return { kind: "not-checked", reason: "the CID is not CIDv1 with the raw codec and sha2-256" };
  }
  const expected = bytesToHex(parsed.multihash.digest);
  return sha256(bytes) === expected ? { kind: "passed" } : { kind: "failed" };
}
