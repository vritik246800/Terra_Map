/**
 * Report actions (Fase 12, FEATURE_RELATORIOS.md, UX.md §2).
 *
 * Builds the `ReportInput` from the store and the scene — measured cable and
 * road lengths, the last simulation, the saved scenarios — and hands it to the
 * core, which computes statistics, BOM, CSV and PDF (the frontend never
 * recomputes them). The PDF carries a JPEG snapshot of the current view;
 * PDF/CSV are written through the core's native dialogs. Also samples the
 * terrain profile along the ruler and builds the metrics of the current state
 * for the scenario comparator (Q_LIST.md Q21).
 */
import {
  exportBomCsv,
  exportReportPdf,
  projectReport,
  terrainProfile,
  type ProfilePoint,
  type ReportData,
  type ReportInput,
  type Scenario,
} from "../net/bridge";
import type { CableRegistry } from "../scene/cables";
import type { RoadRegistry } from "../scene/roads";
import type { Terrain } from "../scene/terrain";
import { t } from "../state/i18n";
import { store } from "../state/store";
import { errorText, showToast } from "../state/toasts";

export interface ReportActions {
  /** Statistics + BOM of the current project. */
  data(): Promise<ReportData>;
  exportPdf(): Promise<void>;
  exportCsv(): Promise<void>;
  /** Terrain heights along the ruler measurement; `null` without one. */
  profile(): Promise<ProfilePoint[] | null>;
  /** Metrics of the current state (keys translated by the UI and the PDF). */
  metrics(data: ReportData): Scenario["metrics"];
}

export function createReportActions(deps: {
  terrain: Terrain;
  cables: CableRegistry;
  roads: RoadRegistry;
  snapshot(): Uint8Array | null;
}): ReportActions {
  const { terrain, cables, roads, snapshot } = deps;

  function input(): ReportInput {
    const { nodes, edges } = store.networkGraph();
    return {
      name: store.projectName,
      date: new Date().toLocaleDateString("en"),
      terrainSize: terrain.current.size,
      entities: nodes.map((n) => ({ id: n.id, kind: n.kind, props: n.dynamicProps })),
      cables: edges.map((c) => ({
        cableType: c.cableType,
        route: c.route,
        length: cables.getLength(c.id) ?? 0,
        props: c.dynamicProps,
      })),
      roads: store.allRoads().map((r) => ({ length: roads.getLength(r.id) })),
      simulation: store.simulation.result,
      scenarios: [...store.scenarios],
    };
  }

  return {
    data: () => projectReport(input()),

    async exportPdf() {
      try {
        const name = await exportReportPdf(input(), snapshot());
        if (name) showToast(t("toast.reportPdf", { file: name }), "success");
      } catch (err) {
        showToast(t("toast.exportFailed", { error: errorText(err) }), "danger");
      }
    },

    async exportCsv() {
      try {
        const name = await exportBomCsv(input());
        if (name) showToast(t("toast.reportCsv", { file: name }), "success");
      } catch (err) {
        showToast(t("toast.exportFailed", { error: errorText(err) }), "danger");
      }
    },

    async profile() {
      const { from, to } = store.ruler;
      if (!from || !to) return null;
      const { size, resolution } = terrain.current;
      return terrainProfile(
        { size, resolution, heights: Array.from(terrain.heights) },
        { x: from.x, z: from.z },
        { x: to.x, z: to.z },
      );
    },

    metrics(data) {
      const m = store.simulation.result?.metrics;
      return [
        { key: "buildings", value: data.stats.buildings },
        { key: "elements", value: data.stats.elements },
        { key: "cableM", value: data.stats.cableLengthM },
        { key: "cost", value: data.bom.total },
        ...(m
          ? [
              { key: "latencyMs", value: m.latencyMs },
              ...(m.bandwidthMbps === null
                ? []
                : [{ key: "bandwidthMbps", value: m.bandwidthMbps }]),
              { key: "attenuationDb", value: m.attenuationDb },
            ]
          : []),
      ];
    },
  };
}
