/**
 * Network & telecom models (PLAN.md Fase 6, DESIGN.md §4.1 `NetworkElement`
 * and `Marker`).
 *
 * Fase 16: the meshes are the Blender `.glb` models (`scene/models.ts`),
 * deep-cloned into the `content` group (child of the entity root, which owns
 * the transform). Network elements have no construction geometry per
 * phase — the phase drives material opacity (0 foundations = planned
 * ghost 35%, 1 structure = 70%, 2 finishing = opaque), giving the "visual
 * distinto por fase" of DESIGN.md §6.
 *
 * Markers ignore the phase: the pin model with a text label sprite above it.
 */
import * as THREE from "three";

import type { NetworkKind } from "../state/store";
import { cloneModel } from "./models";

/** Phase → opacity of network element materials (DESIGN.md §6). */
const PHASE_OPACITY = [0.35, 0.7, 1] as const;

/**
 * (Re)builds a network element for its phase. The phase only drives the
 * material opacity (planned → semi-transparent, finished → opaque).
 */
export function buildNetworkContent(content: THREE.Group, kind: NetworkKind, phase: number): void {
  content.add(cloneModel(kind));

  const clamped = Math.max(0, Math.min(2, phase));
  const opacity = PHASE_OPACITY[clamped];
  if (opacity === 1) return;
  content.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const material = obj.material;
      for (const m of Array.isArray(material) ? material : [material]) {
        m.transparent = true;
        m.opacity = opacity;
      }
    }
  });
}

/** Draws the pill + text of a label sprite (marker pins, ruler — Fase 12). */
function drawLabel(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Glass-like pill background, dark text (tokens of DESIGN.md §7).
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.beginPath();
  ctx.roundRect(2, 6, 252, 52, 26);
  ctx.fill();
  ctx.fillStyle = "#1d1d1f";
  ctx.font = "600 26px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 24), 128, 33);
}

/** Text label sprite (CanvasTexture), 2.2 m above its parent. */
export function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  drawLabel(canvas, text);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 2.2;
  return sprite;
}

/** Rewrites the text of a sprite made by `makeLabelSprite` (ruler A19 counts up). */
export function setLabelText(sprite: THREE.Sprite, text: string): void {
  const texture = sprite.material.map;
  if (!(texture instanceof THREE.CanvasTexture)) return;
  drawLabel(texture.image as HTMLCanvasElement, text);
  texture.needsUpdate = true;
}

/** Builds a marker pin (PLAN.md Fase 6, DESIGN.md §4.1 `Marker`) with its label sprite. */
export function buildMarkerContent(content: THREE.Group, label: string): void {
  content.add(cloneModel("marker"), makeLabelSprite(label));
}
