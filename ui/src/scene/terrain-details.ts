/**
 * Terrain details of the material brush (Fase 17, Q_LIST.md Q43): painting
 * grass grows grass tufts, snow drifts, rock boulders, dirt clods and sand
 * ripples — the Blender models of `public/models/detail_*.glb`, one
 * `InstancedMesh` per material.
 *
 * Nothing is stored: the instances are derived from the terrain material map
 * with a fixed hash per vertex, so the same painting always grows the same
 * details (project open, undo, redo). They rebuild when the terrain changes
 * (`terrain.version`, checked on store changes — after each brush gesture)
 * and live on the Terrain layer.
 *
 * ponytail: full rebuild per change (≤ 128² vertices, a few ms); rebuild only
 * the painted region if larger terrains make it noticeable.
 */
import * as THREE from "three";

import { store } from "../state/store";
import { mergedGeometry } from "./merge-content";
import { cloneModel, type ModelKind } from "./models";
import type { Terrain } from "./terrain";

interface DetailRule {
  model: ModelKind;
  /** Tries per painted vertex and the chance each one grows an instance. */
  tries: number;
  chance: number;
  scale: [number, number];
}

/** Material id (terrain.ts MATERIAL_COLORS) → its detail. */
const RULES: Record<number, DetailRule> = {
  1: { model: "detail_grass", tries: 3, chance: 0.6, scale: [0.8, 1.5] },
  2: { model: "detail_dirt", tries: 1, chance: 0.35, scale: [0.8, 1.6] },
  3: { model: "detail_sand", tries: 1, chance: 0.3, scale: [0.8, 1.4] },
  4: { model: "detail_rock", tries: 1, chance: 0.4, scale: [0.6, 1.8] },
  5: { model: "detail_snow", tries: 1, chance: 0.45, scale: [0.8, 1.7] },
};

/** Deterministic [0, 1) per (vertex, try, channel). */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class TerrainDetails {
  private meshes = new Map<number, THREE.InstancedMesh>();
  private seenVersion = -1;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {
    store.subscribe(() => this.sync());
    this.sync();
  }

  /** The instanced meshes (Terrain layer, glb export). */
  get objects(): THREE.Object3D[] {
    return [...this.meshes.values()];
  }

  /** Instances per material id (tests, report). */
  count(material: number): number {
    return this.meshes.get(material)?.count ?? 0;
  }

  private sync(): void {
    if (this.terrain.version === this.seenVersion) return;
    this.seenVersion = this.terrain.version;
    this.rebuild();
  }

  private rebuild(): void {
    const { size, resolution: res } = this.terrain.current;
    const step = size / (res - 1);
    const map = this.terrain.materialMap;
    const lists = new Map<number, THREE.Matrix4[]>();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let gz = 0; gz < res; gz++) {
      for (let gx = 0; gx < res; gx++) {
        const material = map[gz * res + gx];
        const rule = RULES[material];
        if (!rule) continue;
        for (let t = 0; t < rule.tries; t++) {
          if (hash(gx, gz, t * 8 + material) >= rule.chance) continue;
          const x = -size / 2 + (gx + hash(gx, gz, t * 8 + 101) - 0.5) * step;
          const z = -size / 2 + (gz + hash(gx, gz, t * 8 + 202) - 0.5) * step;
          position.set(x, this.terrain.getHeight(x, z), z);
          quaternion.setFromAxisAngle(up, hash(gx, gz, t * 8 + 303) * Math.PI * 2);
          const [s0, s1] = rule.scale;
          scale.setScalar(s0 + (s1 - s0) * hash(gx, gz, t * 8 + 404));
          let list = lists.get(material);
          if (!list) lists.set(material, (list = []));
          list.push(new THREE.Matrix4().compose(position, quaternion, scale));
        }
      }
    }

    for (const [material, rule] of Object.entries(RULES)) {
      const id = Number(material);
      const list = lists.get(id) ?? [];
      const mesh = this.meshFor(id, rule, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /** Mesh of a material with room for `count` instances (grows by doubling). */
  private meshFor(material: number, rule: DetailRule, count: number): THREE.InstancedMesh {
    const current = this.meshes.get(material);
    if (current && current.instanceMatrix.count >= Math.max(count, 1)) return current;
    let capacity = current?.instanceMatrix.count ?? 256;
    while (capacity < count) capacity *= 2;
    const mesh = new THREE.InstancedMesh(
      current?.geometry ?? mergedGeometry(cloneModel(rule.model)) ?? new THREE.BufferGeometry(),
      current?.material ??
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.95,
          side: THREE.DoubleSide, // grass blades are single faces
        }),
      capacity,
    );
    mesh.name = `terrain-detail-${rule.model}`;
    mesh.receiveShadow = true;
    if (current) {
      mesh.visible = current.visible;
      this.scene.remove(current);
      current.dispose();
    }
    this.scene.add(mesh);
    this.meshes.set(material, mesh);
    return mesh;
  }
}
