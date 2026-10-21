/**
 * Guard for global viewport keyboard shortcuts (PLAN.md Fase 2) plus the
 * entity action shortcuts of Fase 4 (DESIGN.md §10):
 *
 *  - `Ctrl/Cmd + C` / `Ctrl/Cmd + V` (Fase 10): copy the selection — entities
 *    plus the cables between them — and paste it +2 m in X/Z per paste
 *    (grid snap, Y on the relief); the pasted copy becomes the selection;
 *  - `Ctrl/Cmd + D`: the same clone, +2 m, without touching the clipboard
 *    (params, dynamic props, marker label/note and `.glb` templates copy over);
 *  - `Delete` / `Backspace`: remove every selected entity and cable.
 *
 * A shortcut is ignored when the focus is inside a UI control (input, button,
 * select, textarea, contenteditable — e.g. spinners in the properties panel).
 * Plain viewport shortcuts are additionally ignored when a modifier is held
 * (DESIGN.md §10); `Ctrl/Cmd + D` is the exception and checks its modifier
 * explicitly.
 */
import type * as THREE from "three";

import {
  cloneCableInfo,
  cloneEntityInfo,
  store,
  type CableInfo,
  type EntityInfo,
} from "../state/store";
import type { CableRegistry } from "./cables";
import type { EntityRegistry } from "./entities";
import type { RoadRegistry } from "./roads";

/** True when the event target is (or is inside) a UI control. */
export function isUiControlFocused(e: KeyboardEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;

  return (
    el.isContentEditable ||
    el.closest("input, textarea, select, button, [contenteditable]") !== null
  );
}

export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;

  return isUiControlFocused(e);
}

/** Delete/Backspace and «Eliminar seleção»: removes every selected cable and entity. */
export function deleteSelection(
  registry: EntityRegistry,
  cables: CableRegistry,
  roads: RoadRegistry,
): void {
  for (const id of [...store.selection]) {
    if (store.getCableInfo(id)) cables.remove(id);
    else if (store.getRoadInfo(id))
      roads.remove(id); // Fase 11
    else registry.remove(id);
  }
}

/** Offset of each paste / duplicate (m, X and Z). */
const PASTE_STEP = 2;

interface Clip {
  entities: Array<{ info: EntityInfo; template?: THREE.Object3D }>;
  cables: CableInfo[];
}

/**
 * Wires the entity action shortcuts (Fases 4, 6, 10). Returns a cleanup
 * function that removes the listener.
 */
export function initEntityShortcuts(deps: {
  registry: EntityRegistry;
  cables: CableRegistry;
  roads: RoadRegistry;
}): () => void {
  const { registry, cables, roads } = deps;
  let clipboard: Clip | null = null;
  let pastes = 0;

  /** The selected entities plus every cable whose two ends are selected. */
  function copySelection(): Clip | null {
    const ids = new Set(store.selection.filter((id) => store.getEntityInfo(id)));
    if (ids.size === 0) return null;
    return {
      entities: [...ids].flatMap((id) => {
        const info = store.getEntityInfo(id);
        return info
          ? [{ info: cloneEntityInfo(info), template: registry.getEntityTemplate(id) }]
          : [];
      }),
      cables: store
        .allCables()
        .filter((c) => ids.has(c.fromId) && ids.has(c.toId))
        .map(cloneCableInfo),
    };
  }

  /** Recreates a clip `offset` m away in X/Z with fresh ids and selects it. */
  function paste(clip: Clip, offset: number): void {
    const newIds = new Map<string, string>();
    for (const { info } of clip.entities) newIds.set(info.id, registry.newId());
    for (const { info, template } of clip.entities) {
      const copy = cloneEntityInfo(info);
      copy.id = newIds.get(info.id) ?? registry.newId();
      const x = store.snapToGrid(info.transform.position.x + offset);
      const z = store.snapToGrid(info.transform.position.z + offset);
      copy.transform.position = { x, y: registry.snapY(x, z), z };
      // A marker points at the copy of its target, else the original (if still there).
      if (copy.targetId) {
        const target = newIds.get(copy.targetId);
        if (target) copy.targetId = target;
        else if (!store.getEntityInfo(copy.targetId)) delete copy.targetId;
      }
      registry.restore(copy, template);
    }
    for (const cable of clip.cables) {
      const fromId = newIds.get(cable.fromId);
      const toId = newIds.get(cable.toId);
      if (fromId && toId)
        cables.restore({ ...cloneCableInfo(cable), id: cables.newId(), fromId, toId });
    }
    registry.updateCollisionWarnings();
    store.selectMany([...newIds.values()]);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (isUiControlFocused(e)) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault(); // browser bookmark shortcut
        const clip = copySelection();
        if (clip) paste(clip, PASTE_STEP);
        return;
      }
      if (key === "c") {
        const clip = copySelection();
        if (!clip) return;
        e.preventDefault();
        clipboard = clip;
        pastes = 0;
        return;
      }
      if (key === "v" && clipboard) {
        e.preventDefault();
        pastes++;
        paste(clipboard, PASTE_STEP * pastes);
        return;
      }
    }

    if (shouldIgnoreShortcut(e)) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection(registry, cables, roads);
    }
  }

  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
