import { playStartupAnimation } from "./anim/startup";
import { createViewport } from "./scene/viewport";
import { createGlbActions, initGlbShortcuts } from "./tools/glb-io";
import { createTerrainActions } from "./tools/terrain-actions";
import { createFabMenu } from "./ui/fab-menu";
import { createLeftPanel } from "./ui/left-panel";
import { createRightPanel } from "./ui/right-panel";
import { createTopBar } from "./ui/topbar";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  const viewport = createViewport();
  const terrainActions = createTerrainActions(viewport.terrain);
  // Fase 5: .glb import/export (topbar buttons + Ctrl/Cmd+E / Ctrl/Cmd+I).
  const glbActions = createGlbActions({
    terrain: viewport.terrain,
    registry: viewport.registry,
  });
  initGlbShortcuts(glbActions);

  const layout = document.createElement("div");
  layout.className = "app";
  layout.append(
    createTopBar({
      onImport: () => void glbActions.importGlb(),
      onExport: () => void glbActions.exportGlb(),
    }),
    createLeftPanel(terrainActions),
    viewport.root,
    createRightPanel(terrainActions, viewport.registry),
  );

  app.append(layout, createFabMenu());
  playStartupAnimation(layout);

  // Default terrain on start: flat (DESIGN.md §8.2).
  terrainActions
    .createFromPreset("flat")
    .catch((err: unknown) => console.error("[terreno] falha ao criar terreno inicial:", err));
}
