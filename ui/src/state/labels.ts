/** pt-PT display labels shared by the panels and the undo history (Fase 10). */
import { CUSTOM_GLB_KIND, MARKER_KIND, store, type LayerId } from "./store";

/** pt-PT labels for entity kinds (Fase 4 infrastructures, Fase 5 .glb, Fase 6 network + marker). */
export const KIND_LABELS: Record<string, string> = {
  house: "Casa",
  building: "Prédio",
  lot: "Lote",
  [CUSTOM_GLB_KIND]: "Modelo personalizado",
  antenna: "Antena",
  router: "Router",
  switch: "Switch",
  olt: "OLT",
  onu: "ONU",
  splitter: "Splitter",
  pole: "Poste",
  box: "Caixa de distribuição",
  [MARKER_KIND]: "Marcador",
};

/** pt-PT names of the fixed layers (Fase 10). */
export const LAYER_LABELS: Record<LayerId, string> = {
  terrain: "Terreno",
  infra: "Infraestruturas",
  net: "Redes",
  markers: "Marcadores",
};

/** Why a layer refuses edits, or null when it is visible and unlocked. */
export function layerBlockReason(id: LayerId): string | null {
  const layer = store.layer(id);
  if (!layer.visible) return `A camada ${LAYER_LABELS[id]} está oculta.`;
  if (layer.locked) return `A camada ${LAYER_LABELS[id]} está bloqueada.`;
  return null;
}
