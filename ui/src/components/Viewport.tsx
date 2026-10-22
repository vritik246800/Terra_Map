/**
 * Viewport shell (DESIGN.md §5, §14): `<main>` + the Fase 7 simulator card +
 * the Fase 9 minimap + the Fase 10 layers/history card (`L`) + the Fase 16
 * Rotate/Move camera switch (`H`). The three.js scene lives outside React —
 * `scene/viewport.ts` builds it once in `main.tsx`; this component only
 * attaches its canvas host and the minimap's canvas, and plays A20 when the
 * minimap expands/collapses.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { a20Resize } from "../anim/ui";
import type { Minimap } from "../scene/minimap";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import { t } from "../state/i18n";
import { store, type CameraMode } from "../state/store";
import { useStore } from "../state/use-store";
import type { HistoryActions } from "../tools/history";
import type { SimulationActions } from "../tools/simulation";
import { LayersPanel } from "./LayersPanel";
import { SimulationPanel } from "./SimulationPanel";

/** Minimap sizes in px (UX.md §5). */
const MINIMAP_SIZE = 180;
const MINIMAP_EXPANDED = 320;

const CAMERA_ICONS: Record<CameraMode, string> = {
  orbit: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  pan: "M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3",
};

/** Fase 16 (Q_LIST.md Q38): what a left-button drag does — rotate or move the camera. */
function CameraModeSwitch() {
  const { cameraMode } = useStore();
  return (
    <div className="camera-mode glass" role="group" aria-label={t("viewport.cameraMode")}>
      {(Object.keys(CAMERA_ICONS) as CameraMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`camera-mode__button${mode === cameraMode ? " is-active" : ""}`}
          aria-pressed={mode === cameraMode}
          aria-label={t(`viewport.${mode}`)}
          title={t(`viewport.${mode}`)}
          onClick={() => store.setCameraMode(mode)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d={CAMERA_ICONS[mode]} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function Viewport({
  canvasHost,
  minimap,
  simulation,
  history,
}: {
  canvasHost: HTMLElement;
  minimap: Minimap;
  simulation: SimulationActions;
  history: HistoryActions;
}) {
  const ref = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    // ponytail: the scene lives for the whole app, so no dispose — add one
    // to scene/viewport.ts if the viewport ever unmounts.
    ref.current?.prepend(canvasHost);
    mapRef.current?.prepend(minimap.host);
  }, [canvasHost, minimap]);

  // Fase 10: `L` toggles the layers + history card (UX.md §4).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === "l" && !shouldIgnoreShortcut(e)) store.toggleLayersPanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (mapRef.current) a20Resize(mapRef.current, expanded ? MINIMAP_EXPANDED : MINIMAP_SIZE);
  }, [expanded]);

  return (
    <main ref={ref} className="viewport" aria-label={t("viewport.label")}>
      <SimulationPanel simulation={simulation} />
      <LayersPanel history={history} />
      <CameraModeSwitch />
      <div ref={mapRef} className="minimap glass" aria-label={t("viewport.minimap")}>
        <button
          type="button"
          className="minimap-toggle"
          aria-label={t(expanded ? "viewport.collapse" : "viewport.expand")}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {expanded ? (
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            ) : (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            )}
          </svg>
        </button>
      </div>
    </main>
  );
}
