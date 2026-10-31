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
    <div className="revert" role="alert" data-testid="simulation-rejected">
      {simulation.kind === "rejected" ? (
        <p>
          The simulation says the contract would reject this call: <span className="mono">{simulation.text}</span>. The
          wallet did not open and nothing was sent.
        </p>
      ) : (
        <p>
          The call could not be simulated, so the wallet did not open: <span className="mono">{simulation.text}</span>
        </p>
      )}
      <p className="muted">
        A simulation is a read at the latest block. Only a sent transaction becomes part of the record. Send anyway
        opens the wallet with the same call, and a revert is then recorded on-chain.
      </p>
      <button type="button" className="secondary" onClick={onSendAnyway} disabled={pending} data-testid="send-anyway">
        Send anyway
      </button>
    </div>
  );
}
