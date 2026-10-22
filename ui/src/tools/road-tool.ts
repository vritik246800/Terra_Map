/**
 * Road tool (Fase 11, UX.md §2).
 *
 * Fase 17 — drag to build, like Cities: Skylines: press on the terrain, drag
 * and release lays a stretch at once (the tool stays on for the next one). A
 * live preview shows the band of the road (accent, translucent) with its
 * length, the angle to the road it starts from and its grade. While the road
 * tool is on, the left button belongs to it (camera: right button —
 * `tools/brush.ts`).
 *
 * Fase 18 (Q_LIST.md Q48) — joined roads: every point (drag ends, clicks)
 * snaps to a point of another road within 4 m or onto the road under the
 * pointer (`RoadRegistry.snap` — a green ring shows it even before pressing)
 * and takes the height there; `RoadRegistry.lay` joins them: a shared point
 * in the middle of the other road, or one road when an end carries on.
 *
 * Point by point still works: each click adds a point (grid snap applies),
 * `Enter` or a double click finishes (≥ 2 points), `Backspace` drops the last
 * point and `Esc` cancels/leaves. A hidden/locked Infraestruturas layer
 * refuses roads with a toast. New roads take the width and Bridge height of
 * the tool section.
 */
import * as THREE from "three";

import { bandGeometry, sampleRoad, type RoadRegistry, type RoadSnap } from "../scene/roads";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import type { Terrain } from "../scene/terrain";
import { layerBlockReason } from "../state/labels";
import { store, type RoadPoint } from "../state/store";
import { fmt, t } from "../state/i18n";
import { showToast } from "../state/toasts";

const CLICK_THRESHOLD_PX = 4;
/** Points closer than this to the previous one are dropped (double clicks). */
const MIN_SEGMENT_M = 0.5;
const PREVIEW_COLOR = 0x0071e3; // --accent
const JOIN_COLOR = 0x34c759; // --ok

/** A point of the road being drawn and the road it joins (null = free ground) — Fase 18. */
interface Laid {
  point: RoadPoint;
  snap: RoadSnap | null;
}

