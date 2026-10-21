/**
 * Align / distribute the selected entities (Fase 10, UX.md §2) along world X
 * or Z: to the smallest coordinate ("esquerda"/"frente"), to the mean
 * ("centro"), or evenly spaced between the two outermost ones. Y re-snaps to
 * the relief; one call = one undo entry (same tick).
 */
import type { EntityRegistry } from "../scene/entities";
import { cloneTransform, store } from "../state/store";

export type ArrangeAxis = "x" | "z";
export type ArrangeMode = "min" | "center" | "distribute";

export function arrangeSelection(
  registry: EntityRegistry,
  axis: ArrangeAxis,
  mode: ArrangeMode,
): void {
  const items = store.selection.flatMap((id) => {
    const info = store.getEntityInfo(id);
    return info ? [{ id, info }] : [];
  });
  if (items.length < 2) return;
  const values = items.map(({ info }) => info.transform.position[axis]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  // Distribute keeps the order along the axis.
  const order = [...items].sort(
    (a, b) => a.info.transform.position[axis] - b.info.transform.position[axis],
  );
  const step = (max - min) / (items.length - 1);

  for (const { id, info } of items) {
    const transform = cloneTransform(info.transform);
    transform.position[axis] =
      mode === "min"
        ? min
        : mode === "center"
          ? mean
          : min + step * order.findIndex((o) => o.id === id);
    transform.position.y = registry.snapY(transform.position.x, transform.position.z);
    store.updateEntity(id, { transform });
    registry.syncTransform(id);
  }
  registry.updateCollisionWarnings();
}
