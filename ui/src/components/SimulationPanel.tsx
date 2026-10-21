/**
 * Simulator card over the viewport (Fase 7, UX.md §1.1, Q_LIST.md Q06):
 * origin/destination, Dijkstra criterion, "Calcular", the results table of
 * FEATURE_SIMULADOR_REDES.md §2.4 (link budget with an ok/warn/danger dot),
 * CSV export and the antenna coverage summary. Hidden while the simulator
 * is idle; values come straight from the core result.
 */
import type { SimStatus, SimWeight } from "../net/bridge";
import { useStore } from "../state/use-store";
import type { SimulationActions } from "../tools/simulation";
import { SegmentedPicker } from "./SegmentedPicker";
import "./simulation-panel.css";

const WEIGHT_LABELS: Record<SimWeight, string> = {
  distance: "Distância",
  cost: "Custo",
  latency: "Latência",
  attenuation: "Atenuação",
};

const STATUS_LABELS: Record<SimStatus, string> = {
  ok: "OK",
  warn: "No limite",
  danger: "Abaixo da sensibilidade",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{value}</td>
    </tr>
  );
}

export function SimulationPanel({ simulation }: { simulation: SimulationActions }) {
  const store = useStore();
  const sim = store.simulation;
  if (!sim.fromId && !sim.toId && !sim.result && !sim.noPath && !sim.coverage) return null;

  const m = sim.result?.metrics;
  const lb = m?.linkBudget;

  function changeWeight(weight: SimWeight): void {
    store.setSimWeight(weight);
    if (store.simulation.result) void simulation.run();
  }

  return (
    <section className="sim-panel glass" aria-label="Simulador de redes">
      <header className="sim-panel__header">
        <h2 className="sim-panel__title">Simulador</h2>
        <button type="button" className="sim-panel__clear" onClick={simulation.clear}>
          Limpar
        </button>
      </header>

      <dl className="properties-list">
        {[
          ["Origem", sim.fromId ?? "—"],
          ["Destino", sim.toId ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>

      <SegmentedPicker
        label="Critério"
        options={WEIGHT_LABELS}
        value={sim.weight}
        onChange={changeWeight}
      />

      <button
        type="button"
        className="properties-action"
        disabled={!sim.fromId || !sim.toId}
        onClick={() => void simulation.run()}
      >
        Calcular caminho
      </button>

      {sim.noPath && (
        <p className="sim-panel__alert" role="alert">
          Sem caminho ativo entre a origem e o destino.
        </p>
      )}

      {sim.result && m && (
        <>
          <table className="sim-panel__table">
            <tbody>
              <Row label="Caminho" value={sim.result.nodes.join(" → ")} />
              <Row label="Cabos" value={String(sim.result.edges.length)} />
              <Row label="Comprimento" value={`${m.lengthM.toFixed(1)} m`} />
              <Row label="Latência" value={`${m.latencyMs.toFixed(3)} ms`} />
              <Row
                label="Débito"
                value={m.bandwidthMbps === null ? "—" : `${m.bandwidthMbps} Mbps`}
              />
              <Row label="Custo" value={`${m.cost.toFixed(2)} €`} />
              <Row label="Atenuação" value={`${m.attenuationDb.toFixed(2)} dB`} />
              {lb && <Row label="Prx" value={`${lb.prxDbm.toFixed(1)} dBm`} />}
              {lb && <Row label="Folga" value={`${lb.headroomDb.toFixed(1)} dB`} />}
            </tbody>
          </table>
          {lb ? (
            <p className={`sim-panel__status sim-panel__status--${lb.status}`}>
              Link budget: {STATUS_LABELS[lb.status]}
            </p>
          ) : (
            <p className="properties-section__hint">
              Link budget: precisa de «power» na origem e «sensitivity» no destino.
            </p>
          )}
          <button
            type="button"
            className="sim-panel__secondary"
            onClick={() => void simulation.exportCsv()}
          >
            Exportar CSV
          </button>
        </>
      )}

      {sim.coverage && (
        <p className="properties-section__hint">
          Cobertura de {sim.coverage.antennaId}:{" "}
          {Math.round(sim.coverage.result.coveredRatio * 100)}% da área no alcance com sinal acima
          de {sim.coverage.result.sensitivityDbm} dBm.
        </p>
      )}
    </section>
  );
}
