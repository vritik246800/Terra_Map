import { useLayoutEffect, useRef, useState } from "react";

import { playStartupAnimation } from "./anim/startup";
import { LeftPanel } from "./components/LeftPanel";
import { ModalHost } from "./components/ModalHost";
import { RightPanel } from "./components/RightPanel";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { Viewport } from "./components/Viewport";
import type { ViewportHandles } from "./scene/viewport";
import type { GlbActions } from "./tools/glb-io";
import type { HistoryActions } from "./tools/history";
import type { PresentationActions } from "./tools/presentation";
import type { ProjectActions } from "./tools/project-io";
import type { ReportActions } from "./tools/report";
import type { SimulationActions } from "./tools/simulation";
import type { TerrainActions } from "./tools/terrain-actions";

export interface AppProps {
  viewport: ViewportHandles;
  terrainActions: TerrainActions;
  glbActions: GlbActions;
  simulationActions: SimulationActions;
  projectActions: ProjectActions;
  history: HistoryActions;
  presentation: PresentationActions;
  report: ReportActions;
}

/**
 * App layout (DESIGN.md §5): the viewport fills the window and the top bar,
 * catalog and properties float over it (Fase 17); modals, toasts.
 */
export function App({
  viewport,
  terrainActions,
  glbActions,
  simulationActions,
  projectActions,
  history,
  presentation,
  report,
}: AppProps) {
  const layoutRef = useRef<HTMLDivElement>(null);
  // Narrow screens: side panels slide over the viewport when toggled.
  const [openPanels, setOpenPanels] = useState({ left: false, right: false });

  // A1/A2 boot sequence, once.
  useLayoutEffect(() => {
    if (layoutRef.current) playStartupAnimation(layoutRef.current);
  }, []);

  return (
    <>
      <div ref={layoutRef} className="app">
        <TopBar
          onSave={() => void projectActions.save()}
          onSaveAs={() => void projectActions.save(true)}
          onOpen={() => void projectActions.open()}
          onImport={() => void glbActions.importGlb()}
          onExport={() => void glbActions.exportGlb()}
          onPresent={presentation.start}
          onTogglePanel={(side) => setOpenPanels((p) => ({ ...p, [side]: !p[side] }))}
        />
        <LeftPanel actions={terrainActions} open={openPanels.left} onPresent={presentation.start} />
        <Viewport
          canvasHost={viewport.canvasHost}
          minimap={viewport.minimap}
          simulation={simulationActions}
          history={history}
        />
        <RightPanel
          actions={terrainActions}
          registry={viewport.registry}
          cables={viewport.cables}
          roads={viewport.roads}
          simulation={simulationActions}
          open={openPanels.right}
        />
      </div>
      <ModalHost project={projectActions} report={report} />
      <Toasts />
    </>
  );
}
