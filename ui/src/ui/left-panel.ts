import gsap from "gsap";

import { CUSTOM_GLB_KIND, isNetworkKind, store, type TerrainPresetId } from "../state/store";
import { endEntityDrag, isBuildingKind, startEntityDrag } from "../tools/drag-drop";
import type { TerrainActions } from "../tools/terrain-actions";
import { showToast } from "./toast";
import "./left-panel.css";

interface CatalogItemDef {
  /** Stable identifier used by actions and later phases (drag & drop). */
  kind: string;
  label: string;
}

interface CatalogGroupDef {
  id: string;
  title: string;
  items: CatalogItemDef[];
}

/** Catalog contents per DESIGN.md §5.2. Labels are pt-PT; kinds are stable ids. */
const CATALOG: CatalogGroupDef[] = [
  {
    id: "terrain",
    title: "Terreno",
    items: [
      { kind: "flat", label: "Plano" },
      { kind: "mountains", label: "Montanhas" },
      { kind: "valley", label: "Vale" },
      { kind: "custom", label: "Personalizado" },
      { kind: "brush", label: "Pincel" },
      { kind: "savePreset", label: "Guardar preset" },
      { kind: "presets", label: "Presets" },
      { kind: "importHeightmap", label: "Importar heightmap (PNG)…" },
    ],
  },
  {
    id: "infra",
    title: "Infraestruturas",
    items: [
      { kind: "house", label: "Casa" },
      { kind: "building", label: "Prédio" },
      { kind: "lot", label: "Lote" },
      { kind: "customGlb", label: "Modelo personalizado" },
    ],
  },
  {
    id: "network",
    title: "Redes & Telecom",
    items: [
      { kind: "antenna", label: "Antena" },
      { kind: "router", label: "Router" },
      { kind: "switch", label: "Switch" },
      { kind: "olt", label: "OLT" },
      { kind: "onu", label: "ONU" },
      { kind: "splitter", label: "Splitter" },
      { kind: "pole", label: "Poste" },
      { kind: "box", label: "Caixa de distribuição" },
      { kind: "cable", label: "Cabo" },
      { kind: "marker", label: "Marcador" },
    ],
  },
];

const TERRAIN_PRESET_KINDS = new Set(["flat", "mountains", "valley", "custom"]);

const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" focusable="false">' +
  '<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const A15_DURATION = 0.25; // seconds — DESIGN.md §8.1 (A15)

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Logs async action failures (friendly toasts arrive with A11 in Fase 8). */
function run(action: Promise<void>): void {
  action.catch((err: unknown) => console.error("[terreno]", err));
}

/**
 * Animation A15: expand/collapse a catalog group.
 * Animates the item container height and rotates the chevron (GSAP, 250ms,
 * power2.inOut). With reduced motion, toggles instantly to the final state.
 */
function toggleGroupItems(items: HTMLElement, chevron: HTMLElement, open: boolean): void {
  gsap.killTweensOf([items, chevron]);

  if (prefersReducedMotion()) {
    items.style.display = open ? "" : "none";
    items.style.height = "";
    gsap.set(chevron, { rotate: open ? 90 : 0 });
    return;
  }

  if (open) {
    items.style.display = "";
    gsap.fromTo(
      items,
      { height: 0 },
      {
        height: items.scrollHeight,
        duration: A15_DURATION,
        ease: "power2.inOut",
        // Clear the inline height so the container can grow with its content.
        onComplete: () => {
          items.style.height = "";
        },
      },
    );
  } else {
    gsap.fromTo(
      items,
      { height: items.offsetHeight },
      {
        height: 0,
        duration: A15_DURATION,
        ease: "power2.inOut",
        onComplete: () => {
          items.style.display = "none";
          items.style.height = "";
        },
      },
    );
  }

  gsap.to(chevron, {
    rotate: open ? 90 : 0,
    duration: A15_DURATION,
    ease: "power2.inOut",
  });
}

/**
 * Sub-list of saved terrain presets (PLAN.md Fase 3), shown under the
 * "Presets" item. Refreshed from the Rust core each time it opens.
 */
