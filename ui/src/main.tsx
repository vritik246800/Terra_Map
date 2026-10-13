import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createViewport } from "./scene/viewport";
import { createGlbActions, initGlbShortcuts } from "./tools/glb-io";
import { createTerrainActions } from "./tools/terrain-actions";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  // The three.js scene is built once, outside React (ARCHITECTURE.md);
  // components talk to it through the store and these handles.
  const viewport = createViewport();
  const terrainActions = createTerrainActions(viewport.terrain);
  // Fase 5: .glb import/export (topbar buttons + Ctrl/Cmd+E / Ctrl/Cmd+I).
  const glbActions = createGlbActions({ terrain: viewport.terrain, registry: viewport.registry });
  initGlbShortcuts(glbActions);

  // No <StrictMode>: its double effects would attach the scene listeners twice.
  createRoot(app).render(
    <App viewport={viewport} terrainActions={terrainActions} glbActions={glbActions} />,
  );

  // Default terrain on start: flat (DESIGN.md §8.2).
  terrainActions
    .createFromPreset("flat")
    .catch((err: unknown) => console.error("[terreno] falha ao criar terreno inicial:", err));
}
