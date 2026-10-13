/**
 * Minimal typed pub/sub store (PLAN.md Fases 2–4).
 *
 * Holds:
 *  - the currently selected `entityId` plus the data of scene entities
 *    (kind, construction phase, transform, collision flag — DESIGN.md §4.1
 *    `Building`/`Transform`);
 *  - the active tool (`select` | `brush` | `dragging` — DESIGN.md §12);
 *  - brush settings (radius/intensity) and the terrain state (active preset,
 *    custom generation params);
 *  - the name of the imported `.glb` available in the catalog (Fase 5);
 *  - network & telecom state (Fase 6): the cables edge list (`CableInfo`,
 *    the in-memory network graph — nodes are the entities), per-element
 *    dynamic props (DESIGN.md §4.2) and the cable tool settings.
 *
 * Two listener channels keep notifications focused: `subscribeSelection`
 * fires only on selection changes, `subscribe` fires on any state change
 * (panels, gizmo, selection ring). Commands/undo arrive in Fase 10
 * (DESIGN.md §11) — no mutation history here yet.
 */

/** Kinds of infrastructure placeable from the catalog (Fase 4). */
export type BuildingKind = "house" | "building" | "lot";

/** Kinds of network & telecom elements (PLAN.md Fase 6, DESIGN.md §4.1). */
export type NetworkKind =
  "antenna" | "router" | "switch" | "olt" | "onu" | "splitter" | "pole" | "box";

export const NETWORK_KINDS: ReadonlySet<string> = new Set<NetworkKind>([
  "antenna",
  "router",
  "switch",
  "olt",
  "onu",
  "splitter",
  "pole",
  "box",
]);

export function isNetworkKind(kind: string): kind is NetworkKind {
  return NETWORK_KINDS.has(kind);
}

/** Kind of the imported `.glb` catalog model (PLAN.md Fase 5). */
export const CUSTOM_GLB_KIND = "customGlb";

/** Kind of terrain/infra markers — pins with a label and a note (Fase 6). */
export const MARKER_KIND = "marker";

/** Every placeable entity kind (procedural, imported .glb, marker). */
export type EntityKind = BuildingKind | NetworkKind | typeof CUSTOM_GLB_KIND | typeof MARKER_KIND;

/** Value of a dynamic network property (DESIGN.md §4.2). */
export type DynamicValue = number | string | boolean;

/**
 * Default dynamic props seeded on spawn (DESIGN.md §4.2) — they make the
 * Fase 7 simulations meaningful out of the box and are editable in the panel.
 */
export const DEFAULT_NETWORK_PROPS: Record<NetworkKind, Record<string, DynamicValue>> = {
  antenna: { frequency: 3500, power: 43, gain: 18, range: 500 },
  router: { bandwidth: 1000, latency: 1 },
  switch: { bandwidth: 1000, latency: 0.5 },
  olt: { bandwidth: 10000, latency: 1 },
  onu: { bandwidth: 1000, power: 2 },
  splitter: { splitRatio: "1:32", attenuation: 17 },
  pole: {},
  box: {},
};

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

/** DESIGN.md §4.1 `Transform` — rotation in degrees (edited by spinners). */
export interface TransformData {
  position: Vec3Data;
  rotation: Vec3Data;
  scale: Vec3Data;
}

export interface EntityInfo {
  id: string;
  /** Stable kind key (e.g. "house", "building", "olt"); the UI maps it to a pt-PT label. */
  kind: string;
  /** Construction phase: 0 fundações, 1 estrutura, 2 acabamento (DESIGN.md §6). */
  phase: number;
  transform: TransformData;
  /** Numeric params of the procedural model (e.g. `floors` of a building). */
  params: Record<string, number>;
  /** Editable key-value network properties (DESIGN.md §4.2; Fase 6). */
  dynamicProps: Record<string, DynamicValue>;
  /** True while the footprint overlaps another infrastructure (warning, non-blocking). */
  colliding: boolean;
  /** Marker label/note (kind `marker`, Fase 6). */
  label?: string;
  note?: string;
  /** Entity a marker was placed on (kind `marker`; undefined = on the terrain). */
  targetId?: string;
}