function buildPresetsSublist(actions: TerrainActions): { root: HTMLElement; refresh(): void } {
  const root = document.createElement("ul");
  root.className = "catalog-preset-list";
  root.style.display = "none";

  async function refresh(): Promise<void> {
    let presets;
    try {
      presets = await actions.listPresets();
    } catch (err) {
      console.error("[terreno] falha a listar presets:", err);
      return;
    }
    root.replaceChildren();
    if (presets.length === 0) {
      const li = document.createElement("li");
      li.className = "catalog-preset-empty";
      li.textContent = "Sem presets guardados";
      root.append(li);
      return;
    }
    for (const preset of presets) {
      const li = document.createElement("li");
      const item = document.createElement("button");
      item.type = "button";
      item.className = "catalog-item catalog-preset-item";
      item.textContent = preset.name;
      item.addEventListener("click", () => run(actions.loadPreset(preset.file)));
      li.append(item);
      root.append(li);
    }
  }

  return { root, refresh: () => void refresh() };
}

function buildGroup(
  def: CatalogGroupDef,
  expanded: boolean,
  actions: TerrainActions,
  presetItems: Map<string, HTMLElement>,
  brushItem: { current: HTMLElement | null },
  customGlbItem: { current: HTMLElement | null },
  cableItem: { current: HTMLElement | null },
  markerItem: { current: HTMLElement | null },
): HTMLElement {
  const section = document.createElement("section");
  section.className = "catalog-group";

  const itemsId = `catalog-items-${def.id}`;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "catalog-group-header";
  header.setAttribute("aria-expanded", String(expanded));
  header.setAttribute("aria-controls", itemsId);

  const label = document.createElement("span");
  label.className = "catalog-group-label";
  label.textContent = def.title;

  const chevron = document.createElement("span");
  chevron.className = "catalog-group-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = CHEVRON_SVG;
  gsap.set(chevron, { rotate: expanded ? 90 : 0 });

  header.append(label, chevron);

  const items = document.createElement("div");
  items.className = "catalog-group-items";
  items.id = itemsId;
  if (!expanded) items.style.display = "none";

  const list = document.createElement("ul");
  list.className = "catalog-list";

  for (const itemDef of def.items) {
    const kind = itemDef.kind;
    const li = document.createElement("li");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "catalog-item";
    item.draggable = true;
    item.dataset.kind = kind;
    item.textContent = itemDef.label;

    if (def.id === "infra" && isBuildingKind(kind)) {
      // Fase 4: dragging a Casa/Prédio/Lote into the viewport spawns the
      // entity (ghost A4 + drop A5 — see tools/drag-drop.ts).
      item.addEventListener("dragstart", (e) => startEntityDrag(e, kind));
      item.addEventListener("dragend", () => endEntityDrag());
    }

    if (def.id === "network" && isNetworkKind(kind)) {
      // Fase 6: network elements drag & drop like the infrastructures.
      item.addEventListener("dragstart", (e) => startEntityDrag(e, kind));
      item.addEventListener("dragend", () => endEntityDrag());
    }

    if (def.id === "network" && (kind === "cable" || kind === "marker")) {
      // Fase 6: Cabo/Marcador are tool toggles, not draggable entities.
      item.draggable = false;
      item.setAttribute("aria-pressed", "false");
      const ref = kind === "cable" ? cableItem : markerItem;
      ref.current = item;
      item.addEventListener("click", () =>
        store.setTool(store.tool === kind ? "select" : kind),
      );
    }

    if (def.id === "infra" && kind === CUSTOM_GLB_KIND) {
      // Fase 5: reusable imported .glb — only draggable after an import
      // (store.customGlbName); otherwise a hint toast explains how.
      customGlbItem.current = item;
      item.setAttribute("aria-disabled", "true");
      item.classList.add("is-disabled");
      item.addEventListener("dragstart", (e) => {
        if (!store.customGlbName) {
          e.preventDefault();
          return;
        }
        startEntityDrag(e, CUSTOM_GLB_KIND);
      });
      item.addEventListener("dragend", () => endEntityDrag());
      item.addEventListener("click", () => {
        if (!store.customGlbName) {
          showToast("Importa primeiro um modelo .glb (Importar ou Ctrl+I).", "info");
        }
      });
    }

    if (def.id === "terrain") {
      if (TERRAIN_PRESET_KINDS.has(itemDef.kind)) {
        presetItems.set(itemDef.kind, item);
        item.addEventListener("click", () =>
          run(actions.createFromPreset(itemDef.kind as TerrainPresetId)),
        );
      } else if (itemDef.kind === "brush") {
        brushItem.current = item;
        item.setAttribute("aria-pressed", "false");
        item.addEventListener("click", () =>
          store.setTool(store.tool === "brush" ? "select" : "brush"),
        );
      } else if (itemDef.kind === "savePreset") {
        item.addEventListener("click", () => run(actions.saveCurrentAsPreset()));
      } else if (itemDef.kind === "importHeightmap") {
        item.addEventListener("click", () => run(actions.importHeightmap()));
      } else if (itemDef.kind === "presets") {
        const sublist = buildPresetsSublist(actions);
        item.setAttribute("aria-label", "Presets de terreno guardados (mostrar/esconder lista)");
        item.addEventListener("click", () => {
          const open = sublist.root.style.display === "none";
          sublist.root.style.display = open ? "" : "none";
          item.classList.toggle("is-active", open);
          if (open) sublist.refresh();
        });
        li.append(item, sublist.root);
        list.append(li);
        continue;
      }
    }

    li.append(item);
    list.append(li);
  }

  items.append(list);

  let open = expanded;
  header.addEventListener("click", () => {
    open = !open;
    header.setAttribute("aria-expanded", String(open));
    toggleGroupItems(items, chevron, open);
  });

  section.append(header, items);
  return section;
}

