import { useLayoutEffect, useRef, useState } from "react";

import { playStartupAnimation } from "./anim/startup";
import { FabMenu } from "./components/FabMenu";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { Viewport } from "./components/Viewport";
import type { ViewportHandles } from "./scene/viewport";
import type { GlbActions } from "./tools/glb-io";
import type { TerrainActions } from "./tools/terrain-actions";

export interface AppProps {
  viewport: ViewportHandles;
  terrainActions: TerrainActions;
  glbActions: GlbActions;
}

/** App layout (DESIGN.md §5): top bar, catalog, viewport, properties, FAB, toasts. */
export function App({ viewport, terrainActions, glbActions }: AppProps) {
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
          onImport={() => void glbActions.importGlb()}
          onExport={() => void glbActions.exportGlb()}
          onTogglePanel={(side) => setOpenPanels((p) => ({ ...p, [side]: !p[side] }))}
        />
        <LeftPanel actions={terrainActions} open={openPanels.left} />
        <Viewport canvasHost={viewport.canvasHost} />
        <RightPanel
          actions={terrainActions}
          registry={viewport.registry}
          cables={viewport.cables}
          open={openPanels.right}
        />
      </div>
      <FabMenu />
      <Toasts />
    </>
  );
}
