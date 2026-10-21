/**
 * Simulator card over the viewport (Fase 7, UX.md §1.1, Q_LIST.md Q06):
 * origin/destination, Dijkstra criterion, "Calcular", the results table of
 * FEATURE_SIMULADOR_REDES.md §2.4 (link budget with an ok/warn/danger dot),
 * CSV export and the antenna coverage summary. Hidden while the simulator
 * is idle; values come straight from the core result.
 */
import type { SimStatus, SimWeight } from "../net/bridge";
import { fmt, t } from "../state/i18n";
import { useStore } from "../state/use-store";
import type { SimulationActions } from "../tools/simulation";
import { SegmentedPicker } from "./SegmentedPicker";
import "./simulation-panel.css";

const weightLabels = (): Record<SimWeight, string> => ({
  distance: t("sim.distance"),
  cost: t("sim.cost"),
  latency: t("sim.latency"),
  attenuation: t("sim.attenuation"),
});

const statusLabel = (status: SimStatus): string => t(`sim.${status}`);

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
    <section className="sim-panel glass" aria-label={t("sim.label")}>
      <header className="sim-panel__header">
        <h2 className="sim-panel__title">{t("sim.title")}</h2>
        <button type="button" className="sim-panel__clear" onClick={simulation.clear}>
          {t("sim.clear")}
        </button>
      </header>

      <dl className="properties-list">
        {[
          [t("sim.from"), sim.fromId ?? "—"],
          [t("sim.to"), sim.toId ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>

      <SegmentedPicker
        label={t("sim.weight")}
        options={weightLabels()}
        value={sim.weight}
        onChange={changeWeight}
      />

      <button
        type="button"
        className="properties-action"
        disabled={!sim.fromId || !sim.toId}
        onClick={() => void simulation.run()}
      >
        {t("sim.run")}
      </button>

      {sim.noPath && (
        <p className="sim-panel__alert" role="alert">
          {t("sim.noPath")}
        </p>
      )}

      {sim.result && m && (
        <>
          <table className="sim-panel__table">
            <tbody>
              <Row label={t("sim.path")} value={sim.result.nodes.join(" → ")} />
              <Row label={t("sim.cables")} value={String(sim.result.edges.length)} />
              <Row label={t("sim.length")} value={`${fmt(m.lengthM, 1)} m`} />
              <Row label={t("sim.latency")} value={`${fmt(m.latencyMs, 3)} ms`} />
              <Row
                label={t("sim.bandwidth")}
                value={m.bandwidthMbps === null ? "—" : `${fmt(m.bandwidthMbps)} Mbps`}
              />
              <Row label={t("sim.cost")} value={`${fmt(m.cost, 2)} €`} />
              <Row label={t("sim.attenuation")} value={`${fmt(m.attenuationDb, 2)} dB`} />
              {lb && <Row label={t("sim.prx")} value={`${fmt(lb.prxDbm, 1)} dBm`} />}
              {lb && <Row label={t("sim.headroom")} value={`${fmt(lb.headroomDb, 1)} dB`} />}
            </tbody>
          </table>
          {lb ? (
            <p className={`sim-panel__status sim-panel__status--${lb.status}`}>
              {t("sim.budget", { status: statusLabel(lb.status) })}
            </p>
          ) : (
            <p className="properties-section__hint">{t("sim.budgetMissing")}</p>
          )}
          <button
            type="button"
            className="sim-panel__secondary"
            onClick={() => void simulation.exportCsv()}
          >
            {t("sim.exportCsv")}
          </button>
        </>
      )}

      {sim.coverage && (
        <p className="properties-section__hint">
          {t("sim.coverage", {
            id: sim.coverage.antennaId,
            pct: Math.round(sim.coverage.result.coveredRatio * 100),
            dbm: fmt(sim.coverage.result.sensitivityDbm),
          })}
        </p>
      )}
    </section>
  );
}
