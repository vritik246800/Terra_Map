/**
 * Guard for global viewport keyboard shortcuts (PLAN.md Fase 2) plus the
 * entity action shortcuts of Fase 4 (DESIGN.md §10):
 *
 *  - `Ctrl/Cmd + D`: duplicate the selected entity (+2 m offset in X/Z,
 *    snapped to the terrain);
 *  - `Delete` / `Backspace`: remove the selected entity.
 *
 * A shortcut is ignored when the focus is inside a UI control (input, button,
 * select, textarea, contenteditable — e.g. spinners in the properties panel).
 * Plain viewport shortcuts are additionally ignored when a modifier is held
 * (DESIGN.md §10); `Ctrl/Cmd + D` is the exception and checks its modifier
 * explicitly.
 */
import { cloneTransform, CUSTOM_GLB_KIND, store, type BuildingKind } from "../state/store";
import type { EntityRegistry } from "./entities";

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

/**
 * Wires the entity action shortcuts (Fase 4). Returns a cleanup function
 * that removes the listener.
 */
export function initEntityShortcuts(deps: { registry: EntityRegistry }): () => void {
  const { registry } = deps;

  /** Ctrl/Cmd+D: spawns a copy of the selected entity +2 m in X and Z. */
  function duplicateSelected(): void {
    const id = store.selected;
    if (!id) return;
    const info = store.getEntityInfo(id);
    if (!info) return;

    const transform = cloneTransform(info.transform);
    transform.position.x += 2;
    transform.position.z += 2;
    transform.position.y = registry.snapY(transform.position.x, transform.position.z);

    // Imported .glb models (Fase 5) spawn from their stored template.
    const copy =
      info.kind === CUSTOM_GLB_KIND
        ? (() => {
            const template = registry.getEntityTemplate(id);
            return template ? registry.spawnCustomGlb(template, transform) : null;
          })()
        : registry.spawn(info.kind as BuildingKind, transform, info.phase);
    if (!copy) return;
    if (Object.keys(info.params).length > 0) {
      // spawn only seeds default params; copy the originals and rebuild.
      store.updateEntity(copy.id, { params: { ...info.params } });
      registry.applyPhase(copy.id);
    }
    registry.updateCollisionWarnings();
    store.select(copy.id);
  }

  /** Delete/Backspace: removes the selected entity (clears the selection). */
  function deleteSelected(): void {
    const id = store.selected;
    if (!id) return;
    registry.remove(id);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (isUiControlFocused(e)) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault(); // browser bookmark shortcut
      duplicateSelected();
      return;
    }

    if (shouldIgnoreShortcut(e)) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
    }
  }

  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
