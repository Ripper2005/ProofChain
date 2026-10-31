import type { Agreement, ReaderReport } from "./agreement.ts";
import { describeTrust } from "./deployments.ts";
import type { DocumentCheck, GatewayAttempt } from "./document.ts";
import { formatUnix } from "./format.ts";
import type { TimelineStep } from "./timeline.ts";
import { SEAL_RULE, type RegisteredOutcome, type VerificationResult } from "./verify.ts";

export function agreementSummary(agreement: Agreement): string {
  if (agreement.anchor === null) return "No reader answered on this chain, so there is no anchor block and no agreement.";
  const at = `block ${agreement.anchor}${agreement.anchorHash ? ` (hash ${agreement.anchorHash})` : ""}`;
  if (agreement.holds && agreement.configured === 1) {
    return `Agreement holds with the only configured reader, which answered at ${at}. With one reader there is nothing to compare it against.`;
  }
  if (agreement.holds) return `Agreement holds: ${agreement.agreeing} of ${agreement.configured} readers return the same record at ${at}.`;
  const parts = [
    `${agreement.agreeing} agree`,
    `${agreement.disagreeing} disagree`,
    `${agreement.unreachable} did not answer`,
    `${agreement.misconfigured} report another chain`,
  ];
  return `No agreement at ${at}: ${parts.join(", ")}. Agreement needs at least two agreeing readers, or the only configured reader, and none disagreeing.`;
}

export function readerStatusText(report: ReaderReport): string {
  const where = report.chainId !== null && report.head !== null ? `chain ${report.chainId}, head ${report.head}` : "";
  const status = {
    agrees: "agrees",
    disagrees: "disagrees",
    unreachable: "did not answer",
    misconfigured: "misconfigured",
  }[report.status];
  return [status, where, report.detail].filter((part) => part).join("; ");
}

export function stepText(step: TimelineStep): string {
  switch (step.kind) {
    case "registered":
      return `Registered by ${step.manufacturer}`;
    case "proposed":
      return `Handoff proposed from ${step.from} to ${step.to}`;
    case "cancelled":
      return `Handoff from ${step.from} to ${step.to} cancelled`;
    case "accepted":
      return `Handoff accepted: custody moved from ${step.from} to ${step.to}`;
    case "recalled": {
      const by = step.recalledBy ? ` by ${step.recalledBy}` : "";
      const reason =
        step.reason === null
          ? ", reason unavailable because the logs could not be loaded"
          : step.reason.length > 0
            ? `, reason "${step.reason}"`
            : ", no reason given";
      const cleared = step.pendingCleared ? ", pending handoff cleared" : "";
      return `Recalled${by}${reason}${cleared}`;
    }
    case "pending":
      return `Open: the handoff from ${step.from} waits for ${step.to} to accept`;
  }
}

export function stepPosition(step: TimelineStep): string {
  const time = step.time === null ? "time unavailable" : formatUnix(step.time);
  const block = step.blockNumber === null ? "block unavailable" : `block ${step.blockNumber}`;
  const tx = step.txHash ?? "transaction unavailable";
  return `${time}, ${block}, ${tx}`;
}

export function checkText(check: DocumentCheck): string {
  const mark = check.result === "pass" ? "pass   " : check.result === "fail" ? "FAIL   " : "not run";
  return `${mark} ${check.label}${check.detail && check.result !== "pass" ? ` (${check.detail})` : ""}`;
}

export function attemptText(attempt: GatewayAttempt): string {
  const outcome = { passed: "passed", "wrong-bytes": "WRONG BYTES", "no-bytes": "no bytes" }[attempt.outcome];
  return `${attempt.gateway}: ${outcome}, ${attempt.detail}`;
}

