/**
 * Terrain actions shared by the catalog and the properties panel
 * (PLAN.md Fase 3): create from preset (reset), save/load presets.
 *
 * Keeps the invoke + store + Terrain orchestration out of the UI components.
 */
import {
  listTerrainPresets,
  loadTerrainPreset,
  saveTerrainPreset,
  type PresetSummary,
  type TerrainPresetFile,
} from "../net/bridge";
import { DEFAULT_TERRAIN, encodeHeightmap, Terrain } from "../scene/terrain";
import { store, type TerrainPresetId } from "../state/store";

export interface TerrainActions {
  /** Creates a terrain from scratch (reset) with the chosen preset. */
  createFromPreset(preset: TerrainPresetId): Promise<void>;
  /** Prompts for a name and saves the current terrain as a preset file. */
  saveCurrentAsPreset(): Promise<void>;
  /** Loads a saved preset by file stem. */
  loadPreset(file: string): Promise<void>;
  /** Lists saved presets for the catalog. */
  listPresets(): Promise<PresetSummary[]>;
  /** Imports a grayscale image (PNG) as the terrain heightmap. */
  importHeightmap(): Promise<void>;
}

/** Rec. 601 luminance of an RGBA pixel, 0–255. */
function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * Decodes an image file to a heightmap of `res²` heights: grayscale
 * luminance (0–255) scaled to 0..amplitude meters, bilinear-resampled to
 * the terrain grid. Image row 0 (top) maps to gz = 0 (far side, z = −size/2).
 */
async function decodeHeightmapImage(
  file: File,
  res: number,
  amplitude: number,
): Promise<Float32Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem contexto 2D para ler a imagem");
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Luminance per source pixel (alpha-ignored), then bilinear resample.
    const lum = new Float32Array(width * height);
    for (let i = 0; i < lum.length; i++) lum[i] = luminance(data, i * 4);

    const heights = new Float32Array(res * res);
    const sx = (width - 1) / (res - 1);
    const sy = (height - 1) / (res - 1);
    for (let gz = 0; gz < res; gz++) {
      for (let gx = 0; gx < res; gx++) {
        const fx = gx * sx;
        const fy = gz * sy;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const top = lum[y0 * width + x0] + (lum[y0 * width + x1] - lum[y0 * width + x0]) * tx;
        const bottom = lum[y1 * width + x0] + (lum[y1 * width + x1] - lum[y1 * width + x0]) * tx;
        heights[gz * res + gx] = ((top + (bottom - top) * ty) / 255) * amplitude;
      }
    }
    return heights;
  } finally {
    bitmap.close();
  }
}

/** Opens a file picker for an image; resolves to `null` when cancelled. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/*";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

export function createTerrainActions(terrain: Terrain): TerrainActions {
  async function createFromPreset(preset: TerrainPresetId): Promise<void> {
    const custom = store.customParams;
    await terrain.regenerate({
      preset,
      size: preset === "custom" ? custom.size : DEFAULT_TERRAIN.size,
      resolution: DEFAULT_TERRAIN.resolution,
      seed: preset === "custom" ? custom.seed : DEFAULT_TERRAIN.seed,
      amplitude: preset === "custom" ? custom.amplitude : DEFAULT_TERRAIN.amplitude,
      frequency: preset === "custom" ? custom.frequency : DEFAULT_TERRAIN.frequency,
    });
    store.setTerrainPreset(preset);
    store.markTerrainChanged(); // unsaved change + undo snapshot (Fases 8, 10)
  }

  async function saveCurrentAsPreset(): Promise<void> {
    const name = window.prompt("Nome do preset de terreno:");
    if (!name || !name.trim()) return; // cancelado ou nome vazio

    const config = terrain.current;
    const file: TerrainPresetFile = {
      name: name.trim(),
      preset: config.preset,
      params: {
        seed: config.seed,
        amplitude: config.amplitude,
        frequency: config.frequency,
        size: config.size,
        resolution: config.resolution,
      },
      heightmap: encodeHeightmap(terrain.heights),
    };
    await saveTerrainPreset(file);
  }

  async function loadPreset(file: string): Promise<void> {
    const data = await loadTerrainPreset(file);
    await terrain.applyPresetFile(data);
    store.setTerrainPreset(terrain.current.preset);
    store.markTerrainChanged();
    if (terrain.current.preset === "custom") {
      const { seed, amplitude, frequency, size } = terrain.current;
      store.setCustomParams({ seed, amplitude, frequency, size });
    }
  }

  async function importHeightmap(): Promise<void> {
    const file = await pickImageFile();
    if (!file) return; // picker cancelled — silent no-op

    const { resolution, amplitude } = terrain.current;
    // Keep the current amplitude when meaningful; default 20 m otherwise.
    const amp = amplitude > 0 ? amplitude : 20;
    const heights = await decodeHeightmapImage(file, resolution, amp);
    terrain.applyHeightmapImage(heights, amp);
    store.setTerrainPreset("custom");
    store.markTerrainChanged();
    const { seed, amplitude: a, frequency, size } = terrain.current;
    store.setCustomParams({ seed, amplitude: a, frequency, size });
  }

  return {
    createFromPreset,
    saveCurrentAsPreset,
    loadPreset,
    listPresets: listTerrainPresets,
    importHeightmap,
  };
}
