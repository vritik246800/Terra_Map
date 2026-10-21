/**
 * Ruler tool `R` (Fase 12, UX.md §2, ARCHITECTURE.md §11).
 *
 * The 1st click on the terrain fixes the start; the line and its label follow
 * the cursor with the partial distance; the 2nd click fixes the measurement
 * (A19: the line draws to the 2nd point while the label counts up) and the
 * store gets both points — the «Régua» panel section reads them; the next
 * click starts a new measurement. `R` or `Esc` leaves the tool, which clears
 * the measurement (temporary — never saved nor undone, Q_LIST.md Q22).
 */
import * as THREE from "three";

import { a19Measure } from "../anim/scene";
import { makeLabelSprite, setLabelText } from "../scene/network-models";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import type { Terrain } from "../scene/terrain";
import { store } from "../state/store";

const CLICK_THRESHOLD_PX = 4;
const LINE_COLOR = 0x0071e3; // --accent (DESIGN.md §1.8)
/** The label floats this far above the middle of the line (m). */
const LABEL_LIFT = 1.2;

export function initRulerTool(deps: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  terrain: Terrain;
}): void {
  const { canvas, camera, scene, terrain } = deps;
  const raycaster = new THREE.Raycaster();
  let start: THREE.Vector3 | null = null;
  let stopA19 = () => {};
  let downX = 0;
  let downY = 0;

  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: LINE_COLOR, depthTest: false }),
  );
  const label = makeLabelSprite("");
  label.material.depthTest = false;
  label.material.sizeAttenuation = false; // same size on screen at any zoom
  label.scale.set(0.16, 0.04, 1);
  line.renderOrder = label.renderOrder = 3;
  line.visible = label.visible = false;
  scene.add(line, label);

  function pick(e: MouseEvent): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    return raycaster.intersectObject(terrain.mesh, false)[0]?.point.clone() ?? null;
  }

  function draw(a: THREE.Vector3, b: THREE.Vector3, meters: number): void {
    line.geometry.setFromPoints([a, b]);
    label.position.copy(a).lerp(b, 0.5).y += LABEL_LIFT;
    setLabelText(label, `${meters.toFixed(1)} m`);
    line.visible = label.visible = true;
  }

  function hide(): void {
    stopA19();
    start = null;
    line.visible = label.visible = false;
  }

  canvas.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || store.tool !== "ruler") return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return;
    const p = pick(e);
    if (!p) return;
    if (!start || store.ruler.to) {
      // 1st point, or a new measurement after a finished one.
      hide();
      start = p;
      store.setRuler({ x: p.x, y: p.y, z: p.z }, null);
      return;
    }
    const a = start;
    const total = a.distanceTo(p);
    store.setRuler({ x: a.x, y: a.y, z: a.z }, { x: p.x, y: p.y, z: p.z });
    stopA19 = a19Measure((t) => draw(a, a.clone().lerp(p, t), total * t));
  });

  canvas.addEventListener("pointermove", (e) => {
    if (store.tool !== "ruler" || !start || store.ruler.to) return;
    const p = pick(e);
    if (p) draw(start, p, start.distanceTo(p)); // partial distance
  });

  window.addEventListener("keydown", (e) => {
    if (shouldIgnoreShortcut(e)) return;
    if (e.key === "r" || e.key === "R") store.setTool(store.tool === "ruler" ? "select" : "ruler");
    else if (e.key === "Escape" && store.tool === "ruler") store.setTool("select");
  });

  // Leaving the tool clears the measurement (the store forgets the points in `setTool`).
  store.subscribe(() => {
    if (store.tool !== "ruler" && (start || line.visible)) hide();
  });
}
