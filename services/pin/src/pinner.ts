export interface Pinner {
  pin(bytes: Uint8Array, fileName: string): Promise<string>;
}

export const MAX_BLOB_BYTES = 5 * 1024 * 1024;
