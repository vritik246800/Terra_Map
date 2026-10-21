/**
 * Viewport 3D (PLAN.md Fases 2–3, DESIGN.md §5 and §14).
 *
 * The WebGL canvas mounts inside `.viewport-canvas` (returned as `canvasHost`);
 * the React `Viewport` component owns the surrounding `<main>` and the
 * minimap overlay and attaches `canvasHost` on mount.
 *
 * This module owns the Three.js scene: renderer (antialias, PCF soft shadows,
 * pixelRatio ≤ 2), perspective camera starting at the isometric view,
 * OrbitControls with damping and limits (never below the terrain), lights
 * with shadows, grid + axes (toggled together with `G`), the terrain
 * (Fase 3 — replaces both the test meshes and the shadow-only ground plane),
 * the entity registry (Fase 4 — owns every placed infrastructure, feeds the
 * selection pickables and the camera focus), the cable registry (Fase 6 —
 * owns the network edges, merged into the selection pickables), the simulator
 * overlay (Fase 7 — A12 path highlight + A14 coverage heatmap), the transform
 * gizmo (Fase 4 —
 * `TransformControls` on the selected entity, with continuous Y snap), the
 * render loop (controls.update for the damping) and the ResizeObserver
 * that keeps aspect and size in sync.
 *
 * Grid placement, `position: relative` and `overflow` for `.viewport` come
 * from the global stylesheet (style.css).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { CableRegistry } from "./cables";
import { initialCameraPosition, initCameraShortcuts } from "./camera";
import { EntityRegistry } from "./entities";
import { createMinimap, type Minimap } from "./minimap";
import { initEnvironment, type EnvironmentHandles } from "./environment";
import { initGizmo } from "./gizmo";
import { initLayers } from "./layers";
import { RoadRegistry } from "./roads";
import { VegetationLayer } from "./vegetation";
import { initSelection } from "./selection";
import { SimOverlay } from "./sim-overlay";
import { initEntityShortcuts, shouldIgnoreShortcut } from "./shortcuts";
import { Terrain } from "./terrain";
import { store } from "../state/store";
import { initBrush } from "../tools/brush";
import { initCableTool } from "../tools/cable-tool";
import { initEntityDragDrop } from "../tools/drag-drop";
import { initMarkerTool } from "../tools/marker-tool";
import { initRoadTool } from "../tools/road-tool";
import { initRulerTool } from "../tools/ruler";
import "./viewport.css";

/** Grid extent in meters; divisions are 1 m (DESIGN.md §5 — modeling scale). */
const GRID_SIZE = 200;
/** The minimap redraws every N frames (~6 per second at 60 fps). */
const MINIMAP_EVERY = 10;

/** Grid (1 m divisions) + axes at the origin, visible by default. */
function addHelpers(scene: THREE.Scene): { grid: THREE.GridHelper; axes: THREE.AxesHelper } {
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x9a9aa0, 0xd4d4d8);
  const axes = new THREE.AxesHelper(5);
  scene.add(grid, axes);
  return { grid, axes };
}

export interface ViewportHandles {
  /** `.viewport-canvas` host; attached to the DOM by `components/Viewport.tsx`. */
  canvasHost: HTMLElement;
  terrain: Terrain;
  registry: EntityRegistry;
  cables: CableRegistry;
  /** Fase 7: simulator path highlight + coverage heatmap. */
  overlay: SimOverlay;
  /** Fase 9: top-down minimap (mounted by `components/Viewport.tsx`). */
  minimap: Minimap;
  /** Fase 11: sun + water plane, roads, vegetation. */
  environment: EnvironmentHandles;
  roads: RoadRegistry;
  vegetation: VegetationLayer;
  /** Fase 11: presentation mode (A22). */
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Fase 12: JPEG of the current view for the report (no grid, axes or gizmo). */
  snapshot(): Uint8Array | null;
}

/** Report image width cap (px) — enough for an A4 page. */
const SNAPSHOT_MAX_WIDTH = 1280;