/** Cable edge between two entities (PLAN.md Fase 6, DESIGN.md §4.1 `Cable`). */
export type CableType = "fiber" | "copper" | "coax";
export type CableRoute = "underground" | "aerial" | "direct";

export interface CableInfo {
  id: string;
  /** Endpoint entity ids (nodes of the network graph). */
  fromId: string;
  toId: string;
  cableType: CableType;
  route: CableRoute;
  /** Editable key-value properties (DESIGN.md §4.2). */
  dynamicProps: Record<string, DynamicValue>;
}

/**
 * Default dynamic props per cable type (DESIGN.md §4.2): attenuation in
 * dB/km, bandwidth in Mbps, costPerMeter in €.
 */
export const DEFAULT_CABLE_PROPS: Record<CableType, Record<string, DynamicValue>> = {
  fiber: { bandwidth: 10000, attenuation: 0.35, costPerMeter: 1.2 },
  copper: { bandwidth: 1000, attenuation: 24, costPerMeter: 0.8 },
  coax: { bandwidth: 1000, attenuation: 14, costPerMeter: 0.6 },
};

/** Transform of a freshly placed entity (identity). */
export function identityTransform(): TransformData {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/** Deep-enough copy: transform data is plain numbers. */
export function cloneTransform(t: TransformData): TransformData {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  };
}

/** Tools of the state machine in DESIGN.md §12 (dragging = catalog drag & drop). */
export type ToolId = "select" | "brush" | "cable" | "marker" | "dragging";

/** Terrain presets known to the app (DESIGN.md §4.1 `Terrain.preset`). */
export type TerrainPresetId = "flat" | "mountains" | "valley" | "custom";

/** User-facing parameters of the `custom` terrain preset (PLAN.md Fase 3). */
export interface CustomTerrainParams {
  seed: number;
  amplitude: number;
  frequency: number;
  size: number;
}

export const DEFAULT_CUSTOM_PARAMS: CustomTerrainParams = {
  seed: 42,
  amplitude: 10,
  frequency: 1,
  size: 200,
};

type Listener = () => void;

let selectedId: string | null = null;
let activeTool: ToolId = "select";
let terrainPreset: TerrainPresetId = "flat";
let customGlbName: string | null = null;
const customParams: CustomTerrainParams = { ...DEFAULT_CUSTOM_PARAMS };
const brush = { radius: 6, intensity: 0.5 };
const cableTool: { cableType: CableType; route: CableRoute } = {
  cableType: "fiber",
  route: "underground",
};

/** Bumped on every notification — the React snapshot (`state/use-store.ts`). */
let version = 0;

const listeners = new Set<Listener>();
const selectionListeners = new Set<Listener>();
const entities = new Map<string, EntityInfo>();
const cables = new Map<string, CableInfo>();

function notify(): void {
  version++;
  listeners.forEach((l) => l());
}

