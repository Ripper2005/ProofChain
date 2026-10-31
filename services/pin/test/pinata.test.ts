import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { createPinataPinner } from "../src/pinata.ts";
import { createService } from "../src/service.ts";

const GOLDEN =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';
const GOLDEN_CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";
const SENTINEL_JWT = "eyJhbGciOiJIUzI1NiJ9.c2VudGluZWwtcGluYXRhLWp3dA.SENTINEL-JWT-7f3c9a";
const KUBO_URL = "http://kubo.test:5001";

type Call = { url: string; init: RequestInit | undefined };

describe("Pinata pinner", () => {
  it("uploads the bytes to the public network with the v1 profile and returns Pinata's CID", async () => {
    const calls: Call[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ data: { id: "f1", cid: GOLDEN_CID, network: "public", is_duplicate: false } });
    };
    const cid = await createPinataPinner({ jwt: SENTINEL_JWT, fetchImpl }).pin(
      new TextEncoder().encode(GOLDEN),
      "metadata.json",
    );

    assert.equal(cid, GOLDEN_CID);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://uploads.pinata.cloud/v3/files");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${SENTINEL_JWT}`);
    assert.ok(calls[0].init?.signal instanceof AbortSignal);
    const form = calls[0].init?.body as FormData;
    assert.equal(form.get("network"), "public");
    assert.equal(form.get("cid_version"), "v1");
    assert.equal(form.get("name"), "metadata.json");
    assert.equal(form.get("car"), null);
    const file = form.get("file") as File;
    assert.equal(file.name, "metadata.json");
    assert.equal(file.type, "application/json");
    assert.equal(await file.text(), GOLDEN);
  });

  it("uses an overridden API base URL", async () => {
    let requested = "";
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input);
      return Response.json({ data: { cid: GOLDEN_CID } });
    };
    await createPinataPinner({ jwt: "x", apiUrl: "http://127.0.0.1:9999/v3", fetchImpl }).pin(new Uint8Array([1]), "blob");
    assert.equal(requested, "http://127.0.0.1:9999/v3/files");
  });

  it("summarizes failures without echoing Pinata's response", async () => {
    const cases: { name: string; fetchImpl: typeof fetch; message: RegExp }[] = [
      {
        name: "HTTP error",
        fetchImpl: async () => new Response(`{"error":"bad key secret-detail"}`, { status: 403 }),
        message: /^Pinata upload failed with 403$/,
      },
      {
        name: "missing CID",
        fetchImpl: async () => Response.json({ data: { id: "f1" } }),
        message: /did not include a CID/,
      },
      {
        name: "malformed CID",
        fetchImpl: async () => Response.json({ data: { cid: "not a cid; secret-detail" } }),
        message: /did not include a CID/,
      },
      {
        name: "private network",
        fetchImpl: async () => Response.json({ data: { cid: GOLDEN_CID, network: "private" } }),
        message: /public network/,
      },
      {
        name: "non-JSON body",
        fetchImpl: async () => new Response("<html>secret-detail</html>", { status: 200 }),
        message: /was not JSON/,
      },
      {
        name: "transport error",
        fetchImpl: async () => {
          throw new TypeError("fetch failed secret-detail");
        },
        message: /^Pinata upload request failed$/,
      },
    ];
    for (const { name, fetchImpl, message } of cases) {
      await assert.rejects(
        createPinataPinner({ jwt: "x", fetchImpl }).pin(new Uint8Array([1]), "blob"),
        (error: Error) => {
          assert.match(error.message, message, name);
          assert.doesNotMatch(error.message, /secret-detail/, name);
          return true;
        },
      );
    }
  });

  it("gives up when Pinata does not answer within the timeout", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await assert.rejects(
      createPinataPinner({ jwt: "x", timeoutMs: 20, fetchImpl }).pin(new Uint8Array([1]), "blob"),
      /timed out after 20 ms/,
    );
  });
});

