/**
 * Draw-call reduction for procedural models (Fase 9, DECISAO_TECNOLOGICA.md).
 *
 * A house is ~9 meshes and a building one per floor and band (up to ~100),
 * each a draw call — twice with shadows. `mergeContent` fuses every mesh of
 * an entity into ONE mesh: positions/normals in content space, the source
 * material color baked as vertex colors, one MeshStandardMaterial. Same
 * look, one draw call per entity; selection, bounding boxes and the phase
 * opacity (uniform per entity) keep working. Non-mesh children (lot edge
 * lines, marker sprites) are left as they are.
 *
 * ponytail: per-entity merge, not cross-entity instancing — entities stay
 * individually editable; InstancedMesh is for many identical, non-editable
 * objects (vegetation, Fase 11).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Transform of `object` relative to `root` (its ancestor). */
function matrixRelativeTo(object: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  for (let o: THREE.Object3D | null = object; o && o !== root; o = o.parent) {
    o.updateMatrix();
    matrix.premultiply(o.matrix);
  }
  return matrix;
}

export function mergeContent(content: THREE.Group): void {
  const meshes: THREE.Mesh[] = [];
  content.traverse((obj) => {
    if (obj instanceof THREE.Mesh && !Array.isArray(obj.material)) meshes.push(obj);
  });
  if (meshes.length < 2) return;

  const template = meshes[0].material as THREE.MeshStandardMaterial;
  const parts = meshes.map((mesh) => {
    const source = mesh.geometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    }
    geometry.clearGroups();
    geometry.applyMatrix4(matrixRelativeTo(mesh, content));
    const color = (mesh.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  });
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) return; // incompatible attributes — keep the separate meshes

  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      transparent: template.transparent,
      opacity: template.opacity,
    }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  content.add(mesh);
}