export function renderReport(result: VerificationResult): string {
  const lines: string[] = [];
  lines.push("ProofChain batch verification");
  lines.push(`  Chain id    ${result.chainId}`);
  lines.push(`  Contract    ${result.contract}`);
  lines.push(`  Batch code  ${result.batchCode}`);
  if (result.batchId) lines.push(`  Batch id    ${result.batchId}`);

  lines.push("", "Deployment trust", `  ${describeTrust(result.trust, result.chainId)}`);

  lines.push("", `Readers (${result.agreement.configured} configured)`);
  for (const report of result.readers) {
    lines.push(`  ${report.url}`, `    ${readerStatusText(report)}`);
    if (report.status === "disagrees") for (const line of report.answer) lines.push(`      answered ${line}`);
  }
  if (result.readers.length > 0) lines.push(`  ${agreementSummary(result.agreement)}`);

  lines.push("");
  const outcome = result.outcome;
  switch (outcome.kind) {
    case "invalid-address":
      lines.push("The contract address in the URL is not an Ethereum address.");
      break;
    case "invalid-code":
      lines.push("The batch code is not valid, so there is no contract id to read. Case is significant.");
      break;
    case "no-reader":
      lines.push(`No reader is configured for chain ${result.chainId}. Pass --rpc <url> with a node you choose.`);
      break;
    case "cannot-read":
      lines.push(`No configured reader is on chain ${result.chainId}, so this verifier cannot read that chain.`);
      break;
    case "unreachable":
      lines.push("The readers did not respond. The batch is not reported as found or as missing.");
      break;
    case "not-registered":
      lines.push(`No batch with code ${result.batchCode} is registered on this contract.`);
      lines.push(`  Contract error: ${outcome.errorText}`);
      break;
    case "registered":
      renderRegistered(lines, outcome);
      break;
  }

  lines.push("", "Green seal");
  lines.push(`  ${result.seal.green ? "YES" : "NO"}`);
  lines.push(`  [${mark(result.seal.trusted)}] recognized deployment`);
  lines.push(`  [${mark(result.seal.documentMatch)}] document match`);
  lines.push(`  [${mark(result.seal.copyNotMismatch)}] IPFS copy is not a mismatch`);
  lines.push(`  [${mark(result.seal.agreement)}] reader agreement`);
  lines.push(`  ${SEAL_RULE}`);
  if (outcome.kind === "registered") {
    const reason = outcome.recall?.reason ? ` Reason: "${outcome.recall.reason}".` : "";
    lines.push(`  Batch status: ${outcome.batch.status.toUpperCase()}.${outcome.batch.status === "recalled" ? reason : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderRegistered(lines: string[], outcome: RegisteredOutcome) {
  const { batch } = outcome;
  const role = outcome.manufacturerRole === null ? "could not be read" : outcome.manufacturerRole ? "held" : "not held";
  lines.push("Batch");
  lines.push(`  Status             ${batch.status}`);
  lines.push(`  Registering wallet ${batch.manufacturer} (manufacturer role ${role})`);
  lines.push(`  Current custodian  ${batch.currentCustodian}`);
  lines.push(`  Registered at      ${formatUnix(batch.createdAt)}`);
  lines.push(`  Metadata hash      ${batch.metadataHash}`);
  lines.push(`  Metadata CID       ${batch.metadataCid}`);
  if (outcome.recall) {
    lines.push(`  Recall reason      ${outcome.recall.reason.length > 0 ? outcome.recall.reason : "no reason was given"}`);
  }

  const source =
    outcome.logs.status === "loaded"
      ? `from the logs of ${outcome.logs.reader}`
      : "from contract state only, because no agreeing reader returned the logs";
  lines.push("", `Custody sequence, oldest first, ${source}`);
  outcome.timeline.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${stepText(step)}`, `     ${stepPosition(step)}`);
  });
  if (outcome.logs.status === "unavailable") {
    for (const failure of outcome.logs.failures) lines.push(`  Logs: ${failure}`);
  }
  if (outcome.historyDisagrees) {
    lines.push("  WARNING: getCustodyHistory and the CustodyTransferred logs disagree in count or order.");
  }

  const { document } = outcome;
  lines.push("", "Product document");
  if (document.onChain.status === "read") {
    lines.push(`  On-chain document, from the BatchRegistered log in transaction ${document.onChain.txHash ?? "unavailable"}`);
    for (const check of document.onChain.judgement.checks) lines.push(`    ${checkText(check)}`);
  } else {
    lines.push(`  On-chain document: unavailable, because ${document.onChain.reason}`);
  }
  lines.push(`  IPFS copy ${document.ipfs.cid}: ${document.ipfs.status}`);
  if (document.ipfs.attempts.length === 0) lines.push("    no gateway is configured");
  for (const attempt of document.ipfs.attempts) lines.push(`    ${attemptText(attempt)}`);
  if (document.standIn) {
    lines.push("  The IPFS copy stands in for the on-chain document:");
    for (const check of document.standIn.checks) lines.push(`    ${checkText(check)}`);
  }
  const from = document.source === "on-chain" ? " (on-chain document)" : document.source === "ipfs" ? " (IPFS copy)" : "";
  lines.push(`  Document verdict: ${document.verdict.toUpperCase()}${from}`);
  if (document.reason) lines.push(`  ${document.reason}`);
}

function mark(value: boolean): string {
  return value ? "x" : " ";
}
