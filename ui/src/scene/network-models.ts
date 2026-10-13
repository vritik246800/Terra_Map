/**
 * Procedural network & telecom models (PLAN.md Fase 6, DESIGN.md §4.1
 * `NetworkElement` and `Marker`).
 *
 * Same contract as `scene/buildings.ts`: each builder fills the `content`
 * group (child of the entity root, which owns the transform) and every mesh
 * casts/receives shadows. Network elements have no construction geometry per
 * phase — instead the phase drives material opacity (0 fundações = planned
 * ghost 35%, 1 estrutura = 70%, 2 acabamento = opaque), giving the "visual
 * distinto por fase" of DESIGN.md §6 without inventing geometry stages.
 *
 * Markers ignore the phase: a pin (cone + sphere head, accent color) with a
 * text label sprite above it.
 */
import * as THREE from "three";

import type { NetworkKind } from "../state/store";

/** Scene 3D palette for network elements (not UI tokens — like buildings). */
const COLORS = {
  metal: 0x9a9aa0, // masts, racks
  dark: 0x3a3a3c, // router/switch bodies
  light: 0xf3f1ec, // ONU and small boxes
  accent: 0x0071e3, // --accent: panels, LEDs, marker pin
  wood: 0x8a6f55, // poles
  warning: 0xff9500, // --warn: distribution box
} as const;

/** Phase → opacity of network element materials (DESIGN.md §6). */
const PHASE_OPACITY = [0.35, 0.7, 1] as const;

function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.15 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Antenna/tower: 6 m mast with three panels near the top. */
function buildAntenna(content: THREE.Group): void {
  content.add(cylinder(0.09, 0.14, 6, COLORS.metal, 0, 3, 0));
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const panel = box(0.35, 1.4, 0.12, COLORS.accent);
    panel.position.set(Math.cos(angle) * 0.45, 5.3, Math.sin(angle) * 0.45);
    panel.rotation.y = -angle;
    content.add(panel);
  }
  content.add(cylinder(0.02, 0.02, 0.8, COLORS.dark, 0, 6.4, 0)); // lightning rod
}

/** Router: small dark box with two stick antennas. */
function buildRouter(content: THREE.Group): void {
  content.add(box(0.5, 0.14, 0.35, COLORS.dark, 0, 0.07, 0));
  content.add(cylinder(0.015, 0.015, 0.3, COLORS.dark, -0.15, 0.28, -0.12));
  content.add(cylinder(0.015, 0.015, 0.3, COLORS.dark, 0.15, 0.28, -0.12));
}

/** Switch: flat wide box with an accent LED strip on the front. */
function buildSwitch(content: THREE.Group): void {
  content.add(box(0.6, 0.1, 0.4, COLORS.dark, 0, 0.05, 0));
  content.add(box(0.55, 0.02, 0.02, COLORS.accent, 0, 0.08, 0.2));
}

/** OLT (FTTH): rack box with an accent front panel. */
function buildOlt(content: THREE.Group): void {
  content.add(box(1.2, 1.0, 0.6, COLORS.dark, 0, 0.5, 0));
  content.add(box(1.1, 0.2, 0.03, COLORS.accent, 0, 0.8, 0.31));
}

/** ONU (FTTH): small light wall box. */
function buildOnu(content: THREE.Group): void {
  content.add(box(0.35, 0.25, 0.12, COLORS.light, 0, 0.125, 0));
  content.add(box(0.3, 0.03, 0.02, COLORS.accent, 0, 0.19, 0.07));
}

/** Optical splitter: small box with a row of output ports on top. */
function buildSplitter(content: THREE.Group): void {
  content.add(box(0.5, 0.3, 0.3, COLORS.metal, 0, 0.15, 0));
  for (let i = 0; i < 4; i++) {
    content.add(cylinder(0.03, 0.03, 0.1, COLORS.accent, -0.15 + i * 0.1, 0.35, 0));
  }
}

/** Pole: 7 m wooden pole with a crossarm near the top. */
function buildPole(content: THREE.Group): void {
  content.add(cylinder(0.1, 0.14, 7, COLORS.wood, 0, 3.5, 0));
  content.add(box(1.4, 0.1, 0.1, COLORS.wood, 0, 6.3, 0));
}

/** Distribution box (caixa de distribuição): warning box on a small post. */
function buildDistBox(content: THREE.Group): void {
  content.add(cylinder(0.06, 0.08, 1.1, COLORS.metal, 0, 0.55, 0));
  content.add(box(0.6, 0.5, 0.3, COLORS.warning, 0, 1.35, 0));
}

const BUILDERS: Record<NetworkKind, (content: THREE.Group) => void> = {
  antenna: buildAntenna,
  router: buildRouter,
  switch: buildSwitch,
  olt: buildOlt,
  onu: buildOnu,
  splitter: buildSplitter,
  pole: buildPole,
  box: buildDistBox,
};

/**
 * (Re)builds a network element for its phase. The phase only drives the
 * material opacity (planned → semi-transparent, finished → opaque).
 */
export function buildNetworkContent(
  content: THREE.Group,
  kind: NetworkKind,
  phase: number,
): void {
  BUILDERS[kind](content);

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

/** Text label sprite shown above a marker pin (CanvasTexture). */
function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
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
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 2.2;
  return sprite;
}

/**
 * Builds a marker pin (PLAN.md Fase 6, DESIGN.md §4.1 `Marker`): inverted
 * cone + sphere head in accent color, with the label sprite above.
 */
export function buildMarkerContent(content: THREE.Group, label: string): void {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.2, 20),
    new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.5 }),
  );
  cone.rotation.x = Math.PI; // point down
  cone.position.y = 0.6;
  cone.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 20, 16),
    new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.5 }),
  );
  head.position.y = 1.35;
  head.castShadow = true;
  content.add(cone, head, makeLabelSprite(label));
}