describe("configuration", () => {
  it("has no public copy without PINATA_JWT, and treats empty values as unset", () => {
    for (const env of [{}, { PINATA_JWT: "", PIN_REQUIRE_PUBLIC: "", PORT: "", PIN_HOST: "", IPFS_API_URL: "" }]) {
      const config = loadConfig(env);
      assert.equal(config.pinata, undefined);
      assert.equal(config.port, 8788);
      assert.equal(config.host, "127.0.0.1");
      assert.equal(config.ipfsApiUrl, "http://127.0.0.1:5001");
    }
  });

  it("requires the public copy by default when PINATA_JWT is set", () => {
    assert.deepEqual(loadConfig({ PINATA_JWT: "jwt" }).pinata, {
      jwt: "jwt",
      apiUrl: "https://uploads.pinata.cloud/v3",
      required: true,
    });
    assert.equal(loadConfig({ PINATA_JWT: "jwt", PIN_REQUIRE_PUBLIC: "true" }).pinata?.required, true);
    assert.equal(loadConfig({ PINATA_JWT: "jwt", PIN_REQUIRE_PUBLIC: "false" }).pinata?.required, false);
    assert.equal(loadConfig({ PINATA_JWT: "jwt\r\n" }).pinata?.jwt, "jwt");
  });

  it("rejects an unknown PIN_REQUIRE_PUBLIC and a plain-http Pinata URL without naming the key", () => {
    assert.throws(
      () => loadConfig({ PINATA_JWT: SENTINEL_JWT, PIN_REQUIRE_PUBLIC: "yes" }),
      (error: Error) => error.message === "PIN_REQUIRE_PUBLIC must be true or false",
    );
    assert.throws(
      () => loadConfig({ PINATA_JWT: SENTINEL_JWT, PINATA_API_URL: "http://pinata.example/v3" }),
      (error: Error) => /PINATA_API_URL/.test(error.message) && !error.message.includes(SENTINEL_JWT),
    );
    assert.equal(
      loadConfig({ PINATA_JWT: "jwt", PINATA_API_URL: "http://127.0.0.1:9999/v3" }).pinata?.apiUrl,
      "http://127.0.0.1:9999/v3",
    );
  });
});

describe("service wiring", () => {
  it("makes no Pinata call and returns public: false without PINATA_JWT", async () => {
    const fake = new FakeNetwork({ pinata: () => Response.json({ data: { cid: GOLDEN_CID } }) });
    const app = createService(loadConfig({ IPFS_API_URL: KUBO_URL, PIN_REQUIRE_PUBLIC: "true" }), fake.fetch, () => {});

    const metadata = await postGolden(app);
    assert.equal(metadata.status, 200);
    assert.equal(((await metadata.json()) as { public: boolean }).public, false);
    const blob = await app.request("/blobs", { method: "POST", body: new Uint8Array([1, 2, 3]) });
    assert.equal(((await blob.json()) as { public: boolean }).public, false);
    assert.equal(fake.kuboCalls, 2);
    assert.equal(fake.pinataCalls.length, 0);
  });

  it("pins to Kubo first and then to Pinata with the key from the environment", async () => {
    const fake = new FakeNetwork({ pinata: () => Response.json({ data: { cid: GOLDEN_CID, network: "public" } }) });
    const app = createService(loadConfig({ IPFS_API_URL: KUBO_URL, PINATA_JWT: SENTINEL_JWT }), fake.fetch, () => {});

    const metadata = await postGolden(app);
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), {
      cid: GOLDEN_CID,
      metadataHash: "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752",
      public: true,
    });
    assert.deepEqual(fake.order, ["kubo", "pinata"]);
    assert.equal(fake.pinataCalls[0].url, "https://uploads.pinata.cloud/v3/files");
  });

  it("does not call Pinata when Kubo fails", async () => {
    const fake = new FakeNetwork({
      kubo: () => new Response("down", { status: 500 }),
      pinata: () => Response.json({ data: { cid: GOLDEN_CID } }),
    });
    const app = createService(loadConfig({ IPFS_API_URL: KUBO_URL, PINATA_JWT: "jwt" }), fake.fetch, () => {});
    const response = await postGolden(app);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "PinFailed", message: "Kubo did not pin the document" });
    assert.equal(fake.pinataCalls.length, 0);
  });
});

