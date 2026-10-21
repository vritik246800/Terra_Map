/**
 * Simulator actions (Fase 7, FEATURE_SIMULADOR_REDES.md).
 *
 * Builds the `NetworkInput` snapshot (store graph + cable lengths measured by
 * the CableRegistry + simulated failures), asks the Rust core for the optimal
 * path / antenna coverage and hands the results to the store (panel) and the
 * scene overlay (A12/A14). The frontend never recomputes what the core
 * returns. Toggling a failure re-runs the last simulation at once, so the
 * alternative route (or "no path") shows immediately.
 */
import * as THREE from "three";

import {
  antennaCoverage,
  exportSimulationCsv,
  shortestPath,
  type NetworkInput,
} from "../net/bridge";
import type { CableRegistry } from "../scene/cables";
import type { EntityRegistry } from "../scene/entities";
import type { SimOverlay } from "../scene/sim-overlay";
import type { Terrain } from "../scene/terrain";
import { store } from "../state/store";
import { errorText, showToast } from "../state/toasts";

export interface SimulationActions {
  run(): Promise<void>;
  toggleFailure(id: string): void;
  coverage(antennaId: string): Promise<void>;
  exportCsv(): Promise<void>;
  clear(): void;
}

export interface SimulationDeps {
  registry: EntityRegistry;
  cables: CableRegistry;
  terrain: Terrain;
  overlay: SimOverlay;
}

export function createSimulationActions(deps: SimulationDeps): SimulationActions {
  const { registry, cables, terrain, overlay } = deps;

  function networkInput(): NetworkInput {
    const { nodes, edges } = store.networkGraph();
    const failed = store.simulation.failed;
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        props: n.dynamicProps,
        active: !failed.has(n.id),
      })),
      edges: edges.map((c) => ({
        id: c.id,
        fromId: c.fromId,
        toId: c.toId,
        cableType: c.cableType,
        length: cables.getLength(c.id) ?? 0,
        props: c.dynamicProps,
        active: !failed.has(c.id),
      })),
    };
  }

  async function run(): Promise<void> {
    const { fromId, toId, weight } = store.simulation;
    if (!fromId || !toId) return;
    try {
      const result = await shortestPath(networkInput(), fromId, toId, weight);
      if (result) {
        store.setSimResult(result);
        overlay.showPath(result);
      } else {
        store.setSimResult(null, true);
        overlay.clearPath();
        showToast(`Sem caminho ativo entre ${fromId} e ${toId}.`, "danger");
      }
    } catch (err) {
      showToast(`Simulação falhou: ${errorText(err)}`, "danger");
    }
  }

  // A deleted endpoint/cable makes the store drop the stale result; the
  // overlay follows (scene objects are not owned by the store).
  store.subscribe(() => {
    if (!store.simulation.result) overlay.clearPath();
    if (!store.simulation.coverage) overlay.clearCoverage();
  });

  return {
    run,

    toggleFailure(id) {
      store.toggleFailed(id);
      if (store.simulation.result || store.simulation.noPath) void run();
    },

    async coverage(antennaId) {
      const root = registry.getObject(antennaId);
      const info = store.getEntityInfo(antennaId);
      if (!root || !info) return;
      const { size, resolution } = terrain.current;
      try {
        const result = await antennaCoverage(
          {
            x: root.position.x,
            z: root.position.z,
            txHeight: new THREE.Box3().setFromObject(root).max.y,
            props: info.dynamicProps,
          },
          { size, resolution, heights: Array.from(terrain.heights) },
        );
        store.setCoverage({ antennaId, result });
        overlay.showCoverage(root.position.x, root.position.z, result);
      } catch (err) {
        showToast(`Cobertura falhou: ${errorText(err)}`, "danger");
      }
    },

    async exportCsv() {
      const result = store.simulation.result;
      if (!result) return;
      try {
        const path = await exportSimulationCsv(result);
        if (path) showToast("Resultados exportados (CSV).", "success");
      } catch (err) {
        showToast(`Exportação falhou: ${errorText(err)}`, "danger");
      }
    },

    clear() {
      store.clearSimulation();
      overlay.clearPath();
      overlay.clearCoverage();
    },
  };
}
