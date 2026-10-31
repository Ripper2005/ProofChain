import { ipfsUrl } from "@proofchain/verifier";
import { ipfsGateways } from "./deployments.ts";

export function ipfsFileUrl(cid: string): string {
  const gateway = ipfsGateways()[0];
  return gateway ? ipfsUrl(gateway, cid) : `/ipfs/${encodeURIComponent(cid)}`;
}
