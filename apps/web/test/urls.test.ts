import assert from "node:assert/strict";
import test from "node:test";
import { ipfsCid, joinUrl, stripMount } from "../server/urls.ts";

test("strips the /api mount and joins the upstream URL", () => {
  assert.equal(stripMount("/api/metadata", "/api"), "/metadata");
  assert.equal(stripMount("/api/batches?participant=0xabc", "/api"), "/batches?participant=0xabc");
  assert.equal(stripMount("/api/../rpc", "/api"), null);
  assert.equal(joinUrl("http://127.0.0.1:8788", "/metadata"), "http://127.0.0.1:8788/metadata");
  assert.equal(
    joinUrl("http://127.0.0.1:8787", "/batches?participant=0xabc"),
    "http://127.0.0.1:8787/batches?participant=0xabc",
  );
});

test("accepts one IPFS path segment", () => {
  assert.equal(ipfsCid("/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"), "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");
  assert.equal(ipfsCid("/ipfs/bafy/extra"), null);
  assert.equal(ipfsCid("/ipfs/.."), null);
  assert.equal(ipfsCid("/ipfs/%2e%2e"), null);
});
