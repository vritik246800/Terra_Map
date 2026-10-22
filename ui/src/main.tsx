import { createRoot } from "react-dom/client";

import { App } from "./App";
import { shouldShowOnboarding } from "./components/OnboardingModal";
import { loadModels } from "./scene/models";
import { createViewport } from "./scene/viewport";
import { store } from "./state/store";
import { createGlbActions, initGlbShortcuts } from "./tools/glb-io";
import { createHistory } from "./tools/history";
import { createPresentation } from "./tools/presentation";
import { createProjectActions, initProjectShortcuts } from "./tools/project-io";
import { createReportActions } from "./tools/report";
import { createSimulationActions } from "./tools/simulation";
import { createTerrainActions } from "./tools/terrain-actions";
import { update } from "./tools/update-check";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

// Fase 16: the Blender models load before anything can spawn an entity.
if (app) void loadModels().then(() => start(app));

function start(app: HTMLDivElement): void {
  // The three.js scene is built once, outside React (ARCHITECTURE.md);
  // components talk to it through the store and these handles.
  const viewport = createViewport();
  const terrainActions = createTerrainActions(viewport.terrain);
  // Fase 5: .glb import/export (topbar buttons + Ctrl/Cmd+E / Ctrl/Cmd+I).
  const glbActions = createGlbActions({
    terrain: viewport.terrain,
    registry: viewport.registry,
    // Fase 11: roads, water and vegetation go into a full-maquete export too.
    extras: () => [
      ...viewport.roads.pickables,
      ...viewport.vegetation.objects,
      ...(viewport.environment.water.visible ? [viewport.environment.water] : []),
    ],
  });
  initGlbShortcuts(glbActions);
  // Fase 7: network simulator (Dijkstra, link budget, coverage in the core).
  const simulationActions = createSimulationActions(viewport);
  // Fase 8: project save/open, autosave, recovery, close guard.
  // Fase 10: undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
  const history = createHistory(viewport);
  const projectActions = createProjectActions({ ...viewport, history });
  initProjectShortcuts(projectActions);

  // No <StrictMode>: its double effects would attach the scene listeners twice.
  createRoot(app).render(
    <App
      viewport={viewport}
      terrainActions={terrainActions}
      glbActions={glbActions}
      simulationActions={simulationActions}
      projectActions={projectActions}
      history={history}
      presentation={createPresentation(viewport)}
      report={createReportActions(viewport)} // Fase 12: stats, BOM, PDF/CSV, profile
    />,
  );

  // Default terrain on start: flat (DESIGN.md §8.2) — the clean starting
  // point (not an unsaved change); then offer the crash-recovery copy.
  terrainActions
    .createFromPreset("flat")
    .catch((err: unknown) => console.error("[terreno] falha ao criar terreno inicial:", err))
    .finally(() => {
      store.markSaved();
      history.reset(); // the initial terrain is the starting point, not an action
      void projectActions.checkRecovery().then(() => {
        // Fase 13 (Q_LIST.md Q26): first-run intro, unless the recovery prompt is up.
        if (!store.modal && shouldShowOnboarding()) store.openModal("onboarding");
        void update.check(); // Fase 14 (Q_LIST.md Q29): optional update notice
      });
    });
}
