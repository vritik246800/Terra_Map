/**
 * Environment (Fase 11, DESIGN.md §1.7): sun + ambient light, sky gradient,
 * fog and the water plane, driven by `store.environment`.
 *
 * Day/night: `t = (hour − 6) / 12 · π`, daylight `d = clamp((sin t + 0.15) / 1.15)`
 * (the offset adds ~35 min of twilight around sunrise/sunset). By day
 * the sun follows the arc (east → west); at night a dim bluish "moon" light
 * keeps the maquete readable. Light color/intensity, ambient and sky colors
 * interpolate night → day by `d`; a warm horizon tint marks sunrise/sunset.
 * Changing the hour plays A18 (800ms); fog and water apply at once. The fog
 * color is the horizon color, so distant terrain melts into the sky.
 */
import * as THREE from "three";

import { a18HourTo } from "../anim/scene";
import { store } from "../state/store";
import type { Terrain } from "./terrain";

const SUN_DISTANCE = 160;
/** Scene colors (DESIGN.md §1.7). */
const C = {
  zenithDay: new THREE.Color("#6fa8dc"),
  zenithNight: new THREE.Color("#0b1530"),
  horizonDay: new THREE.Color("#dbe9f6"),
  horizonNight: new THREE.Color("#1b2a4a"),
  warm: new THREE.Color("#f4b183"),
  sunDay: new THREE.Color("#fff4e0"),
  moon: new THREE.Color("#8fa3d1"),
  water: new THREE.Color("#3d7ab8"),
};
/** FogExp2 density at `fog = 1` (≈ terrain-wide haze). */
const MAX_FOG_DENSITY = 0.012;

export interface EnvironmentHandles {
  sun: THREE.DirectionalLight;
  water: THREE.Mesh;
}

export function initEnvironment(deps: {
  scene: THREE.Scene;
  terrain: Terrain;
  shadowExtent: number;
}): EnvironmentHandles {
  const { scene, terrain, shadowExtent } = deps;

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  // Fase 9: no shadow acne (striped self-shadowing on large flat walls).
  sun.shadow.bias = -0.001;
  sun.shadow.normalBias = 0.1;
  scene.add(ambient, sun);

  // Sky: a tiny vertical gradient canvas as the background (redrawn per hour).
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 2;
  skyCanvas.height = 256;
  const sky = new THREE.CanvasTexture(skyCanvas);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  const fog = new THREE.FogExp2(C.horizonDay.getHex(), 0);
  scene.fog = fog;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: C.water,
      transparent: true,
      opacity: 0.72,
      roughness: 0.15,
      metalness: 0.1,
    }),
  );
  water.name = "water";
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  scene.add(water);

  const zenith = new THREE.Color();
  const horizon = new THREE.Color();

  /** Applies the light/sky of an hour (also called on every A18 frame). */
  function applyHour(hour: number): void {
    const t = ((hour - 6) / 12) * Math.PI;
    const d = THREE.MathUtils.clamp((Math.sin(t) + 0.15) / 1.15, 0, 1);
    if (Math.sin(t) > 0) {
      sun.position.set(Math.cos(t) * SUN_DISTANCE, Math.sin(t) * SUN_DISTANCE + 10, 60);
    } else {
      sun.position.set(-Math.cos(t) * SUN_DISTANCE, -Math.sin(t) * SUN_DISTANCE + 10, -60); // moon
    }
    sun.color.copy(C.moon).lerp(C.sunDay, d);
    sun.intensity = 0.35 + 1.25 * d;
    ambient.intensity = 0.35 + 0.25 * d;

    zenith.copy(C.zenithNight).lerp(C.zenithDay, d);
    horizon.copy(C.horizonNight).lerp(C.horizonDay, d);
    const warm = d > 0 && d < 0.35 ? (1 - Math.abs(d - 0.175) / 0.175) * 0.7 : 0;
    horizon.lerp(C.warm, warm);
    const ctx = skyCanvas.getContext("2d");
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, skyCanvas.height);
      g.addColorStop(0, `#${zenith.getHexString()}`);
      g.addColorStop(1, `#${horizon.getHexString()}`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
      sky.needsUpdate = true;
    }
    fog.color.copy(horizon);
  }

  /** Hour on screen (A18 tweens it) and the hour it is heading to. */
  const shown = { hour: store.environment.hour };
  let targetHour = shown.hour;
  applyHour(shown.hour);

  store.subscribe(() => {
    const env = store.environment;
    fog.density = env.fog * MAX_FOG_DENSITY;
    const size = terrain.current.size;
    water.scale.set(size, size, 1);
    water.position.y = env.water.level;
    water.visible = env.water.enabled && store.layer("terrain").visible;
    if (env.hour !== targetHour) {
      targetHour = env.hour;
      a18HourTo(shown, targetHour, () => applyHour(shown.hour));
    }
  });

  return { sun, water };
}
