/**
 * Vegetation (Fase 11, DESIGN.md §1.7): one `InstancedMesh` per species —
 * a whole forest is two draw calls. Instances follow `store.vegetation` (and
 * the relief, after every terrain change); while the brush scatters, the
 * gesture's working list is shown through `preview` before it reaches the
 * store. Geometries carry vertex colors (trunk/crown) like the merged
 * procedural models (`merge-content.ts`).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { store, type Plant, type PlantKind } from "../state/store";
import type { Terrain } from "./terrain";

const INITIAL_CAPACITY = 256;

/** Paints a geometry with one color (vertex colors) and drops its uv. */
function colored(geometry: THREE.BufferGeometry, hex: string, y: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("uv");
  g.translate(0, y, 0);
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function speciesGeometry(kind: PlantKind): THREE.BufferGeometry {
  if (kind === "bush") return colored(new THREE.IcosahedronGeometry(0.9, 1), "#4f8f45", 0.7);
  const trunk = colored(new THREE.CylinderGeometry(0.18, 0.25, 2, 8), "#6b4a2f", 1);
  const crown = colored(new THREE.ConeGeometry(1.5, 4, 10), "#3f7d3a", 3.8);
  return mergeGeometries([trunk, crown]) ?? trunk;
}

export class VegetationLayer {
  private meshes = new Map<PlantKind, THREE.InstancedMesh>();
  private shown: readonly Plant[] = [];
  private seenTerrainRevision = -1;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {
    store.subscribe(() => {
      if (store.vegetation !== this.shown || store.terrainRevision !== this.seenTerrainRevision) {
        this.seenTerrainRevision = store.terrainRevision;
        this.preview(store.vegetation);
      }
    });
  }

  /** The instanced meshes (glb export, layers). */
  get objects(): THREE.Object3D[] {
    return [...this.meshes.values()];
  }

  /** Draws `plants` (the store list, or a brush gesture in progress). */
  preview(plants: readonly Plant[]): void {
    this.shown = plants;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const kind of ["tree", "bush"] as const) {
      const list = plants.filter((p) => p.kind === kind);
      const mesh = this.meshFor(kind, list.length);
      list.forEach((p, i) => {
        position.set(p.x, this.terrain.getHeight(p.x, p.z), p.z);
        quaternion.setFromAxisAngle(up, p.rotation);
        scale.setScalar(p.scale);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); // instanced bounds, so frustum culling stays correct
    }
  }

  /** Mesh of a species with room for `count` instances (grows by doubling). */
  private meshFor(kind: PlantKind, count: number): THREE.InstancedMesh {
    const current = this.meshes.get(kind);
    if (current && current.instanceMatrix.count >= count) return current;
    let capacity = current?.instanceMatrix.count ?? INITIAL_CAPACITY;
    while (capacity < count) capacity *= 2;
    const mesh = new THREE.InstancedMesh(
      current?.geometry ?? speciesGeometry(kind),
      current?.material ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      capacity,
    );
    mesh.name = `vegetation-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (current) {
      mesh.visible = current.visible;
      this.scene.remove(current);
      current.dispose(); // instance buffers only — geometry/material are reused
    }
    this.scene.add(mesh);
    this.meshes.set(kind, mesh);
    return mesh;
  }
}
