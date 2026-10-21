/**
 * Left catalog panel (DESIGN.md §5): three independently collapsible groups
 * (Terreno, Infraestruturas, Redes & Telecom) with A15; the first starts open.
 *
 * Terreno: presets create the terrain from scratch, "Pincel" toggles the brush
 * tool (§12), "Guardar preset" saves, "Presets" lists/loads saved presets.
 * Infraestruturas / Redes: drag into the viewport (A4/A5 in tools/drag-drop.ts);
 * "Modelo personalizado" only after a `.glb` import; Cabo/Marcador toggle tools.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { a15Init, a15Toggle } from "../anim/ui";
import type { PresetSummary } from "../net/bridge";
import { CUSTOM_GLB_KIND, isNetworkKind, type TerrainPresetId, type ToolId } from "../state/store";
import { showToast } from "../state/toasts";
import { useStore } from "../state/use-store";
import { endEntityDrag, isBuildingKind, startEntityDrag } from "../tools/drag-drop";
import type { TerrainActions } from "../tools/terrain-actions";
import "./left-panel.css";

interface CatalogGroupDef {
  id: string;
  title: string;
  items: Array<{ kind: string; label: string }>;
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
      { kind: CUSTOM_GLB_KIND, label: "Modelo personalizado" },
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
  {
    // Fase 11 (UX.md §2).
    id: "environment",
    title: "Ambiente",
    items: [
      { kind: "environment", label: "Hora, céu e água" },
      { kind: "paint", label: "Pincel de materiais" },
      { kind: "vegetation", label: "Vegetação" },
      { kind: "road", label: "Estrada" },
      { kind: "presentation", label: "Modo apresentação" },
    ],
  },
];

const TERRAIN_PRESET_KINDS = new Set(["flat", "mountains", "valley", "custom"]);
const TOOL_KINDS = new Set<string>(["brush", "paint", "vegetation", "road", "cable", "marker"]);

/** Accent- and case-insensitive text for the catalog search (Fase 10). */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Logs async action failures. */
function run(action: Promise<void>): void {
  action.catch((err: unknown) => console.error("[terreno]", err));
}

