import { createApp } from "./app.ts";
import type { PinConfig } from "./config.ts";
import { createKuboPinner } from "./kubo.ts";
import { createPinataPinner } from "./pinata.ts";
import type { Log } from "./pinner.ts";

export function createService(config: PinConfig, fetchImpl: typeof fetch = fetch, log?: Log) {
  const { pinata } = config;
  return createApp(createKuboPinner(config.ipfsApiUrl, fetchImpl), {
    publicCopy: pinata && {
      pinner: createPinataPinner({ jwt: pinata.jwt, apiUrl: pinata.apiUrl, fetchImpl }),
      required: pinata.required,
    },
    log,
  });
}
