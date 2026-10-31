import { keccak256, toBytes, type Hex } from "viem";

export const MANUFACTURER_ROLE: Hex = keccak256(toBytes("MANUFACTURER_ROLE"));
export const RECALL_ROLE: Hex = keccak256(toBytes("RECALL_ROLE"));
export const DEFAULT_ADMIN_ROLE: Hex = `0x${"0".repeat(64)}`;
