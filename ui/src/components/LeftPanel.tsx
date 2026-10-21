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
import { t, type MessageKey } from "../state/i18n";
import { kindLabel } from "../state/labels";
import { CUSTOM_GLB_KIND, isNetworkKind, type TerrainPresetId, type ToolId } from "../state/store";
import { showToast } from "../state/toasts";
import { useStore } from "../state/use-store";
import {
  endEntityDrag,
  isBuildingKind,
  placeEntityAtCenter,
  startEntityDrag,
} from "../tools/drag-drop";
import type { TerrainActions } from "../tools/terrain-actions";
import "./left-panel.css";

interface CatalogGroupDef {
  id: "terrain" | "infra" | "network" | "environment";
  /** Entity kinds use their `kind.*` label; the rest `catalog.items.<kind>`. */
  kinds: string[];
}

/** Catalog contents per DESIGN.md §5.2 (kinds are stable ids; labels follow the language). */
const CATALOG: CatalogGroupDef[] = [
  {
    id: "terrain",
    kinds: [
      "flat",
      "mountains",
      "valley",
      "custom",
      "brush",
      "savePreset",
      "presets",
      "importHeightmap",
    ],
  },
  { id: "infra", kinds: ["house", "building", "lot", CUSTOM_GLB_KIND] },
  {
    id: "network",
    kinds: [
      "antenna",
      "router",
      "switch",
      "olt",
      "onu",
      "splitter",
      "pole",
      "box",
      "cable",
      "marker",
    ],
  },
  // Fase 11 (UX.md §2).
  { id: "environment", kinds: ["environment", "paint", "vegetation", "road", "presentation"] },
];

const ENTITY_ITEMS = new Set(["house", "building", "lot", CUSTOM_GLB_KIND, "marker"]);

/** Label of a catalog item in the current language (Fase 13). */
function itemLabel(kind: string): string {
  return ENTITY_ITEMS.has(kind) || isNetworkKind(kind)
    ? kindLabel(kind)
    : t(`catalog.items.${kind}` as MessageKey);
}

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
        <span className="catalog-group-label">{t(`catalog.groups.${def.id}`)}</span>
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
        aria-label={t("catalog.presetsToggle")}
        onClick={toggle}
      >
        {t("catalog.items.presets")}
      </button>
      {presets && (
        <ul className="catalog-preset-list">
          {presets.length === 0 ? (
            <li className="catalog-preset-empty">{t("catalog.noPresets")}</li>
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

  function item(kind: string): ReactNode {
    const label = itemLabel(kind);
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
            title={name ? t("catalog.customReady", { name }) : t("catalog.customHint")}
            onDragStart={(e) => {
              if (!name) {
                e.preventDefault();
                return;
              }
              startEntityDrag(e.nativeEvent, CUSTOM_GLB_KIND);
            }}
            onDragEnd={endEntityDrag}
            onClick={() => {
              if (!name) showToast(t("catalog.customToast"), "info");
              else placeEntityAtCenter(CUSTOM_GLB_KIND); // Fase 13: click/Enter places it
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
          title={t("catalog.place")}
          onDragStart={(e) => {
            if (isBuildingKind(kind) || isNetworkKind(kind)) startEntityDrag(e.nativeEvent, kind);
          }}
          onDragEnd={endEntityDrag}
          onClick={() => {
            // Fase 13 (Q_LIST.md Q25): click or Enter places it at the center of the view.
            if (isBuildingKind(kind) || isNetworkKind(kind)) placeEntityAtCenter(kind);
          }}
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
      aria-label={t("catalog.label")}
    >
      <input
        type="search"
        className="properties-input catalog-search"
        placeholder={t("catalog.search")}
        aria-label={t("catalog.search")}
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
            const matches = CATALOG.flatMap((def) => def.kinds).filter((kind) =>
              fold(itemLabel(kind)).includes(q),
            );
            return matches.length > 0 ? (
              <ul className="catalog-list catalog-results">{matches.map(item)}</ul>
            ) : (
              <p className="catalog-preset-empty">{t("catalog.noResults")}</p>
            );
          })()
        : CATALOG.map((def, index) => (
            <CatalogGroup key={def.id} def={def} initiallyOpen={index === 0}>
              {def.kinds.map(item)}
            </CatalogGroup>
          ))}
    </aside>
  );
}