describe("Pinata key handling", () => {
  it("never puts the key in a response body, a response header, or a log line", async () => {
    const echoKey = (init: RequestInit | undefined) =>
      `{"error":"rejected ${new Headers(init?.headers).get("authorization")}"}`;
    const scenarios: { name: string; required: boolean; pinata: (init: RequestInit | undefined) => Response }[] = [
      { name: "success", required: true, pinata: () => Response.json({ data: { cid: GOLDEN_CID, note: SENTINEL_JWT } }) },
      { name: "401 echoing the key", required: true, pinata: (init) => new Response(echoKey(init), { status: 401 }) },
      { name: "optional 500 echoing the key", required: false, pinata: (init) => new Response(echoKey(init), { status: 500 }) },
      { name: "mismatch", required: true, pinata: () => Response.json({ data: { cid: "bafkreiotherotherother", key: SENTINEL_JWT } }) },
      { name: "key in place of a CID", required: true, pinata: () => Response.json({ data: { cid: SENTINEL_JWT } }) },
      { name: "200 body echoing the key", required: true, pinata: (init) => new Response(echoKey(init), { status: 200 }) },
      {
        name: "transport error naming the key",
        required: true,
        pinata: () => {
          throw new TypeError(`fetch failed for Bearer ${SENTINEL_JWT}`);
        },
      },
      {
        name: "timeout",
        required: false,
        pinata: () => {
          throw new DOMException(`timed out ${SENTINEL_JWT}`, "TimeoutError");
        },
      },
    ];

    const captured: string[] = [];
    const restore = captureConsole(captured);
    try {
      for (const scenario of scenarios) {
        const fake = new FakeNetwork({ pinata: scenario.pinata });
        const env = {
          IPFS_API_URL: KUBO_URL,
          PINATA_JWT: SENTINEL_JWT,
          PIN_REQUIRE_PUBLIC: String(scenario.required),
        };
        const app = createService(loadConfig(env), fake.fetch);
        const responses = [
          await postGolden(app),
          await app.request("/blobs", { method: "POST", body: new Uint8Array([7, 7, 7]) }),
        ];
        for (const response of responses) {
          captured.push(`${scenario.name} ${response.status} ${JSON.stringify([...response.headers])}`);
          captured.push(await response.text());
        }
        assert.equal(fake.pinataCalls.length, 2, scenario.name);
        assert.equal(
          new Headers(fake.pinataCalls[0].init?.headers).get("authorization"),
          `Bearer ${SENTINEL_JWT}`,
          scenario.name,
        );
      }
    } finally {
      restore();
    }

    assert.ok(captured.some((line) => line.includes("Pinata did not pin")), "failures were logged");
    for (const line of captured) {
      assert.ok(!line.includes(SENTINEL_JWT), `key leaked: ${line.replaceAll(SENTINEL_JWT, "<KEY>")}`);
      assert.ok(!line.includes("SENTINEL-JWT"), `key fragment leaked: ${line}`);
    }
  });

  it("keeps the key out of the process output at startup and on a bad configuration", async () => {
    const started = await runMain({ PINATA_JWT: SENTINEL_JWT, PORT: "0", PIN_HOST: "127.0.0.1" }, "pin listening");
    assert.match(started.output, /pin listening on 127\.0\.0\.1:0, Pinata public copy required/);
    assert.ok(!started.output.includes("SENTINEL-JWT"));

    const rejected = await runMain({ PINATA_JWT: SENTINEL_JWT, PIN_REQUIRE_PUBLIC: "sometimes" });
    assert.equal(rejected.code, 1);
    assert.match(rejected.output, /PIN_REQUIRE_PUBLIC must be true or false/);
    assert.ok(!rejected.output.includes("SENTINEL-JWT"));
  });
});

function postGolden(app: ReturnType<typeof createService>) {
  return app.request("/metadata", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ canonical: GOLDEN, batchCode: "PCB-2026-001" }),
  });
}

class FakeNetwork {
  kuboCalls = 0;
  pinataCalls: Call[] = [];
  order: string[] = [];
  private readonly kubo: () => Response;
  private readonly pinata: (init: RequestInit | undefined) => Response;

  constructor(handlers: { kubo?: () => Response; pinata: (init: RequestInit | undefined) => Response }) {
    this.kubo = handlers.kubo ?? (() => Response.json({ Hash: GOLDEN_CID, Size: "234" }));
    this.pinata = handlers.pinata;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(KUBO_URL)) {
      this.kuboCalls += 1;
      this.order.push("kubo");
      return this.kubo();
    }
    this.pinataCalls.push({ url, init });
    this.order.push("pinata");
    return this.pinata(init);
  };
}

function captureConsole(lines: string[]): () => void {
  const methods = ["log", "error", "warn", "info", "debug"] as const;
  const originals = methods.map((method) => console[method]);
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "));
    };
  }
  return () => {
    methods.forEach((method, index) => {
      console[method] = originals[index];
    });
  };
}

function runMain(env: Record<string, string>, readyText?: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/main.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 10_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (readyText !== undefined && output.includes(readyText)) child.kill();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}
