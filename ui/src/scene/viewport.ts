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
 * owns the network edges, merged into the selection pickables), the transform
 * gizmo (Fase 4 —
 * `TransformControls` on the selected entity, with continuous Y snap), the
 * render loop (THREE.Clock delta + controls.update) and the ResizeObserver
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
import { initGizmo } from "./gizmo";
import { initSelection } from "./selection";
import { initEntityShortcuts, shouldIgnoreShortcut } from "./shortcuts";
import { Terrain } from "./terrain";
import { initBrush } from "../tools/brush";
import { initCableTool } from "../tools/cable-tool";
import { initEntityDragDrop } from "../tools/drag-drop";
import { initMarkerTool } from "../tools/marker-tool";
import "./viewport.css";

/** Grid extent in meters; divisions are 1 m (DESIGN.md §5 — modeling scale). */
const GRID_SIZE = 200;

/** Sets up scene lights: ambient fill + directional sun with shadows. */
function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(90, 140, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Shadow frustum covers the whole grid area.
  const extent = GRID_SIZE / 2 + 20;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  scene.add(sun);
}

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
}

export function createViewport(): ViewportHandles {
  const canvasHost = document.createElement("div");
  canvasHost.className = "viewport-canvas";

  // ---- Renderer / scene / camera ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f7); // neutral light bg (== --bg); sky/fog in Fase 11

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  camera.position.copy(initialCameraPosition());

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 5;
  controls.maxDistance = 800;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never below the terrain

  // ---- Scene contents ----
  addLights(scene);
  const { grid, axes } = addHelpers(scene);

  // Fase 3: the terrain replaces the Fase 2 test meshes and the shadow-only
  // ground plane — it casts and receives shadows itself.
  const terrain = new Terrain();
  scene.add(terrain.mesh);

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
  // Fase 4: the gizmo attaches to the selected entity; `isBusy` lets the
  // selection skip plain clicks that land on a gizmo handle.
  const gizmo = initGizmo({ canvas: renderer.domElement, camera, scene, controls, registry });
  initSelection({
    canvas: renderer.domElement,
    camera,
    scene,
    pickables: registry.pickables,
    extraPickables: cables.pickables,
    isGizmoBusy: gizmo.isBusy,
  });
  initCameraShortcuts({
    camera,
    controls,
    getObject: (id) => registry.getObject(id) ?? cables.getObject(id),
  });
  initEntityShortcuts({ registry, cables });
  initBrush({
    canvas: renderer.domElement,
    camera,
    scene,
    controls,
    terrain,
    onStrokeEnd: () => cables.rebuildAll(),
  });
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

  // ---- Render loop: clock delta ready for 3D animations + damping ----
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    clock.getDelta();
    controls.update();
    renderer.render(scene, camera);
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

  return { canvasHost, terrain, registry, cables };
}