export function initRoadTool(deps: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  terrain: Terrain;
  roads: RoadRegistry;
}): void {
  const { canvas, camera, scene, terrain, roads } = deps;
  const raycaster = new THREE.Raycaster();
  const heightAt = (x: number, z: number) => terrain.getHeight(x, z);
  let points: Laid[] = [];
  let cursor: Laid | null = null;
  /** Fase 17: the stretch being dragged (start fixed, end follows the pointer). */
  let drag: { start: Laid; end: Laid; moved: boolean } | null = null;
  let downX = 0;
  let downY = 0;

  // ---- Preview: click-mode polyline + the drag band and its end rings ----
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: PREVIEW_COLOR, depthTest: false }),
  );
  line.renderOrder = 2;
  const band = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: PREVIEW_COLOR,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  band.renderOrder = 2;
  const ringGeometry = new THREE.RingGeometry(0.8, 1.15, 32).rotateX(-Math.PI / 2);
  const rings = [0, 1].map(() => {
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    ring.renderOrder = 3;
    return ring;
  });
  for (const o of [line, band, ...rings]) {
    o.visible = false;
    o.raycast = () => {};
    scene.add(o);
  }

  // Labels as HTML over the canvas (length, angle, grade) — legible at any distance.
  const labels = ["length", "angle", "grade"].map((kind) => {
    const el = document.createElement("div");
    el.className = `road-label road-label--${kind}`;
    el.hidden = true;
    return el;
  });
  const host = canvas.parentElement;
  if (host) for (const el of labels) host.appendChild(el);

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

  /** Fase 18: joins the road there when it can, else free ground at the tool's Bridge height. */
  function place(p: { x: number; z: number }): Laid {
    const snap = roads.snap(p);
    return snap
      ? { point: { x: snap.x, z: snap.z, elevation: snap.elevation }, snap }
      : { point: { ...p, elevation: store.roadTool.elevation }, snap: null };
  }

  /** Height of the road line at a point (ground + its lift). */
  const lineY = (p: RoadPoint) => heightAt(p.x, p.z) + p.elevation;

  /** End ring `i` on `laid` (green when it joins a road); null hides it. */
  function showRing(i: number, laid: Laid | null): void {
    rings[i].visible = laid !== null;
    if (!laid) return;
    rings[i].position.set(laid.point.x, lineY(laid.point) + 0.25, laid.point.z);
    rings[i].scale.setScalar(store.roadTool.width / 2);
    (rings[i].material as THREE.MeshBasicMaterial).color.setHex(laid.snap ? JOIN_COLOR : 0xffffff);
  }

  function screen(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight };
  }

  function showLabel(i: number, text: string | null, at?: THREE.Vector3): void {
    const el = labels[i];
    el.hidden = text === null || !at;
    if (text === null || !at) return;
    el.textContent = text;
    const p = screen(at.x, at.y, at.z);
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -140%)`;
  }

  function hidePreview(): void {
    band.visible = false;
    for (const r of rings) r.visible = false;
    for (let i = 0; i < labels.length; i++) showLabel(i, null);
  }

  /** Drag preview: the band on the deck it will have, end rings, length · angle · grade. */
  function drawDrag(): void {
    if (!drag || !drag.moved) return hidePreview();
    const { start, end } = drag;
    const [a, b] = [start.point, end.point];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < MIN_SEGMENT_M) return hidePreview();
    const width = store.roadTool.width;
    band.geometry.dispose();
    band.geometry = bandGeometry(sampleRoad({ points: [a, b], width }, heightAt), width, 0.2);
    band.visible = true;
    showRing(0, start);
    showRing(1, end);

    const [ya, yb] = [lineY(a), lineY(b)];
    const mid = new THREE.Vector3((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2);
    showLabel(0, `↔ ${fmt(len, 0)} m`, mid);
    const joined = start.snap;
    if (joined) {
      const cos = (joined.dx * (b.x - a.x) + joined.dz * (b.z - a.z)) / len;
      const angle = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, cos))));
      // From an end: the angle between the two stretches; mid-road: with the road, either way.
      const shown = joined.isEnd ? angle : Math.min(angle, 180 - angle);
      showLabel(1, `∠ ${fmt(shown, 0)}°`, new THREE.Vector3(a.x, ya, a.z));
    } else showLabel(1, null);
    const grade = ((yb - ya) / len) * 100;
    showLabel(
      2,
      Math.abs(grade) < 0.5 ? "±0 %" : `${grade > 0 ? "+" : "−"}${fmt(Math.abs(grade), 1)} %`,
      new THREE.Vector3(b.x, yb, b.z),
    );
  }

  function drawLine(): void {
    const all = cursor ? [...points, cursor] : points;
    line.visible = store.tool === "road" && all.length >= 2;
    line.geometry.setFromPoints(
      all.map(({ point: p }) => new THREE.Vector3(p.x, lineY(p) + 0.3, p.z)),
    );
  }

  function reset(): void {
    points = [];
    cursor = null;
    drag = null;
    drawLine();
    hidePreview();
  }

  /** Click mode: the polyline becomes a road; the tool returns to select. */
  function finish(): void {
    if (points.length < 2) {
      showToast(t("toast.roadTooShort"), "info");
      return;
    }
    const road = roads.lay(
      points.map((l) => l.point),
      store.roadTool.width,
      points.map((l) => l.snap),
    );
    reset();
    store.setTool("select");
    store.select(road.id);
  }

  canvas.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
    if (e.button !== 0 || store.tool !== "road" || points.length > 0) return;
    if (layerBlockReason("infra")) return; // reported on pointerup
    const p = pickTerrain(e);
    if (!p) return;
    const start = place(p);
    drag = { start, end: start, moved: false };
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || store.tool !== "road") return;
    const dragged = Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX;
    const blocked = layerBlockReason("infra");
    if (blocked) {
      showToast(blocked, "info");
      return;
    }
    // Fase 17: a drag lays a stretch right away (Cities: Skylines style).
    if (drag && dragged) {
      const { start, end } = drag;
      drag = null;
      hidePreview();
      if (Math.hypot(end.point.x - start.point.x, end.point.z - start.point.z) >= MIN_SEGMENT_M)
        roads.lay([start.point, end.point], store.roadTool.width, [start.snap, end.snap]);
      return;
    }
    drag = null;
    hidePreview();
    if (dragged) return;
    const p = pickTerrain(e);
    if (!p) return;
    const q = place(p);
    const last = points.at(-1)?.point;
    if (!last || Math.hypot(q.point.x - last.x, q.point.z - last.z) >= MIN_SEGMENT_M)
      points.push(q);
    drawLine();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (store.tool !== "road") return;
    const p = pickTerrain(e);
    if (drag) {
      if (!p) return;
      drag.end = place(p);
      drag.moved ||= Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX;
      drawDrag();
      return;
    }
    // Fase 18: a green ring where the road would join another — before pressing, too.
    cursor = p ? place(p) : null;
    showRing(0, cursor?.snap ? cursor : null);
    if (points.length > 0) drawLine();
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
      drawLine();
    } else if (e.key === "Escape") {
      reset();
      store.setTool("select");
    }
  });

  // Leaving the tool (catalog, another tool) discards an unfinished road.
  store.subscribe(() => {
    if (store.tool !== "road" && (points.length > 0 || line.visible || drag || rings[0].visible))
      reset();
  });
}