/**
 * Builds the left catalog panel (DESIGN.md §5): a glass `<aside>` with three
 * independently collapsible groups (Terreno, Infraestruturas, Redes & Telecom).
 * The first group starts expanded.
 *
 * Fase 3 wires the Terreno group: presets create the terrain from scratch,
 * "Pincel" toggles the brush tool (§12), "Guardar preset" saves the current
 * terrain and "Presets" lists/loads saved presets.
 */
export function createLeftPanel(actions: TerrainActions): HTMLElement {
  const aside = document.createElement("aside");
  aside.className = "panel-left glass";
  aside.setAttribute("role", "complementary");
  aside.setAttribute("aria-label", "Catálogo de elementos");

  const presetItems = new Map<string, HTMLElement>();
  const brushItem: { current: HTMLElement | null } = { current: null };
  const customGlbItem: { current: HTMLElement | null } = { current: null };
  const cableItem: { current: HTMLElement | null } = { current: null };
  const markerItem: { current: HTMLElement | null } = { current: null };

  CATALOG.forEach((def, index) => {
    aside.append(
      buildGroup(def, index === 0, actions, presetItems, brushItem, customGlbItem, cableItem, markerItem),
    );
  });

  // Active states follow the store: current preset + brush tool toggle.
  store.subscribe(() => {
    for (const [kind, item] of presetItems) {
      item.classList.toggle("is-active", store.terrainPreset === kind);
    }
    const brush = brushItem.current;
    if (brush) {
      const active = store.tool === "brush";
      brush.classList.toggle("is-active", active);
      brush.setAttribute("aria-pressed", String(active));
    }
    // Fase 6: Cabo/Marcador tool toggles follow the active tool.
    for (const [toolId, ref] of [
      ["cable", cableItem],
      ["marker", markerItem],
    ] as const) {
      const item = ref.current;
      if (!item) continue;
      const active = store.tool === toolId;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    // Fase 5: "Modelo personalizado" activates once a .glb has been imported.
    const customGlb = customGlbItem.current;
    if (customGlb) {
      const name = store.customGlbName;
      customGlb.classList.toggle("is-disabled", name === null);
      customGlb.setAttribute("aria-disabled", String(name === null));
      customGlb.title = name
        ? `Modelo importado: ${name}.glb — arrasta para o viewport.`
        : "Importa um ficheiro .glb para ativar (Importar ou Ctrl+I).";
    }
  });

  return aside;
}
