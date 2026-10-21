/**
 * Display labels shared by the panels and the undo history (Fase 10), in the
 * current language (Fase 13 — `state/i18n.ts`).
 */
import { t, type MessageKey } from "./i18n";
import { store, type LayerId } from "./store";

/** Label of an entity kind (Fase 4 infrastructures, Fase 5 .glb, Fase 6 network + marker). */
export function kindLabel(kind: string): string {
  const key = `kind.${kind}` as MessageKey;
  const label = t(key);
  return label === key ? kind : label; // unknown kind: show it as is
}

/** Name of a fixed layer (Fase 10). */
export function layerLabel(id: LayerId): string {
  return t(`layer.${id}`);
}

/** Why a layer refuses edits, or null when it is visible and unlocked. */
export function layerBlockReason(id: LayerId): string | null {
  const layer = store.layer(id);
  if (!layer.visible) return t("layer.hidden", { layer: layerLabel(id) });
  if (layer.locked) return t("layer.locked", { layer: layerLabel(id) });
  return null;
}
