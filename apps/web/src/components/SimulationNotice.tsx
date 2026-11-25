import type { StoppedSimulation } from "../lib/actions.ts";

export function SimulationNotice({
  simulation,
  pending,
  onSendAnyway,
}: {
  simulation: StoppedSimulation;
  pending: boolean;
  onSendAnyway: () => void;
}) {
  return (
    <div className="revert stack-sm" role="alert" data-testid="simulation-rejected">
      {simulation.kind === "rejected" ? (
        <p>
          <strong>! Pre-flight simulation rejected:</strong>{" "}
          <span className="mono">{simulation.text}</span>. The wallet did not open and nothing was sent.
        </p>
      ) : (
        <p>
          <strong>! Pre-flight simulation could not run:</strong>{" "}
          <span className="mono">{simulation.text}</span>. The wallet did not open.
        </p>
      )}
      <p className="muted">
        A simulation is a read at the latest block. Only a sent transaction becomes part of the record. Send anyway
        opens the wallet with the same call so an expected revert can be tested on-chain.
      </p>
      <div className="actions">
        <button type="button" className="secondary" onClick={onSendAnyway} disabled={pending} data-testid="send-anyway">
          Send anyway
        </button>
      </div>
    </div>
  );
}