function CatalogGroup({
  def,
  initiallyOpen,
  children,
}: {
  def: CatalogGroupDef;
  initiallyOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const itemsRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLSpanElement>(null);
  const firstRender = useRef(true);

  useLayoutEffect(() => {
    const items = itemsRef.current;
    const chevron = chevronRef.current;
    if (!items || !chevron) return;
    if (firstRender.current) {
      firstRender.current = false;
      a15Init(items, chevron, open);
      return;
    }
    a15Toggle(items, chevron, open);
  }, [open]);

  const itemsId = `catalog-items-${def.id}`;
  return (
    <section className="catalog-group">
      <button
        type="button"
        className="catalog-group-header"
        aria-expanded={open}
        aria-controls={itemsId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="catalog-group-label">{def.title}</span>
        <span ref={chevronRef} className="catalog-group-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
            <path
              d="M6 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div ref={itemsRef} className="catalog-group-items" id={itemsId}>
        <ul className="catalog-list">{children}</ul>
      </div>
    </section>
  );
}

/** "Presets" item + sub-list of saved presets, refreshed from Rust on each open. */
function PresetsItem({ actions }: { actions: TerrainActions }) {
  const [presets, setPresets] = useState<PresetSummary[] | null>(null);

  function toggle(): void {
    if (presets) {
      setPresets(null);
      return;
    }
    actions
      .listPresets()
      .then(setPresets)
      .catch((err: unknown) => console.error("[terreno] falha a listar presets:", err));
  }

  return (
    <li>
      <button
        type="button"
        className={`catalog-item${presets ? " is-active" : ""}`}
        aria-label="Presets de terreno guardados (mostrar/esconder lista)"
        onClick={toggle}
      >
        Presets
      </button>
      {presets && (
        <ul className="catalog-preset-list">
          {presets.length === 0 ? (
            <li className="catalog-preset-empty">Sem presets guardados</li>
          ) : (
            presets.map((p) => (
              <li key={p.file}>
                <button
                  type="button"
                  className="catalog-item catalog-preset-item"
                  onClick={() => run(actions.loadPreset(p.file))}
                >
                  {p.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  );
}

export function LeftPanel({
  actions,
  open,
  onPresent,
}: {
  actions: TerrainActions;
  open: boolean;
  /** Fase 11: starts the presentation mode (A22). */
  onPresent: () => void;
}) {
  const store = useStore();
  const [query, setQuery] = useState("");

  function item(kind: string, label: string): ReactNode {
    if (kind === "presets") return <PresetsItem key={kind} actions={actions} />;

    // Fase 11: environment settings (right panel) and the presentation mode.
    if (kind === "environment" || kind === "presentation") {
      const active = kind === "environment" && store.environmentPanelOpen;
      return (
        <li key={kind}>
          <button
            type="button"
            className={`catalog-item${active ? " is-active" : ""}`}
            aria-pressed={kind === "environment" ? active : undefined}
            onClick={() => {
              if (kind === "presentation") return onPresent();
              store.setTool("select");
              store.select(null);
              store.setEnvironmentPanel(!active);
            }}
          >
            {label}
          </button>
        </li>
      );
    }

    if (TOOL_KINDS.has(kind)) {
      const tool = kind as ToolId;
      const active = store.tool === tool;
      return (
        <li key={kind}>
          <button
            type="button"
            className={`catalog-item${active ? " is-active" : ""}`}
            aria-pressed={active}
            onClick={() => store.setTool(active ? "select" : tool)}
          >
            {label}
          </button>
        </li>
      );
    }

    if (TERRAIN_PRESET_KINDS.has(kind)) {
      return (
        <li key={kind}>
          <button
            type="button"
            className={`catalog-item${store.terrainPreset === kind ? " is-active" : ""}`}
            onClick={() => run(actions.createFromPreset(kind as TerrainPresetId))}
          >
            {label}
          </button>
        </li>
      );
    }

    if (kind === "savePreset" || kind === "importHeightmap") {
      const action = kind === "savePreset" ? actions.saveCurrentAsPreset : actions.importHeightmap;
      return (
        <li key={kind}>
          <button type="button" className="catalog-item" onClick={() => run(action())}>
            {label}
          </button>
        </li>
      );
    }

    if (kind === CUSTOM_GLB_KIND) {
      const name = store.customGlbName;
      return (
        <li key={kind}>
          <button
            type="button"
            className={`catalog-item${name === null ? " is-disabled" : ""}`}
            draggable
            aria-disabled={name === null}
            title={
              name
                ? `Modelo importado: ${name}.glb — arrasta para o viewport.`
                : "Importa um ficheiro .glb para ativar (Importar ou Ctrl+I)."
            }
            onDragStart={(e) => {
              if (!name) {
                e.preventDefault();
                return;
              }
              startEntityDrag(e.nativeEvent, CUSTOM_GLB_KIND);
            }}
            onDragEnd={endEntityDrag}
            onClick={() => {
              if (!name) showToast("Importa primeiro um modelo .glb (Importar ou Ctrl+I).", "info");
            }}
          >
            {label}
          </button>
        </li>
      );
    }

    // Casa/Prédio/Lote (Fase 4) and network elements (Fase 6) drag & drop.
    return (
      <li key={kind}>
        <button
          type="button"
          className="catalog-item"
          draggable
          data-kind={kind}
          onDragStart={(e) => {
            if (isBuildingKind(kind) || isNetworkKind(kind)) startEntityDrag(e.nativeEvent, kind);
          }}
          onDragEnd={endEntityDrag}
        >
          {label}
        </button>
      </li>
    );
  }

  return (
    <aside
      className={`panel-left glass${open ? " open" : ""}`}
      role="complementary"
      aria-label="Catálogo de elementos"
    >
      <input
        type="search"
        className="properties-input catalog-search"
        placeholder="Pesquisar no catálogo"
        aria-label="Pesquisar no catálogo"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
      />
      {query.trim()
        ? // Fase 10: flat list of matches across groups.
          (() => {
            const q = fold(query.trim());
            const matches = CATALOG.flatMap((def) => def.items).filter((i) =>
              fold(i.label).includes(q),
            );
            return matches.length > 0 ? (
              <ul className="catalog-list catalog-results">
                {matches.map(({ kind, label }) => item(kind, label))}
              </ul>
            ) : (
              <p className="catalog-preset-empty">Sem resultados</p>
            );
          })()
        : CATALOG.map((def, index) => (
            <CatalogGroup key={def.id} def={def} initiallyOpen={index === 0}>
              {def.items.map(({ kind, label }) => item(kind, label))}
            </CatalogGroup>
          ))}
    </aside>
  );
}
