/**
 * Terrain (PLAN.md Fase 3, DESIGN.md §4.1 `Terrain`).
 *
 * A subdivided `PlaneGeometry` fed by a heightmap of `resolution²` heights
 * (meters, row-major). The Rust core generates the heightmap for the
 * built-in/custom presets (`generate_terrain`); brush strokes and loaded
 * presets edit/replace it here.
 *
 * Coordinates: vertex `i = gz * res + gx` sits at world
 * `x = -size/2 + gx * step`, `z = -size/2 + gz * step` (the plane is rotated
 * -90° around X, so the local Z of the plane is world Y = height).
 *
 * The material is an altitude gradient (grass → dirt → rock → snow,
 * colors in DESIGN.md §7.5) done with per-vertex colors, refreshed on the
 * affected vertices after each stroke.
 *
 * `getHeight(x, z)` (bilinear interpolation) is the snap source used by
 * later phases (drag & drop, cables).
 *
 * Fase 11: a material map (one byte per vertex) overrides the gradient where
 * the material brush painted (DESIGN.md §1.7); 0 = automatic. A new terrain
 * (preset, loaded preset, heightmap image) starts with an empty map.
 */
import * as THREE from "three";

import { generateTerrain, type TerrainPresetFile } from "../net/bridge";
import type { TerrainPresetId } from "../state/store";

/** Everything needed to (re)build a terrain from scratch. */
export interface TerrainConfig {
  preset: TerrainPresetId;
  size: number;
  resolution: number;
  seed: number;
  amplitude: number;
  frequency: number;
}

/** Default terrain on app start: flat (DESIGN.md §8.2). */
export const DEFAULT_TERRAIN: TerrainConfig = {
  preset: "flat",
  size: 200,
  resolution: 128,
  seed: 42,
  amplitude: 10,
  frequency: 1,
};

/** Altitude gradient stops (DESIGN.md §7.5): height in meters → color. */
const ALTITUDE_STOPS: Array<[number, THREE.Color]> = [
  [2, new THREE.Color("#7da05c")], // grass
  [6, new THREE.Color("#8a6f4d")], // dirt
  [14, new THREE.Color("#8d8d93")], // rock
  [26, new THREE.Color("#f4f6f8")], // snow
];

const SCRATCH_COLOR = new THREE.Color();

/** Material brush colors (DESIGN.md §1.7); index 0 = altitude gradient. */
const MATERIAL_COLORS: ReadonlyArray<THREE.Color | null> = [
  null,
  new THREE.Color("#7da05c"), // relva
  new THREE.Color("#8a6f4d"), // terra
  new THREE.Color("#d8c690"), // areia
  new THREE.Color("#8d8d93"), // rocha
  new THREE.Color("#f4f6f8"), // neve
];

/** Interpolated gradient color for a height (meters). */
function altitudeColor(height: number, target: THREE.Color): THREE.Color {
  if (height <= ALTITUDE_STOPS[0][0]) return target.copy(ALTITUDE_STOPS[0][1]);
  for (let i = 1; i < ALTITUDE_STOPS.length; i++) {
    const [h1, c1] = ALTITUDE_STOPS[i];
    if (height <= h1) {
      const [h0, c0] = ALTITUDE_STOPS[i - 1];
      return target.copy(c0).lerp(c1, (height - h0) / (h1 - h0));
    }
  }
  return target.copy(ALTITUDE_STOPS[ALTITUDE_STOPS.length - 1][1]);
}

/** Encodes bytes as `base64:` text (heightmaps, Fase 8 embedded `.glb`). */
export function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // String.fromCharCode argument limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `base64:${btoa(binary)}`;
}

