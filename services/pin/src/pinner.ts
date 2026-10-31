export interface Pinner {
  pin(bytes: Uint8Array<ArrayBuffer>, fileName: string): Promise<string>;
}

export const MAX_BLOB_BYTES = 5 * 1024 * 1024;

export type PublicCopy = {
  pinner: Pinner;
  required: boolean;
};

export type Pinned = {
  cid: string;
  public: boolean;
};

export type Log = (line: string) => void;

export class PinError extends Error {
  readonly code: "PinFailed" | "CidMismatch";
  readonly target: "Kubo" | "Pinata";

  constructor(code: "PinFailed" | "CidMismatch", target: "Kubo" | "Pinata") {
    super(code === "CidMismatch" ? "Pinata reported a different CID than Kubo" : `${target} did not pin`);
    this.name = "PinError";
    this.code = code;
    this.target = target;
  }
}

export async function pinWithPublicCopy(
  kubo: Pinner,
  publicCopy: PublicCopy | undefined,
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  log: Log,
): Promise<Pinned> {
  let cid: string;
  try {
    cid = await kubo.pin(bytes, fileName);
  } catch (error) {
    log(`pin: Kubo did not pin ${fileName}: ${describe(error)}`);
    throw new PinError("PinFailed", "Kubo");
  }
  if (publicCopy === undefined) {
    return { cid, public: false };
  }

  let publicCid: string;
  try {
    publicCid = await publicCopy.pinner.pin(bytes, fileName);
  } catch (error) {
    const outcome = publicCopy.required ? "failing the request" : "returning public: false";
    log(`pin: Pinata did not pin ${fileName} (${outcome}): ${describe(error)}`);
    if (publicCopy.required) throw new PinError("PinFailed", "Pinata");
    return { cid, public: false };
  }
  if (publicCid !== cid) {
    log(`pin: CID mismatch for ${fileName}: Kubo ${cid}, Pinata ${publicCid}`);
    throw new PinError("CidMismatch", "Pinata");
  }
  return { cid, public: true };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
