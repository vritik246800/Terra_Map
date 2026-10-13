/**
 * Viewport shell (DESIGN.md §5, §14): `<main>` + minimap placeholder (A20 in
 * a later phase). The three.js scene lives outside React — `scene/viewport.ts`
 * builds it once in `main.tsx`; this component only attaches its canvas host.
 */
import { useEffect, useRef } from "react";

export function Viewport({ canvasHost }: { canvasHost: HTMLElement }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // ponytail: the scene lives for the whole app, so no dispose — add one
    // to scene/viewport.ts if the viewport ever unmounts.
    ref.current?.prepend(canvasHost);
  }, [canvasHost]);

  return (
    <main ref={ref} className="viewport" aria-label="Viewport 3D">
      <div className="minimap glass" aria-label="Minimap">
        <span className="minimap-label">Minimap</span>
      </div>
    </main>
  );
}
