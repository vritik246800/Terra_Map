/**
 * Road tool (Fase 11, UX.md §2): each click on the terrain adds a point
 * (grid snap applies), a preview line follows the cursor; `Enter` or a
 * double click finishes (≥ 2 points), `Backspace` drops the last point and
 * `Esc` cancels. The finished road is selected and the tool returns to
 * `select`; a hidden/locked Infraestruturas layer refuses it with a toast.
 */
import * as THREE from "three";

import type { RoadRegistry } from "../scene/roads";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import type { Terrain } from "../scene/terrain";
import { layerBlockReason } from "../state/labels";
import { store } from "../state/store";
import { t } from "../state/i18n";
import { showToast } from "../state/toasts";

const CLICK_THRESHOLD_PX = 4;
/** Points closer than this to the previous one are dropped (double clicks). */
const MIN_SEGMENT_M = 0.5;
const PREVIEW_COLOR = 0x0071e3; // --accent

export function initRoadTool(deps: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  terrain: Terrain;
  roads: RoadRegistry;
}): void {
  const { canvas, camera, scene, terrain, roads } = deps;
  const raycaster = new THREE.Raycaster();
  let points: Array<{ x: number; z: number }> = [];
  let cursor: { x: number; z: number } | null = null;
  let downX = 0;
  let downY = 0;

  const preview = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: PREVIEW_COLOR, depthTest: false }),
  );
  preview.renderOrder = 2;
  preview.visible = false;
  scene.add(preview);

  function pickTerrain(e: MouseEvent): { x: number; z: number } | null {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster.intersectObject(terrain.mesh, false)[0];
    return hit ? { x: store.snapToGrid(hit.point.x), z: store.snapToGrid(hit.point.z) } : null;
  }

  function drawPreview(): void {
    const all = cursor ? [...points, cursor] : points;
    preview.visible = store.tool === "road" && all.length >= 2;
    preview.geometry.setFromPoints(
      all.map((p) => new THREE.Vector3(p.x, terrain.getHeight(p.x, p.z) + 0.3, p.z)),
    );
  }

  function reset(): void {
    points = [];
    cursor = null;
    drawPreview();
  }

  function finish(): void {
    if (points.length < 2) {
      showToast(t("toast.roadTooShort"), "info");
      return;
    }
    const road = roads.add(points, store.roadTool.width);
    reset();
    store.setTool("select");
    store.select(road.id);
  }

  canvas.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || store.tool !== "road") return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return;
    const blocked = layerBlockReason("infra");
    if (blocked) {
      showToast(blocked, "info");
      return;
    }
    const p = pickTerrain(e);
    if (!p) return;
    const last = points.at(-1);
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= MIN_SEGMENT_M) points.push(p);
    drawPreview();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (store.tool !== "road" || points.length === 0) return;
    cursor = pickTerrain(e);
    drawPreview();
  });

  canvas.addEventListener("dblclick", () => {
    if (store.tool === "road") finish();
  });

  window.addEventListener("keydown", (e) => {
    if (store.tool !== "road" || shouldIgnoreShortcut(e)) return;
    if (e.key === "Enter") finish();
    else if (e.key === "Backspace") {
      e.preventDefault();
      points.pop();
      drawPreview();
    } else if (e.key === "Escape") {
      reset();
      store.setTool("select");
    }
  });

  // Leaving the tool (catalog, another tool) discards an unfinished road.
  store.subscribe(() => {
    if (store.tool !== "road" && (points.length > 0 || preview.visible)) reset();
  });
}