export function createViewport(): ViewportHandles {
  const canvasHost = document.createElement("div");
  canvasHost.className = "viewport-canvas";

  // ---- Renderer / scene / camera ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in three r186 (it fell back with a warning).
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  camera.position.copy(initialCameraPosition());

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 5;
  controls.maxDistance = 800;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never below the terrain

  // ---- Scene contents ----
  const { grid, axes } = addHelpers(scene);

  // Fase 3: the terrain replaces the Fase 2 test meshes and the shadow-only
  // ground plane — it casts and receives shadows itself.
  const terrain = new Terrain();
  scene.add(terrain.mesh);
  // Fase 11: sun/moon, ambient, sky gradient, fog and water (DESIGN.md §1.7).
  const environment = initEnvironment({ scene, terrain, shadowExtent: GRID_SIZE / 2 + 20 });

  // ---- Interaction modules ----
  // Fase 4: the entity registry owns every placed infrastructure; its live
  // `pickables` array feeds the raycast selection (the terrain itself stays
  // non-selectable, Fase 3 decision) and `getObject` feeds the `F` focus.
  const registry = new EntityRegistry(scene, terrain);
  // Fase 6: the cable registry owns the network edges; its hooks keep cable
  // paths in sync with entity moves and cascade-remove cables on deletion.
  const cables = new CableRegistry(scene, terrain, registry);
  registry.onEntityChanged = (id) => cables.rebuildFor(id);
  registry.onEntityRemoved = (id) => cables.removeCablesOf(id);
  const overlay = new SimOverlay(scene, cables, terrain);
  // Fase 11: roads (Infraestruturas layer) and instanced vegetation (Terreno layer).
  const roads = new RoadRegistry(scene, terrain);
  const vegetation = new VegetationLayer(scene, terrain);
  // Fase 10: layer visibility (A17 when a layer comes back).
  initLayers({ registry, cables, terrain, roads, vegetation });
  // Fase 4: the gizmo attaches to the selected entity; `isBusy` lets the
  // selection skip plain clicks that land on a gizmo handle.
  const gizmo = initGizmo({ canvas: renderer.domElement, camera, scene, controls, registry });
  initSelection({
    canvas: renderer.domElement,
    camera,
    scene,
    pickables: registry.pickables,
    extraPickables: [cables.pickables, roads.pickables],
    isGizmoBusy: gizmo.isBusy,
    controls,
  });
  initCameraShortcuts({
    camera,
    controls,
    getObject: (id) => registry.getObject(id) ?? cables.getObject(id) ?? roads.getObject(id),
    host: canvasHost, // Fase 13: keyboard navigation (crosshair, arrows, Space)
    canvas: renderer.domElement,
  });
  initEntityShortcuts({ registry, cables, roads });
  initBrush({
    canvas: renderer.domElement,
    camera,
    scene,
    controls,
    terrain,
    vegetation,
    onStrokeEnd: (tool) => {
      if (tool === "brush") cables.rebuildAll(); // the relief changed
      store.markTerrainChanged(); // unsaved change + undo snapshot (Fases 8, 10)
    },
  });
  initRoadTool({ canvas: renderer.domElement, camera, scene, terrain, roads });
  initRulerTool({ canvas: renderer.domElement, camera, scene, terrain }); // Fase 12
  initEntityDragDrop({ canvas: renderer.domElement, camera, scene, terrain, registry });
  initCableTool({
    canvas: renderer.domElement,
    camera,
    pickables: registry.pickables,
    registry,
    cables,
  });
  initMarkerTool({
    canvas: renderer.domElement,
    camera,
    terrain,
    registry,
    pickables: registry.pickables,
  });

  // `G`: toggle grid + axes together (DESIGN.md §10).
  window.addEventListener("keydown", (e) => {
    if ((e.key === "g" || e.key === "G") && !shouldIgnoreShortcut(e)) {
      grid.visible = axes.visible = !grid.visible;
    }
  });

  // Fase 9: minimap (UX.md §5).
  const minimap = createMinimap({ scene, terrain, camera, controls, helpers: [grid, axes] });

  // ---- Render loop: damping + main view; minimap every few frames ----
  let frame = 0;
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    if (frame++ % MINIMAP_EVERY === 0) minimap.render();
  });

  // ---- Resize: keep aspect and renderer size in sync with the host ----
  const resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(canvasHost);

  /**
   * Renders once without the editing helpers and reads the canvas in the same
   * task (the WebGL buffer is still intact), scaled down to an A4-friendly JPEG.
   */
  function snapshot(): Uint8Array | null {
    const helpers = [grid, axes, gizmo.helper];
    const shown = helpers.map((h) => h.visible);
    for (const h of helpers) h.visible = false;
    renderer.render(scene, camera);
    helpers.forEach((h, i) => (h.visible = shown[i]));
    const src = renderer.domElement;
    if (src.width === 0 || src.height === 0) return null;
    const scale = Math.min(1, SNAPSHOT_MAX_WIDTH / src.width);
    const out = document.createElement("canvas");
    out.width = Math.round(src.width * scale);
    out.height = Math.round(src.height * scale);
    out.getContext("2d")?.drawImage(src, 0, 0, out.width, out.height);
    const base64 = out.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  return {
    snapshot,
    canvasHost,
    terrain,
    registry,
    cables,
    overlay,
    minimap,
    environment,
    roads,
    vegetation,
    camera,
    controls,
  };
}