/** Decodes `base64:` text; `null` if malformed. */
export function decodeBytes(encoded: string): Uint8Array | null {
  if (!encoded.startsWith("base64:")) return null;
  try {
    const binary = atob(encoded.slice("base64:".length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Encodes a heightmap as `base64:` + float32 LE bytes (DESIGN.md §18). */
export function encodeHeightmap(heightmap: Float32Array): string {
  return encodeBytes(new Uint8Array(heightmap.buffer, heightmap.byteOffset, heightmap.byteLength));
}

/** Decodes a `base64:` heightmap; `null` if malformed or wrong length. */
export function decodeHeightmap(encoded: string, expectedLength: number): Float32Array | null {
  const bytes = decodeBytes(encoded);
  if (!bytes || bytes.length !== expectedLength * 4) return null;
  return new Float32Array(bytes.buffer);
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  private heightmap: Float32Array;
  private materials: Uint8Array;
  private config: TerrainConfig;
  /** Guards against out-of-order async regenerations (last call wins). */
  private generation = 0;

  constructor() {
    this.config = { ...DEFAULT_TERRAIN };
    this.heightmap = new Float32Array(this.config.resolution ** 2);
    this.materials = new Uint8Array(this.config.resolution ** 2);

    const geometry = this.buildGeometry(this.config);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "terrain";
    this.mesh.rotation.x = -Math.PI / 2; // local +Z becomes world +Y (height)
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.refreshAll();
  }

  get current(): Readonly<TerrainConfig> {
    return this.config;
  }

  /** Snapshot of the raw heights (for preset save — treat as read-only). */
  get heights(): Float32Array {
    return this.heightmap;
  }

  /** Builds the subdivided plane for a config (positions X/Y only; Z = 0). */
  private buildGeometry(config: TerrainConfig): THREE.BufferGeometry {
    return new THREE.PlaneGeometry(
      config.size,
      config.size,
      config.resolution - 1,
      config.resolution - 1,
    );
  }

  /**
   * Regenerates the terrain from scratch (reset) with a new preset via the
   * Rust core. Async; if several calls race, the last one wins.
   */
  async regenerate(config: TerrainConfig): Promise<void> {
    const generation = ++this.generation;
    const heights = await generateTerrain(
      config.preset,
      config.size,
      config.resolution,
      config.seed,
      config.amplitude,
      config.frequency,
    );
    if (generation !== this.generation) return; // superseded by a newer call

    if (heights.length !== config.resolution ** 2) {
      throw new Error(
        `generate_terrain devolveu ${heights.length} alturas, esperava ${config.resolution ** 2}`,
      );
    }
    this.config = { ...config };
    this.replaceHeightmap(new Float32Array(heights));
  }

  /**
   * Applies a preset file loaded from disk (PLAN.md Fase 3). Uses the stored
   * heightmap when present and consistent; otherwise regenerates from the
   * stored params so the preset still loads.
   */
  async applyPresetFile(file: TerrainPresetFile): Promise<void> {
    const config: TerrainConfig = {
      preset: (["flat", "mountains", "valley", "custom"].includes(file.preset)
        ? file.preset
        : "custom") as TerrainPresetId,
      size: file.params.size,
      resolution: file.params.resolution,
      seed: file.params.seed,
      amplitude: file.params.amplitude,
      frequency: file.params.frequency,
    };

    const decoded = file.heightmap ? decodeHeightmap(file.heightmap, config.resolution ** 2) : null;
    if (decoded) {
      this.generation++; // cancel any in-flight regeneration
      this.config = config;
      this.replaceHeightmap(decoded);
      return;
    }
    await this.regenerate(config);
  }

  /**
   * Applies a heightmap decoded from a grayscale image (PLAN.md Fase 3 —
   * PNG import). Heights must match the current grid (resolution²); the
   * terrain becomes `preset: "custom"` with the amplitude used to scale
   * the image luminance.
   */
  applyHeightmapImage(heights: Float32Array, amplitude: number): void {
    if (heights.length !== this.config.resolution ** 2) {
      throw new Error(
        `heightmap da imagem com ${heights.length} alturas, esperava ${this.config.resolution ** 2}`,
      );
    }
    this.generation++; // cancel any in-flight regeneration
    this.config = { ...this.config, preset: "custom", amplitude };
    this.replaceHeightmap(heights);
  }

  /** Undo/redo (Fases 10–11): puts back a previous config, heightmap and materials (copied). */
  restoreState(config: TerrainConfig, heights: Float32Array, materials: Uint8Array): void {
    this.generation++; // cancel any in-flight regeneration
    this.config = { ...config };
    this.replaceHeightmap(heights.slice(), materials.slice());
  }

  /** Material byte per vertex (Fase 11 — treat as read-only). */
  get materialMap(): Uint8Array {
    return this.materials;
  }

  /** Applies a saved material map (project open); ignored when the size does not match. */
  setMaterialMap(map: Uint8Array): void {
    if (map.length !== this.materials.length) return;
    this.materials = map.map((m) => (m < MATERIAL_COLORS.length ? m : 0)); // unknown → automatic
    this.refreshAll();
  }

  /** Material brush dab (Fase 11): sets `material` on every vertex within `radius`. */
  paint(cx: number, cz: number, radius: number, material: number): void {
    const { size, resolution: res } = this.config;
    const step = size / (res - 1);
    const cgx = (cx + size / 2) / step;
    const cgz = (cz + size / 2) / step;
    const rCells = radius / step;
    const gx0 = Math.max(0, Math.ceil(cgx - rCells));
    const gx1 = Math.min(res - 1, Math.floor(cgx + rCells));
    const gz0 = Math.max(0, Math.ceil(cgz - rCells));
    const gz1 = Math.min(res - 1, Math.floor(cgz + rCells));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if ((gx - cgx) ** 2 + (gz - cgz) ** 2 <= rCells * rCells) {
          this.materials[gz * res + gx] = material;
        }
      }
    }
    this.refreshRange(gx0, gz0, gx1, gz1);
  }

  /** Swaps the heightmap (new terrain → empty material map unless given), rebuilding the geometry if the grid changed. */
  private replaceHeightmap(heightmap: Float32Array, materials?: Uint8Array): void {
    const { size, resolution } = this.config;
    const geometry = this.mesh.geometry;
    const sameGrid =
      geometry.attributes.position.count === resolution ** 2 &&
      (geometry as THREE.PlaneGeometry).parameters.width === size;
    if (!sameGrid) {
      geometry.dispose();
      this.mesh.geometry = this.buildGeometry(this.config);
    }
    this.heightmap = heightmap;
    this.materials = materials ?? new Uint8Array(resolution ** 2);
    this.refreshAll();
  }

  /**
   * Terrain height at world (x, z) via bilinear interpolation over the
   * heightmap (PLAN.md Fase 3: snap source for objects and cables).
   * Positions outside the terrain are clamped to the border.
   */
  getHeight(x: number, z: number): number {
    const { size, resolution: res } = this.config;
    const step = size / (res - 1);
    const gx = THREE.MathUtils.clamp((x + size / 2) / step, 0, res - 1);
    const gz = THREE.MathUtils.clamp((z + size / 2) / step, 0, res - 1);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, res - 1);
    const z1 = Math.min(z0 + 1, res - 1);
    const tx = gx - x0;
    const tz = gz - z0;
    const h00 = this.heightmap[z0 * res + x0];
    const h10 = this.heightmap[z0 * res + x1];
    const h01 = this.heightmap[z1 * res + x0];
    const h11 = this.heightmap[z1 * res + x1];
    const top = THREE.MathUtils.lerp(h00, h10, tx);
    const bottom = THREE.MathUtils.lerp(h01, h11, tx);
    return THREE.MathUtils.lerp(top, bottom, tz);
  }

  /**
   * One brush dab with gaussian falloff (PLAN.md Fase 3): raises (`dir = 1`)
   * or lowers (`dir = -1`) the heightmap around world (`cx`, `cz`).
   *
   * A drag gesture is a sequence of dabs; the gesture boundary lives in
   * `tools/brush.ts` so a stroke can become a single undo command in Fase 10
   * (`TerrainStroke`, DESIGN.md §11).
   */
  applyStroke(cx: number, cz: number, radius: number, strength: number, dir: 1 | -1): void {
    const { size, resolution: res } = this.config;
    const step = size / (res - 1);
    const cgx = (cx + size / 2) / step;
    const cgz = (cz + size / 2) / step;
    const rCells = radius / step;
    if (rCells <= 0) return;

    const gx0 = Math.max(0, Math.ceil(cgx - rCells));
    const gx1 = Math.min(res - 1, Math.floor(cgx + rCells));
    const gz0 = Math.max(0, Math.ceil(cgz - rCells));
    const gz1 = Math.min(res - 1, Math.floor(cgz + rCells));

    const r2 = rCells * rCells;
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const d2 = (gx - cgx) ** 2 + (gz - cgz) ** 2;
        if (d2 > r2) continue;
        const fall = Math.exp(-d2 / (r2 * 0.5)); // smooth at the edges
        this.heightmap[gz * res + gx] += dir * strength * fall;
      }
    }
    this.refreshRange(gx0, gz0, gx1, gz1);
  }

  /** Rewrites heights + colors for the whole grid. */
  private refreshAll(): void {
    this.refreshRange(0, 0, this.config.resolution - 1, this.config.resolution - 1);
  }

  /**
   * Writes the affected vertices (position Z = height, altitude color) and
   * recomputes normals. Only the vertex writes are range-limited —
   * `computeVertexNormals` always walks the full grid, which stays cheap at
   * the planned resolutions (≤ 512²).
   */
  private refreshRange(gx0: number, gz0: number, gx1: number, gz1: number): void {
    const { resolution: res } = this.config;
    const geometry = this.mesh.geometry;
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    let colors = geometry.attributes.color as THREE.BufferAttribute | undefined;
    if (!colors) {
      colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
      geometry.setAttribute("color", colors);
    }

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gz * res + gx;
        const height = this.heightmap[i];
        positions.setZ(i, height);
        const color = MATERIAL_COLORS[this.materials[i]] ?? altitudeColor(height, SCRATCH_COLOR);
        colors.setXYZ(i, color.r, color.g, color.b);
      }
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
}
