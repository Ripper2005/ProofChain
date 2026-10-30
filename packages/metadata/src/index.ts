import { keccak256, toBytes } from "viem";

export const MAX_DOCUMENT_BYTES = 64 * 1024;

const BATCH_CODE = /^[A-Za-z0-9-]{1,64}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const REQUIRED_KEYS = [
  "batchCode",
  "description",
  "imageCid",
  "manufacturerName",
  "name",
  "productionDate",
  "quantity",
  "schemaVersion",
  "sku",
] as const;

export type ProductMetadata = {
  schemaVersion: 1;
  name: string;
  sku: string;
  batchCode: string;
  quantity: number;
  productionDate: string;
  manufacturerName: string;
  description: string;
  imageCid: string;
};

export class MetadataError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MetadataError";
    this.code = code;
  }
}

export function validateBatchCode(batchCode: string): boolean {
  return typeof batchCode === "string" && BATCH_CODE.test(batchCode);
}

export function computeBatchId(batchCode: string): `0x${string}` {
  if (!validateBatchCode(batchCode)) {
    throw new MetadataError("InvalidBatchCode", "Batch code must be 1-64 characters from A-Z, a-z, 0-9, and hyphen");
  }
  return keccak256(toBytes(batchCode));
}

export function hashMetadata(canonical: string): `0x${string}` {
  return keccak256(toBytes(canonical));
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function parseAndValidate(canonical: string): ProductMetadata {
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new MetadataError("TooLarge", "Canonical document exceeds 64 KiB");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    throw new MetadataError("InvalidJson", "Canonical document is not JSON");
  }

  if (!isPlainObject(parsed)) {
    throw new MetadataError("InvalidDocument", "Canonical document must be a JSON object");
  }

  const keys = Object.keys(parsed);
  const expected = new Set<string>(REQUIRED_KEYS);
  for (const key of keys) {
    if (!expected.has(key)) {
      throw new MetadataError("UnknownKey", `Unknown key ${key}`);
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(parsed, key)) {
      throw new MetadataError("MissingKey", `Missing key ${key}`);
    }
  }

  const document = readDocument(parsed);
  const recomputed = canonicalize(document);
  if (recomputed !== canonical) {
    throw new MetadataError("NonCanonical", "Submitted bytes are not the canonical document");
  }
  return document;
}

function readDocument(parsed: Record<string, unknown>): ProductMetadata {
  if (parsed.schemaVersion !== 1) {
    throw new MetadataError("InvalidField", "schemaVersion must be 1");
  }
  const name = requiredTrimmed(parsed.name, "name");
  const sku = requiredTrimmed(parsed.sku, "sku");
  const manufacturerName = requiredTrimmed(parsed.manufacturerName, "manufacturerName");
  if (typeof parsed.batchCode !== "string" || !validateBatchCode(parsed.batchCode)) {
    throw new MetadataError("InvalidBatchCode", "batchCode is not a valid batch code");
  }
  if (typeof parsed.quantity !== "number" || !Number.isSafeInteger(parsed.quantity) || parsed.quantity < 1) {
    throw new MetadataError("InvalidField", "quantity must be an integer >= 1");
  }
  if (typeof parsed.productionDate !== "string" || !isRealDate(parsed.productionDate)) {
    throw new MetadataError("InvalidField", "productionDate must be a real YYYY-MM-DD date");
  }
  if (typeof parsed.description !== "string") {
    throw new MetadataError("InvalidField", "description must be a string");
  }
  if (typeof parsed.imageCid !== "string" || !isImageCid(parsed.imageCid)) {
    throw new MetadataError("InvalidField", "imageCid must be empty or a printable CID of at most 128 characters");
  }

  return {
    schemaVersion: 1,
    name,
    sku,
    batchCode: parsed.batchCode,
    quantity: parsed.quantity,
    productionDate: parsed.productionDate,
    manufacturerName,
    description: parsed.description,
    imageCid: parsed.imageCid,
  };
}

function requiredTrimmed(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new MetadataError("InvalidField", `${field} must be a non-empty trimmed string`);
  }
  return value;
}

function isImageCid(value: string): boolean {
  if (value.length === 0) return true;
  if (value.length > 128) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalize(value: unknown): unknown {
  if (value === undefined) {
    throw new MetadataError("InvalidValue", "undefined is not JSON");
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new MetadataError("InvalidValue", "Value is not JSON");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new MetadataError("InvalidValue", "NaN and Infinity are not JSON");
  }
  if (value instanceof Date) {
    throw new MetadataError("InvalidValue", "Date values must be strings");
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (!isPlainObject(value)) {
    throw new MetadataError("InvalidValue", "Value is not a plain JSON object");
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalize(value[key]);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
