import gsap from "gsap";

import { prefersReducedMotion } from "../anim/reduced-motion";
import { DEFAULT_FLOORS } from "../scene/buildings";
import type { CableRegistry } from "../scene/cables";
import type { EntityRegistry } from "../scene/entities";
import {
  cloneTransform,
  CUSTOM_GLB_KIND,
  isNetworkKind,
  MARKER_KIND,
  store,
  type CableRoute,
  type CableType,
  type DynamicValue,
  type TransformData,
  type Vec3Data,
} from "../state/store";
import type { TerrainActions } from "../tools/terrain-actions";
import { createSpinner, type SpinnerElement, type SpinnerOptions } from "./spinner";
import { showToast } from "./toast";
import "./right-panel.css";

const EMPTY_STATE_ICON = `
<svg class="panel-right__empty-icon" width="40" height="40" viewBox="0 0 40 40"
     fill="none" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="24" height="24" rx="4"
        stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/>
  <path d="M22 22 L34 34 M22 22 L30 21.5 M22 22 L21.5 30"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** pt-PT labels for entity kinds (Fase 4 infrastructures + Fase 5 .glb). */
const KIND_LABELS: Record<string, string> = {
  house: "Casa",
  building: "Prédio",
  lot: "Lote",
  [CUSTOM_GLB_KIND]: "Modelo personalizado",
};

/** Construction phase labels (DESIGN.md §6: fundações → estrutura → acabamento). */
const PHASE_LABELS = ["Fundações", "Estrutura", "Acabamento"];

/** Spinner bounds/steps (DESIGN.md §6: position 0.5, rotation 5°, scale 0.1). */
const SPINNER_RANGE = {
  position: { min: -500, max: 500, step: 0.5 },
  rotation: { min: -360, max: 360, step: 5 },
  scale: { min: 0.1, max: 10, step: 0.1 },
  floors: { min: 1, max: 50, step: 1 },
} as const;

const A7_HALF_DURATION = 0.125; // seconds — two 125ms fades = 250ms cross-fade (A7)

/** Empty state shown when nothing is selected (DESIGN.md §5). */
function buildEmptyState(): HTMLElement {
  const emptyState = document.createElement("div");
  emptyState.className = "panel-right__empty";
  emptyState.innerHTML = EMPTY_STATE_ICON;

  const emptyText = document.createElement("p");
  emptyText.className = "panel-right__empty-text";
  emptyText.textContent = "Seleciona um elemento";

  const emptyHint = document.createElement("p");
  emptyHint.className = "panel-right__empty-hint";
  emptyHint.textContent = "Clique num objeto do viewport para editar as suas propriedades.";

  emptyState.append(emptyText, emptyHint);
  return emptyState;
}

function buildSection(titleText: string): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement("div");
  section.className = "properties-info";

  const title = document.createElement("h3");
  title.className = "properties-section__title";
  title.textContent = titleText;

  const body = document.createElement("div");
  body.className = "properties-section__body";

  section.append(title, body);
  return { section, body };
}

/** Brush settings (PLAN.md Fase 3): radius/intensity spinners, steps of §6. */
function buildBrushSection(suppress: (fn: () => void) => void): HTMLElement {
  const { section, body } = buildSection("Pincel de terreno");

  body.append(
    createSpinner({
      label: "Raio",
      value: store.brush.radius,
      min: 1,
      max: 50,
      step: 1,
      onChange: (v) => suppress(() => store.setBrushRadius(v)),
    }),
    createSpinner({
      label: "Intensidade",
      value: store.brush.intensity,
      min: 0.1,
      max: 5,
      step: 0.1,
      onChange: (v) => suppress(() => store.setBrushIntensity(v)),
    }),
  );

  const hint = document.createElement("p");
  hint.className = "properties-section__hint";
  hint.textContent = "Botão esquerdo eleva · Shift baixa · Esc sai da ferramenta.";
  body.append(hint);

  return section;
}

/** Custom terrain params (PLAN.md Fase 3): seed/amplitude/frequency/size. */
function buildCustomSection(
  actions: TerrainActions,
  suppress: (fn: () => void) => void,
): HTMLElement {
  const { section, body } = buildSection("Terreno personalizado");
  const params = store.customParams;

  body.append(
    createSpinner({
      label: "Semente",
      value: params.seed,
      min: 0,
      max: 9999,
      step: 1,
      onChange: (v) => suppress(() => store.setCustomParams({ seed: Math.round(v) })),
    }),
    createSpinner({
      label: "Amplitude",
      value: params.amplitude,
      min: 1,
      max: 100,
      step: 1,
      onChange: (v) => suppress(() => store.setCustomParams({ amplitude: v })),
    }),
    createSpinner({
      label: "Frequência",
      value: params.frequency,
      min: 0.1,
      max: 10,
      step: 0.1,
      onChange: (v) => suppress(() => store.setCustomParams({ frequency: v })),
    }),
    createSpinner({
      label: "Tamanho",
      value: params.size,
      min: 50,
      max: 1000,
      step: 50,
      onChange: (v) => suppress(() => store.setCustomParams({ size: Math.round(v) })),
    }),
  );

  const generate = document.createElement("button");
  generate.type = "button";
  generate.className = "properties-action";
  generate.textContent = "Gerar terreno";
  generate.addEventListener("click", () => {
    void actions.createFromPreset("custom");
  });
  body.append(generate);

  return section;
}

/**
 * Segmented phase stepper (PLAN.md Fase 4): three buttons with labels
 * (Fundações / Estrutura / Acabamento); the active one is highlighted with
 * `--accent`. Hidden for lots (they ignore the phase).
 */
function buildPhaseStepper(current: number, onPhase: (phase: number) => void): HTMLElement {
  const group = document.createElement("div");
  group.className = "phase-stepper";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Fase de construção");

  const buttons: HTMLButtonElement[] = [];
  PHASE_LABELS.forEach((label, phase) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "phase-stepper__button";
    button.textContent = label;
    button.classList.toggle("phase-stepper__button--active", phase === current);
    button.setAttribute("aria-pressed", String(phase === current));
    button.addEventListener("click", () => {
      onPhase(phase);
      // The panel suppresses rebuilds for its own edits, so the active state
      // is updated here directly (a later external notify re-renders anyway).
      buttons.forEach((b, i) => {
        b.classList.toggle("phase-stepper__button--active", i === phase);
        b.setAttribute("aria-pressed", String(i === phase));
      });
    });
    buttons.push(button);
    group.appendChild(button);
  });
  return group;
}

/** Warning badge shown when the entity's footprint overlaps another (§7.1 --danger). */
function buildCollisionBadge(): HTMLElement {
  const badge = document.createElement("p");
  badge.className = "collision-badge";
  badge.setAttribute("role", "alert");
  badge.textContent = "A colidir com outra infraestrutura.";
  return badge;
}

/**
 * Entity properties editor (PLAN.md Fase 4): id/kind rows, collision badge,
 * phase stepper (except lots), floors spinner (buildings only) and X/Y/Z
 * spinners for position/rotation/scale — no textboxes; ↑/↓ with Shift×10 /
 * Alt÷10 come from the spinner component (DESIGN.md §6).
 *
 * Y-snap rule: editing the position X or Z re-snaps Y to the terrain height
 * (and syncs the Y spinner via `setValue`); the Y spinner itself sets Y
 * explicitly. All writes go store → scene (`updateEntity` + `syncTransform` /
 * `applyPhase`) and refresh the collision warnings (footprint may change).
 *
 * Panel-originated store writes run inside `suppress` so the panel is not
 * rebuilt on every tick (the focused spinner keeps focus and its A8 flash);
 * external changes (gizmo commit, duplicate, collisions) rebuild in place.
 */
function buildEntityEditor(
  registry: EntityRegistry,
  id: string,
  suppress: (fn: () => void) => void,
): HTMLElement {
  const info = store.getEntityInfo(id);
  const editor = document.createElement("div");
  editor.className = "properties-info";
  if (!info) return editor;

  const list = document.createElement("dl");
  list.className = "properties-list";
  const rows: Array<[string, string]> = [
    ["ID", id],
    ["Tipo", KIND_LABELS[info.kind] ?? info.kind],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "properties-row";
    const dt = document.createElement("dt");
    dt.className = "properties-row__label";
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.className = "properties-row__value";
    dd.textContent = value;
    row.append(dt, dd);
    list.append(row);
  }
  editor.append(list);

  if (info.colliding) editor.append(buildCollisionBadge());

  /** store → scene + collision refresh, with rebuild suppressed. */
  function writeTransform(transform: TransformData): void {
    suppress(() => store.updateEntity(id, { transform }));
    registry.syncTransform(id);
    registry.updateCollisionWarnings();
  }

  function writePhase(phase: number): void {
    suppress(() => store.updateEntity(id, { phase }));
    registry.applyPhase(id);
    registry.updateCollisionWarnings(); // footprint can change per phase
  }

  // Phase stepper — the lot ignores the phase (DESIGN.md §6) and imported
  // .glb models have no construction phases (Fase 5).
  if (info.kind !== "lot" && info.kind !== CUSTOM_GLB_KIND) {
    const { section, body } = buildSection("Fase");
    body.append(buildPhaseStepper(info.phase, writePhase));
    editor.append(section);
  }

  // Floors spinner — buildings only (procedural param, rebuilds the content).
  if (info.kind === "building") {
    const { section, body } = buildSection("Pisos");
    body.append(
      createSpinner({
        label: "Pisos",
        value: info.params.floors ?? DEFAULT_FLOORS,
        ...SPINNER_RANGE.floors,
        onChange: (v) => {
          const current = store.getEntityInfo(id);
          if (!current) return;
          suppress(() =>
            store.updateEntity(id, { params: { ...current.params, floors: Math.round(v) } }),
          );
          registry.applyPhase(id);
          registry.updateCollisionWarnings();
        },
      }),
    );
    editor.append(section);
  }

  /** Spinner tagged with a `data-prop` key (used to restore focus on refresh). */
  function vecSpinner(
    prop: string,
    axis: keyof Vec3Data,
    options: Omit<SpinnerOptions, "label" | "onChange">,
    onChange: (v: number) => void,
  ): SpinnerElement {
    const spinner = createSpinner({ label: axis.toUpperCase(), ...options, onChange });
    spinner.dataset.prop = prop;
    return spinner;
  }

  let positionY: SpinnerElement | null = null;

  const sections: Array<{
    title: string;
    field: keyof TransformData;
    range: { min: number; max: number; step: number };
  }> = [
    { title: "Posição", field: "position", range: SPINNER_RANGE.position },
    { title: "Rotação", field: "rotation", range: SPINNER_RANGE.rotation },
    { title: "Escala", field: "scale", range: SPINNER_RANGE.scale },
  ];

  for (const { title, field, range } of sections) {
    const { section, body } = buildSection(title);
    for (const axis of ["x", "y", "z"] as const) {
      const spinner = vecSpinner(
        `${field}.${axis}`,
        axis,
        {
          value: info.transform[field][axis],
          ...range,
        },
        (v) => {
          const current = store.getEntityInfo(id);
          if (!current) return;
          const transform = cloneTransform(current.transform);
          transform[field][axis] = v;
          if (field === "position" && axis !== "y") {
            // Y-snap rule: an X/Z edit re-pins Y to the terrain relief.
            transform.position.y = registry.snapY(transform.position.x, transform.position.z);
            positionY?.setValue(transform.position.y);
          }
          writeTransform(transform);
        },
      );
      if (field === "position" && axis === "y") positionY = spinner;
      body.append(spinner);
    }
    editor.append(section);
  }

  const hint = document.createElement("p");
  hint.className = "properties-section__hint";
  hint.textContent =
    "Gizmo: W mover · E rodar · T escalar. Editar X/Z volta a assentar no terreno.";
  editor.append(hint);

  return editor;
}

/**
 * A7 (GSAP): cross-fade between panel contents on each selection change —
 * fade the current content out, swap, fade the new one in (250ms total,
 * power2.inOut). With reduced motion the swap is instant (DESIGN.md §8.3).
 */
function swapContent(container: HTMLElement, next: HTMLElement): void {
  const current = container.firstElementChild;
  if (!(current instanceof HTMLElement) || prefersReducedMotion()) {
    container.replaceChildren(next);
    return;
  }

  gsap.killTweensOf(current);
  gsap.to(current, {
    opacity: 0,
    duration: A7_HALF_DURATION,
    ease: "power2.inOut",
    onComplete: () => {
      container.replaceChildren(next);
      gsap.fromTo(
        next,
        { opacity: 0 },
        { opacity: 1, duration: A7_HALF_DURATION, ease: "power2.inOut" },
      );
    },
  });
}

/**
 * Builds the right-hand properties panel (DESIGN.md §5).
 *
 * Content priority: brush settings while the brush tool is active; otherwise
 * the selected entity editor (Fase 4: phase stepper, X/Y/Z spinners, floors,
 * collision badge); otherwise the custom-terrain params when that preset is
 * active; otherwise the empty state.
 *
 * Re-render strategy: the A7 cross-fade plays only when the content kind
 * changes (signature: brush / entity:<id> / custom / empty); store changes
 * with the same signature refresh in place (gizmo commits, collision flags),
 * restoring focus to the spinner being edited. Writes originated in the
 * panel's own spinners/stepper are suppressed (the spinner renders itself),
 * which keeps keyboard ↑/↓ adjustments and the A8 flash working.
 */
export function createRightPanel(actions: TerrainActions, registry: EntityRegistry): HTMLElement {
  const panel = document.createElement("aside");
  panel.className = "panel-right glass";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Propriedades");

  const header = document.createElement("header");
  header.className = "panel-right__header";

  const title = document.createElement("h2");
  title.className = "panel-right__title";
  title.textContent = "Propriedades";
  header.appendChild(title);

  const content = document.createElement("div");
  content.className = "properties-content";
  content.appendChild(buildEmptyState());

  /** True while a panel-originated store write is notifying (see above). */
  let suppressing = false;
  const suppress = (fn: () => void): void => {
    suppressing = true;
    try {
      fn();
    } finally {
      suppressing = false;
    }
  };

  let signature = "empty";

  function computeNext(): { nextSignature: string; node: HTMLElement } {
    if (store.tool === "brush") {
      return { nextSignature: "brush", node: buildBrushSection(suppress) };
    }
    const selected = store.selected;
    if (selected && store.getEntityInfo(selected)) {
      return {
        nextSignature: `entity:${selected}`,
        node: buildEntityEditor(registry, selected, suppress),
      };
    }
    if (store.terrainPreset === "custom") {
      return { nextSignature: "custom", node: buildCustomSection(actions, suppress) };
    }
    return { nextSignature: "empty", node: buildEmptyState() };
  }

  store.subscribe(() => {
    if (suppressing) return; // own spinner/stepper edit — nothing to refresh
    const { nextSignature, node } = computeNext();
    if (nextSignature !== signature) {
      signature = nextSignature;
      swapContent(content, node); // A7 cross-fade on selection/content change
      return;
    }
    // Same content kind: refresh in place, keeping focus on the edited spinner.
    const focused = document.activeElement?.closest(".spinner")?.getAttribute("data-prop");
    content.replaceChildren(node);
    if (focused) {
      const el = content.querySelector(`.spinner[data-prop="${focused}"] .spinner__value`);
      if (el instanceof HTMLElement) el.focus();
    }
  });

  panel.append(header, content);

  return panel;
}
