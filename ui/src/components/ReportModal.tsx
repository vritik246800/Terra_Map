/**
 * "Relatório" modal (Fase 12, UX.md §2, FEATURE_RELATORIOS.md): statistics,
 * bill of materials and last simulation as computed by the core, the
 * scenario comparator (save the current metrics under a name, compare them
 * side by side with the current state, remove) and the PDF/CSV exports.
 */
import { useEffect, useState } from "react";

import type { ReportData, Scenario } from "../net/bridge";
import { fmt, t, type MessageKey } from "../state/i18n";
import { errorText } from "../state/toasts";
import { useStore } from "../state/use-store";
import type { ReportActions } from "../tools/report";
import { Modal } from "./Modal";

/** Scenario metric keys (written by `tools/report.ts`) and their decimals; labels: `report.metrics.*`. */
const METRICS: ReadonlyArray<[key: string, decimals: number]> = [
  ["buildings", 0],
  ["elements", 0],
  ["cableM", 1],
  ["cost", 2],
  ["latencyMs", 3],
  ["bandwidthMbps", 1],
  ["attenuationDb", 2],
];
const CABLE_LABELS: Record<string, MessageKey> = {
  fiber: "report.cableFiber",
  copper: "report.cableCopper",
  coax: "report.cableCoax",
};
/** Same cap as the core (`project_file.rs`). */
const MAX_SCENARIOS = 50;

const eur = (v: number) => `${fmt(v, 2)} €`;

function Table({
  head,
  rows,
  total = false,
}: {
  head?: string[];
  rows: Array<Array<string>>;
  /** Last row is a total (bold). */
  total?: boolean;
}) {
  return (
    <table className={`report-table${total ? " report-table--total" : ""}`}>
      {head && (
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Scenarios({ report, data }: { report: ReportActions; data: ReportData }) {
  const store = useStore();
  const [name, setName] = useState("");
  const current = report.metrics(data);
  const columns: Array<Scenario & { index?: number }> = [
    { name: t("report.current"), metrics: current },
    ...store.scenarios.map((sc, index) => ({ ...sc, index })),
  ];
  const keys = METRICS.filter(([key]) => columns.some((c) => c.metrics.some((m) => m.key === key)));
  const full = store.scenarios.length >= MAX_SCENARIOS;

  function save(): void {
    const trimmed = name.trim() || t("report.scenarioDefault", { n: store.scenarios.length + 1 });
    store.addScenario({ name: trimmed, metrics: current });
    setName("");
  }

  return (
    <section className="report-section">
      <h3 className="report-section__title">{t("report.scenarios")}</h3>
      <form
        className="report-scenario-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!full) save();
        }}
      >
        <input
          type="text"
          className="properties-input"
          placeholder={t("report.scenarioDefault", { n: store.scenarios.length + 1 })}
          aria-label={t("report.scenarioName")}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="modal__button" disabled={full}>
          {t("report.saveScenario")}
        </button>
      </form>
      <div className="report-scroll">
        <table className="report-table report-table--compare">
          <thead>
            <tr>
              <th scope="col">{t("report.metric")}</th>
              {columns.map((c) => (
                <th key={c.index ?? "current"} scope="col">
                  <span className="report-scenario-name">{c.name}</span>
                  {c.index !== undefined && (
                    <button
                      type="button"
                      className="report-remove"
                      aria-label={t("report.removeScenario", { name: c.name })}
                      onClick={() => store.removeScenario(c.index ?? -1)}
                    >
                      ×
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(([key, decimals]) => (
              <tr key={key}>
                <th scope="row">{t(`report.metrics.${key}` as MessageKey)}</th>
                {columns.map((c) => {
                  const v = c.metrics.find((m) => m.key === key)?.value;
                  return (
                    <td key={c.index ?? "current"}>{v === undefined ? "—" : fmt(v, decimals)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="properties-section__hint">{t("report.scenariosHint")}</p>
    </section>
  );
}

export function ReportModal({ report, onClose }: { report: ReportActions; onClose: () => void }) {
  const store = useStore();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    report
      .data()
      .then((d) => alive && setData(d))
      .catch((err: unknown) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [report]);

  const sim = store.simulation.result;
  const s = data?.stats;

  return (
    <Modal title={t("report.title", { name: store.projectName })} onDismiss={onClose} wide>
      {error && (
        <p className="sim-panel__alert" role="alert">
          {t("report.error", { error })}
        </p>
      )}
      {!data && !error && <p className="modal__text">{t("common.calculating")}</p>}
      {data && s && (
        <>
          <section className="report-section">
            <h3 className="report-section__title">{t("report.stats")}</h3>
            <Table
              total
              rows={[
                [t("report.area"), `${fmt(s.areaM2)} m²`],
                [t("report.buildings"), String(s.buildings)],
                [t("report.elements"), String(s.elements)],
                [t("report.markers"), String(s.markers)],
                [t("report.roads"), `${s.roads} (${fmt(s.roadLengthM, 1)} m)`],
                ...s.cables.map((c) => [
                  CABLE_LABELS[c.cableType] ? t(CABLE_LABELS[c.cableType]) : c.cableType,
                  `${c.count} · ${fmt(c.meters, 1)} m`,
                ]),
                [t("report.cableTotal"), `${fmt(s.cableLengthM, 1)} m`],
              ]}
            />
          </section>

          <section className="report-section">
            <h3 className="report-section__title">{t("report.bom")}</h3>
            {data.bom.rows.length === 0 ? (
              <p className="properties-section__hint">{t("report.bomEmpty")}</p>
            ) : (
              <Table
                total
                head={[
                  t("report.item"),
                  t("report.quantity"),
                  t("report.unitCost"),
                  t("report.total"),
                ]}
                rows={[
                  ...data.bom.rows.map((r) => [
                    r.item,
                    `${fmt(r.quantity, r.unit === "m" ? 1 : 0)} ${r.unit}`,
                    eur(r.unitCost),
                    eur(r.total),
                  ]),
                  [t("report.projectTotal"), "", "", eur(data.bom.total)],
                ]}
              />
            )}
            <p className="properties-section__hint">{t("report.pricesNote")}</p>
          </section>

          <section className="report-section">
            <h3 className="report-section__title">{t("report.simulation")}</h3>
            {sim ? (
              <Table
                rows={[
                  [t("report.path"), sim.nodes.join(" → ")],
                  [t("report.length"), `${fmt(sim.metrics.lengthM, 1)} m`],
                  [t("report.latency"), `${fmt(sim.metrics.latencyMs, 3)} ms`],
                  [
                    t("report.bandwidth"),
                    sim.metrics.bandwidthMbps === null
                      ? "—"
                      : `${fmt(sim.metrics.bandwidthMbps)} Mbps`,
                  ],
                  [t("report.cost"), eur(sim.metrics.cost)],
                  [t("report.attenuation"), `${fmt(sim.metrics.attenuationDb, 2)} dB`],
                  ...(sim.metrics.linkBudget
                    ? [
                        [
                          t("report.received"),
                          t("report.receivedValue", {
                            prx: fmt(sim.metrics.linkBudget.prxDbm, 1),
                            headroom: fmt(sim.metrics.linkBudget.headroomDb, 1),
                          }),
                        ],
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className="properties-section__hint">{t("report.noSimulation")}</p>
            )}
          </section>

          <Scenarios report={report} data={data} />
        </>
      )}
      <div className="modal__actions">
        <button type="button" className="modal__button" onClick={() => void report.exportCsv()}>
          {t("report.exportCsv")}
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void report.exportPdf()}
        >
          {t("report.exportPdf")}
        </button>
      </div>
    </Modal>
  );
}
