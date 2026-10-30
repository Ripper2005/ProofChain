export function address(value: string): string {
  const lower = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    throw new Error("Expected a 20-byte address");
  }
  return lower;
}

export function hash32(value: string): string {
  const lower = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(lower)) {
    throw new Error("Expected a 32-byte hex value");
  }
  return lower;
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/i.test(value);
}

export function isBatchId(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/i.test(value);
}