export const store = {
  /** Selects an entity (`null` clears) and notifies subscribers. */
  select(id: string | null): void {
    if (id === selectedId) return; // avoid redundant notifications/renders
    selectedId = id;
    selectionListeners.forEach((l) => l());
    notify();
  },

  get selected(): string | null {
    return selectedId;
  },

  /** Registers the data of an entity present in the scene (Fase 4). */
  registerEntity(info: EntityInfo): void {
    entities.set(info.id, info);
    notify();
  },

  /** Removes an entity from the registry (deletion — scene cleanup is the registry's job). */
  unregisterEntity(id: string): void {
    if (!entities.delete(id)) return;
    notify();
  },

  getEntityInfo(id: string): EntityInfo | undefined {
    return entities.get(id);
  },

  /** Applies a partial update to an entity (phase, transform, params) and notifies. */
  updateEntity(
    id: string,
    patch: Partial<
      Pick<EntityInfo, "phase" | "transform" | "params" | "dynamicProps" | "label" | "note">
    >,
  ): void {
    const info = entities.get(id);
    if (!info) return;
    Object.assign(info, patch);
    notify();
  },

  // ---- Cables (Fase 6: edges of the in-memory network graph) ----

  /** Registers a cable (scene mesh is the CableRegistry's job) and notifies. */
  registerCable(info: CableInfo): void {
    cables.set(info.id, info);
    notify();
  },

  /** Removes a cable from the graph. */
  unregisterCable(id: string): void {
    if (!cables.delete(id)) return;
    if (selectedId === id) {
      selectedId = null;
      selectionListeners.forEach((l) => l());
    }
    notify();
  },

  getCableInfo(id: string): CableInfo | undefined {
    return cables.get(id);
  },

  /** Cables connected to an entity (either endpoint). */
  cablesOf(entityId: string): CableInfo[] {
    return [...cables.values()].filter((c) => c.fromId === entityId || c.toId === entityId);
  },

  /** All cables — the edge list of the network graph (Fase 7 feeds it to Rust). */
  allCables(): CableInfo[] {
    return [...cables.values()];
  },

  /**
   * Serializable snapshot of the network graph (Fases 7/8 feed it to the
   * Rust simulations): entities are the nodes, cables the edges. Returns
   * copies of the current maps so callers can freely serialize/mutate them.
   */
  networkGraph(): { nodes: EntityInfo[]; edges: CableInfo[] } {
    return { nodes: [...entities.values()], edges: [...cables.values()] };
  },

  /** Applies a partial update to a cable (type, route, dynamicProps) and notifies. */
  updateCable(
    id: string,
    patch: Partial<Pick<CableInfo, "cableType" | "route" | "dynamicProps">>,
  ): void {
    const info = cables.get(id);
    if (!info) return;
    Object.assign(info, patch);
    notify();
  },

  /**
   * Sets the collision flag without notifying — collision checks run in
   * batches during moves; the caller triggers `notifyChange()` once at the
   * end if any flag actually changed (avoids a notification storm per frame).
   * Returns true when the flag changed.
   */
  setEntityColliding(id: string, colliding: boolean): boolean {
    const info = entities.get(id);
    if (!info || info.colliding === colliding) return false;
    info.colliding = colliding;
    return true;
  },

  /** Triggers a general notification (e.g. after a batch of silent mutations). */
  notifyChange(): void {
    notify();
  },

  // ---- Tools (DESIGN.md §12) ----

  /** Activates a tool; only one tool is active at a time. */
  setTool(tool: ToolId): void {
    if (tool === activeTool) return;
    activeTool = tool;
    notify();
  },

  get tool(): ToolId {
    return activeTool;
  },

  // ---- Cable tool settings (Fase 6: type + route chosen in the panel) ----

  get cableTool(): Readonly<{ cableType: CableType; route: CableRoute }> {
    return cableTool;
  },

  setCableType(cableType: CableType): void {
    if (cableType === cableTool.cableType) return;
    cableTool.cableType = cableType;
    notify();
  },

  setCableRoute(route: CableRoute): void {
    if (route === cableTool.route) return;
    cableTool.route = route;
    notify();
  },

  // ---- Brush settings (DESIGN.md §6: radius step 1, intensity step 0.1) ----

  get brush(): Readonly<{ radius: number; intensity: number }> {
    return brush;
  },

  setBrushRadius(radius: number): void {
    brush.radius = radius;
    notify();
  },

  setBrushIntensity(intensity: number): void {
    brush.intensity = intensity;
    notify();
  },

  // ---- Terrain state ----

  get terrainPreset(): TerrainPresetId {
    return terrainPreset;
  },

  setTerrainPreset(preset: TerrainPresetId): void {
    terrainPreset = preset;
    notify();
  },

  // ---- Custom .glb model (PLAN.md Fase 5) ----

  /** Name of the imported `.glb` available in the catalog; `null` before the first import. */
  get customGlbName(): string | null {
    return customGlbName;
  },

  setCustomGlbName(name: string): void {
    if (name === customGlbName) return;
    customGlbName = name;
    notify();
  },

  get customParams(): Readonly<CustomTerrainParams> {
    return customParams;
  },

  setCustomParams(patch: Partial<CustomTerrainParams>): void {
    Object.assign(customParams, patch);
    notify();
  },

  // ---- Subscriptions ----

  /** Changes on every notification; state objects are mutated in place. */
  get version(): number {
    return version;
  },

  /** Subscribes to any state change; returns an unsubscribe function. */
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },

  /** Subscribes to selection changes only; returns an unsubscribe function. */
  subscribeSelection(l: Listener): () => void {
    selectionListeners.add(l);
    return () => {
      selectionListeners.delete(l);
    };
  },
};
