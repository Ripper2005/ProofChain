import { readFileSync } from "node:fs";
import {
  cliGateways,
  cliReaders,
  parseCliArgs,
  parseDeployments,
  parseVerificationUrl,
  renderReport,
  USAGE,
  verifyBatch,
} from "../src/index.ts";

const TRUSTED = new URL("../../../apps/web/trusted-deployments.json", import.meta.url);

const parsed = parseCliArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n${USAGE}`);
  process.exit(2);
}
const target = parseVerificationUrl(parsed.options.url);
if (!target) {
  console.error(`Not a verification URL: ${parsed.options.url}\nExpected {origin}/verify/{chainId}/{contractAddress}/{batchCode}\n${USAGE}`);
  process.exit(2);
}

const deployments = parseDeployments(JSON.parse(readFileSync(TRUSTED, "utf8")));
for (const error of deployments.errors) console.error(error);
const readers = cliReaders(deployments, target.chainId, parsed.options.rpc);
const gateways = cliGateways(target.chainId, parsed.options.gateways);

const result = await verifyBatch({
  ...target,
  deployments,
  readers,
  gateways,
  fetch: (url, init) => fetch(url, init),
});
process.stdout.write(renderReport(result));
process.exitCode = result.seal.green ? 0 : 1;
