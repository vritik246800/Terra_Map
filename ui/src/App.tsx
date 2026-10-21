import { useLayoutEffect, useRef, useState } from "react";

import { playStartupAnimation } from "./anim/startup";
import { FabMenu } from "./components/FabMenu";
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

/** App layout (DESIGN.md §5): top bar, catalog, viewport, properties, FAB, modals, toasts. */
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
          onOpen={() => void projectActions.open()}
          onImport={() => void glbActions.importGlb()}
          onExport={() => void glbActions.exportGlb()}
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
      <FabMenu />
      <ModalHost project={projectActions} report={report} />
      <Toasts />
    </>
  );
}
