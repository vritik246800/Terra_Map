/**
 * Import/export of `.glb` models (PLAN.md Fase 5, DESIGN.md §9.1).
 *
 *  - **Export** (`Export` button / `Ctrl/Cmd+E`): the selected entity, or the
 *    whole maquete (terrain + entities) when nothing is selected, is
 *    serialized with `GLTFExporter` (binary) and written by the Rust core via
 *    a native save dialog (filter `*.glb`). Cancelling the dialog is a no-op.
 *  - **Import** (`Import` button / `Ctrl/Cmd+I`): the Rust core shows a
 *    native open dialog and returns the bytes; `GLTFLoader` parses them with
 *    validation (parse errors and models without usable geometry get a
 *    friendly danger toast, A11). The model is placed at the origin with
 *    terrain snap + drop bounce (A5), becomes the selected entity and is
 *    registered as the reusable "Modelo personalizado" catalog template.
 *
 * Feedback uses the A11 toasts (`ui/toast.ts`); errors are also logged.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { a5DropBounce } from "../anim/scene";
import { openGlbDialog, saveGlb } from "../net/bridge";
import type { EntityRegistry } from "../scene/entities";
import { isUiControlFocused } from "../scene/shortcuts";
import type { Terrain } from "../scene/terrain";
import { identityTransform, store } from "../state/store";
import { t } from "../state/i18n";
import { showToast } from "../state/toasts";

export interface GlbActions {
  exportGlb(): Promise<void>;
  importGlb(): Promise<void>;
}

/** Display name of a written path ("C:\x\maquete.glb" → "maquete.glb"). */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Creates the .glb import/export actions wired to the scene and the store. */
export function createGlbActions(deps: {
  terrain: Terrain;
  registry: EntityRegistry;
  /** Fase 11: more scene objects of a full-maquete export (roads, water, vegetation). */
  extras?: () => THREE.Object3D[];
}): GlbActions {
  const { terrain, registry } = deps;

  async function exportGlb(): Promise<void> {
    const selectedId = store.selected;
    const selected = selectedId ? registry.getObject(selectedId) : undefined;
    // With a selection, export only it; otherwise the whole maquete (§9.1).
    const targets: THREE.Object3D[] = selected
      ? [selected]
      : [terrain.mesh, ...registry.pickables, ...(deps.extras?.() ?? [])];

    let glb: ArrayBuffer;
    try {
      const result = await new GLTFExporter().parseAsync(targets, { binary: true });
      if (!(result instanceof ArrayBuffer)) throw new Error("unexpected non-binary glTF");
      glb = result;
    } catch (err) {
      console.error("[glb] falha ao exportar:", err);
      showToast(t("toast.glbExportFailed"), "danger");
      return;
    }

    try {
      const path = await saveGlb(new Uint8Array(glb));
      if (path === null) return; // user cancelled the save dialog
      showToast(
        t(selected ? "toast.glbSelectionExported" : "toast.glbModelExported", {
          file: fileName(path),
        }),
        "success",
      );
    } catch (err) {
      console.error("[glb] falha ao gravar:", err);
      showToast(t("toast.glbWriteFailed"), "danger");
    }
  }

  async function importGlb(): Promise<void> {
    let picked;
    try {
      picked = await openGlbDialog();
    } catch (err) {
      console.error("[glb] falha ao ler o ficheiro:", err);
      showToast(t("toast.glbReadFailed"), "danger");
      return;
    }
    if (!picked) return; // user cancelled the open dialog

    let scene: THREE.Group;
    try {
      const gltf = await new GLTFLoader().parseAsync(new Uint8Array(picked.bytes).buffer, "");
      scene = gltf.scene;
    } catch (err) {
      console.error("[glb] ficheiro inválido:", err);
      showToast(t("toast.glbInvalid", { name: picked.name }), "danger");
      return;
    }

    // Validation: the model must contain meshes within a finite bounding box.
    let meshes = 0;
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshes++;
    });
    const box = new THREE.Box3().setFromObject(scene);
    const finite = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(
      Number.isFinite,
    );
    if (meshes === 0 || box.isEmpty() || !finite) {
      showToast(t("toast.glbNoGeometry", { name: picked.name }), "danger");
      return;
    }

    // The import becomes the reusable "Modelo personalizado" catalog template.
    registry.setCustomGlbTemplate(picked.name, scene, new Uint8Array(picked.bytes));
    store.setCustomGlbName(picked.name);

    const transform = identityTransform();
    transform.position.y = registry.snapY(0, 0);
    const info = registry.spawnCustomGlb(scene, transform);
    const content = registry.getContent(info.id);
    if (content) a5DropBounce(content);
    store.select(info.id);
    showToast(t("toast.glbImported", { name: picked.name }), "success");
  }

  return { exportGlb, importGlb };
}

/**
 * `Ctrl/Cmd+E` exports, `Ctrl/Cmd+I` imports (DESIGN.md §10). Ignored while a
 * UI control is focused or with Shift/Alt held (keeps devtools on Ctrl+Shift+I).
 */
export function initGlbShortcuts(actions: GlbActions): () => void {
  function onKeydown(e: KeyboardEvent): void {
    if (isUiControlFocused(e)) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === "e") {
      e.preventDefault();
      void actions.exportGlb();
    } else if (key === "i") {
      e.preventDefault();
      void actions.importGlb();
    }
  }
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
