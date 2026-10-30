import type { Pinner } from "./pinner.ts";

type KuboAddResponse = {
  Hash?: string;
};

export function createKuboPinner(apiUrl: string, fetchImpl: typeof fetch = fetch): Pinner {
  return {
    async pin(bytes, fileName) {
      const url = new URL("/api/v0/add", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
      url.searchParams.set("cid-version", "1");
      url.searchParams.set("pin", "true");
      const form = new FormData();
      form.append("file", new Blob([bytes]), fileName);
      const response = await fetchImpl(url, { method: "POST", body: form });
      if (!response.ok) {
        throw new Error(`Kubo add failed with ${response.status}`);
      }
      const payload = (await response.json()) as KuboAddResponse;
      if (typeof payload.Hash !== "string" || payload.Hash.length === 0) {
        throw new Error("Kubo add response did not include a CID");
      }
      return payload.Hash;
    },
  };
}
