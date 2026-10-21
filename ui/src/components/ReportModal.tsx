/**
 * "Relatório" modal (Fase 12, UX.md §2, FEATURE_RELATORIOS.md): statistics,
 * bill of materials and last simulation as computed by the core, the
 * scenario comparator (save the current metrics under a name, compare them
 * side by side with the current state, remove) and the PDF/CSV exports.
 */
import { useEffect, useState } from "react";

import type { ReportData, Scenario } from "../net/bridge";
import { errorText } from "../state/toasts";
import { useStore } from "../state/use-store";
import type { ReportActions } from "../tools/report";
import { Modal } from "./Modal";

/** Scenario metric keys (written by `tools/report.ts`): pt-PT label, decimals. */
const METRICS: ReadonlyArray<[key: string, label: string, decimals: number]> = [
  ["buildings", "Edifícios", 0],
  ["elements", "Elementos de rede", 0],
  ["cableM", "Cabo (m)", 1],
  ["cost", "Custo da BOM (€)", 2],
  ["latencyMs", "Latência (ms)", 3],
  ["bandwidthMbps", "Débito (Mbps)", 1],
  ["attenuationDb", "Atenuação (dB)", 2],
];
const CABLE_LABELS: Record<string, string> = {
  fiber: "Cabo de fibra",
  copper: "Cabo de cobre",
  coax: "Cabo coaxial",
};
/** Same cap as the core (`project_file.rs`). */
const MAX_SCENARIOS = 50;

const eur = (v: number) => `${v.toFixed(2)} €`;

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
    { name: "Atual", metrics: current },
    ...store.scenarios.map((sc, index) => ({ ...sc, index })),
  ];
  const keys = METRICS.filter(([key]) => columns.some((c) => c.metrics.some((m) => m.key === key)));
  const full = store.scenarios.length >= MAX_SCENARIOS;

  function save(): void {
    const trimmed = name.trim() || `Cenário ${store.scenarios.length + 1}`;
    store.addScenario({ name: trimmed, metrics: current });
    setName("");
  }

  return (
    <section className="report-section">
      <h3 className="report-section__title">Cenários</h3>
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
          placeholder={`Cenário ${store.scenarios.length + 1}`}
          aria-label="Nome do cenário"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="modal__button" disabled={full}>
          Guardar cenário
        </button>
      </form>
      <div className="report-scroll">
        <table className="report-table report-table--compare">
          <thead>
            <tr>
              <th scope="col">Métrica</th>
              {columns.map((c) => (
                <th key={c.index ?? "current"} scope="col">
                  <span className="report-scenario-name">{c.name}</span>
                  {c.index !== undefined && (
                    <button
                      type="button"
                      className="report-remove"
                      aria-label={`Remover o cenário ${c.name}`}
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
            {keys.map(([key, label, decimals]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {columns.map((c) => {
                  const v = c.metrics.find((m) => m.key === key)?.value;
                  return (
                    <td key={c.index ?? "current"}>
                      {v === undefined ? "—" : v.toFixed(decimals)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="properties-section__hint">
        «Guardar cenário» fotografa as métricas atuais no projeto; altera a rede e compara lado a
        lado com o estado atual.
      </p>
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
    <Modal title={`Relatório — ${store.projectName}`} onDismiss={onClose} wide>
      {error && (
        <p className="sim-panel__alert" role="alert">
          Não foi possível calcular o relatório: {error}
        </p>
      )}
      {!data && !error && <p className="modal__text">A calcular…</p>}
      {data && s && (
        <>
          <section className="report-section">
            <h3 className="report-section__title">Estatísticas</h3>
            <Table
              total
              rows={[
                ["Área do terreno", `${s.areaM2.toFixed(0)} m²`],
                ["Edifícios", String(s.buildings)],
                ["Elementos de rede", String(s.elements)],
                ["Marcadores", String(s.markers)],
                ["Estradas", `${s.roads} (${s.roadLengthM.toFixed(1)} m)`],
                ...s.cables.map((c) => [
                  CABLE_LABELS[c.cableType] ?? c.cableType,
                  `${c.count} · ${c.meters.toFixed(1)} m`,
                ]),
                ["Cabo no total", `${s.cableLengthM.toFixed(1)} m`],
              ]}
            />
          </section>

          <section className="report-section">
            <h3 className="report-section__title">Lista de materiais (BOM)</h3>
            {data.bom.rows.length === 0 ? (
              <p className="properties-section__hint">
                Sem materiais de rede — coloca elementos e cabos de Redes & Telecom.
              </p>
            ) : (
              <Table
                total
                head={["Elemento", "Quantidade", "Custo unitário", "Total"]}
                rows={[
                  ...data.bom.rows.map((r) => [
                    r.item,
                    `${r.quantity.toFixed(r.unit === "m" ? 1 : 0)} ${r.unit}`,
                    eur(r.unitCost),
                    eur(r.total),
                  ]),
                  ["Total do projeto", "", "", eur(data.bom.total)],
                ]}
              />
            )}
            <p className="properties-section__hint">
              Preços e mão de obra simbólicos: catálogo por tipo ou prop «price»; cabos pelo
              «costPerMeter».
            </p>
          </section>

          <section className="report-section">
            <h3 className="report-section__title">Simulação</h3>
            {sim ? (
              <Table
                rows={[
                  ["Caminho", sim.nodes.join(" → ")],
                  ["Comprimento", `${sim.metrics.lengthM.toFixed(1)} m`],
                  ["Latência", `${sim.metrics.latencyMs.toFixed(3)} ms`],
                  [
                    "Débito (gargalo)",
                    sim.metrics.bandwidthMbps === null ? "—" : `${sim.metrics.bandwidthMbps} Mbps`,
                  ],
                  ["Custo", eur(sim.metrics.cost)],
                  ["Atenuação", `${sim.metrics.attenuationDb.toFixed(2)} dB`],
                  ...(sim.metrics.linkBudget
                    ? [
                        [
                          "Potência recebida",
                          `${sim.metrics.linkBudget.prxDbm.toFixed(1)} dBm (folga ${sim.metrics.linkBudget.headroomDb.toFixed(1)} dB)`,
                        ],
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className="properties-section__hint">
                Sem simulação calculada — escolhe origem e destino e calcula o caminho no simulador.
              </p>
            )}
          </section>

          <Scenarios report={report} data={data} />
        </>
      )}
      <div className="modal__actions">
        <button type="button" className="modal__button" onClick={() => void report.exportCsv()}>
          Exportar CSV
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void report.exportPdf()}
        >
          Exportar PDF
        </button>
      </div>
    </Modal>
  );
}
