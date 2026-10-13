/**
 * Right properties panel (DESIGN.md §5).
 *
 * Content priority: brush settings while the brush tool is active; otherwise
 * the selected entity editor (Fase 4: phase stepper, X/Y/Z spinners, floors,
 * collision badge); otherwise the custom-terrain params when that preset is
 * active; otherwise the empty state.
 *
 * A7 cross-fade plays only when the content kind changes (signature: brush /
 * entity:<id> / custom / empty); other store changes just re-render, and the
 * spinners keep their DOM nodes, so focus and ↑/↓ editing survive.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { a7In, a7Out } from "../anim/ui";
import { DEFAULT_FLOORS } from "../scene/buildings";
import type { EntityRegistry } from "../scene/entities";
import { cloneTransform, CUSTOM_GLB_KIND, type TransformData } from "../state/store";
import { useStore } from "../state/use-store";
import type { TerrainActions } from "../tools/terrain-actions";
import { Spinner } from "./Spinner";
import "./right-panel.css";

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
const TRANSFORM_SECTIONS: Array<{
  title: string;
  field: keyof TransformData;
  min: number;
  max: number;
  step: number;
}> = [
  { title: "Posição", field: "position", min: -500, max: 500, step: 0.5 },
  { title: "Rotação", field: "rotation", min: -360, max: 360, step: 5 },
  { title: "Escala", field: "scale", min: 0.1, max: 10, step: 0.1 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="properties-info">
      <h3 className="properties-section__title">{title}</h3>
      <div className="properties-section__body">{children}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="panel-right__empty">
      <svg
        className="panel-right__empty-icon"
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x="4"
          y="4"
          width="24"
          height="24"
          rx="4"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
        <path
          d="M22 22 L34 34 M22 22 L30 21.5 M22 22 L21.5 30"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="panel-right__empty-text">Seleciona um elemento</p>
      <p className="panel-right__empty-hint">
        Clique num objeto do viewport para editar as suas propriedades.
      </p>
    </div>
  );
}

/** Brush settings (Fase 3): radius/intensity spinners, steps of §6. */
function BrushSection() {
  const store = useStore();
  return (
    <Section title="Pincel de terreno">
      <Spinner
        label="Raio"
        value={store.brush.radius}
        min={1}
        max={50}
        step={1}
        onChange={store.setBrushRadius}
      />
      <Spinner
        label="Intensidade"
        value={store.brush.intensity}
        min={0.1}
        max={5}
        step={0.1}
        onChange={store.setBrushIntensity}
      />
      <p className="properties-section__hint">
        Botão esquerdo eleva · Shift baixa · Esc sai da ferramenta.
      </p>
    </Section>
  );
}

/** Custom terrain params (Fase 3): seed/amplitude/frequency/size. */
function CustomSection({ actions }: { actions: TerrainActions }) {
  const store = useStore();
  const p = store.customParams;
  return (
    <Section title="Terreno personalizado">
      <Spinner
        label="Semente"
        value={p.seed}
        min={0}
        max={9999}
        step={1}
        onChange={(v) => store.setCustomParams({ seed: Math.round(v) })}
      />
      <Spinner
        label="Amplitude"
        value={p.amplitude}
        min={1}
        max={100}
        step={1}
        onChange={(v) => store.setCustomParams({ amplitude: v })}
      />
      <Spinner
        label="Frequência"
        value={p.frequency}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(v) => store.setCustomParams({ frequency: v })}
      />
      <Spinner
        label="Tamanho"
        value={p.size}
        min={50}
        max={1000}
        step={50}
        onChange={(v) => store.setCustomParams({ size: Math.round(v) })}
      />
      <button
        type="button"
        className="properties-action"
        onClick={() => void actions.createFromPreset("custom")}
      >
        Gerar terreno
      </button>
    </Section>
  );
}

/**
 * Entity editor (Fase 4). Writes go store → scene (`updateEntity` +
 * `syncTransform` / `applyPhase`) and refresh the collision warnings.
 * Y-snap rule: editing position X or Z re-pins Y to the terrain height.
 */
function EntityEditor({ registry, id }: { registry: EntityRegistry; id: string }) {
  const store = useStore();
  const info = store.getEntityInfo(id);
  if (!info) return null;

  function writeTransform(transform: TransformData): void {
    store.updateEntity(id, { transform });
    registry.syncTransform(id);
    registry.updateCollisionWarnings();
  }

  function writePhase(phase: number): void {
    store.updateEntity(id, { phase });
    registry.applyPhase(id);
    registry.updateCollisionWarnings(); // footprint can change per phase
  }

  function writeFloors(floors: number): void {
    const current = store.getEntityInfo(id);
    if (!current) return;
    store.updateEntity(id, { params: { ...current.params, floors } });
    registry.applyPhase(id);
    registry.updateCollisionWarnings();
  }

  return (
    <div className="properties-info">
      <dl className="properties-list">
        {[
          ["ID", id],
          ["Tipo", KIND_LABELS[info.kind] ?? info.kind],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>

      {info.colliding && (
        <p className="collision-badge" role="alert">
          A colidir com outra infraestrutura.
        </p>
      )}

      {/* Lots ignore the phase (§6); imported .glb models have none (Fase 5). */}
      {info.kind !== "lot" && info.kind !== CUSTOM_GLB_KIND && (
        <Section title="Fase">
          <div className="phase-stepper" role="group" aria-label="Fase de construção">
            {PHASE_LABELS.map((label, phase) => (
              <button
                key={label}
                type="button"
                className={`phase-stepper__button${phase === info.phase ? " phase-stepper__button--active" : ""}`}
                aria-pressed={phase === info.phase}
                onClick={() => writePhase(phase)}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {info.kind === "building" && (
        <Section title="Pisos">
          <Spinner
            label="Pisos"
            value={info.params.floors ?? DEFAULT_FLOORS}
            min={1}
            max={50}
            step={1}
            onChange={(v) => writeFloors(Math.round(v))}
          />
        </Section>
      )}

      {TRANSFORM_SECTIONS.map(({ title, field, min, max, step }) => (
        <Section key={field} title={title}>
          {(["x", "y", "z"] as const).map((axis) => (
            <Spinner
              key={axis}
              label={axis.toUpperCase()}
              value={info.transform[field][axis]}
              min={min}
              max={max}
              step={step}
              onChange={(v) => {
                const transform = cloneTransform(info.transform);
                transform[field][axis] = v;
                if (field === "position" && axis !== "y") {
                  transform.position.y = registry.snapY(transform.position.x, transform.position.z);
                }
                writeTransform(transform);
              }}
            />
          ))}
        </Section>
      ))}

      <p className="properties-section__hint">
        Gizmo: W mover · E rodar · T escalar. Editar X/Z volta a assentar no terreno.
      </p>
    </div>
  );
}

export function RightPanel({
  actions,
  registry,
  open,
}: {
  actions: TerrainActions;
  registry: EntityRegistry;
  open: boolean;
}) {
  const store = useStore();

  const selected = store.selected;
  const signature =
    store.tool === "brush"
      ? "brush"
      : selected && store.getEntityInfo(selected)
        ? `entity:${selected}`
        : store.terrainPreset === "custom"
          ? "custom"
          : "empty";

  // `shown` lags `signature` by the A7 fade-out, then the new content fades in.
  const [shown, setShown] = useState(signature);
  const contentRef = useRef<HTMLDivElement>(null);
  const swapped = useRef(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (swapped.current) {
      swapped.current = false;
      a7In(el);
    }
    if (signature === shown) return;
    return a7Out(el, () => {
      swapped.current = true;
      setShown(signature);
    });
  }, [signature, shown]);

  let content: ReactNode;
  if (shown === "brush") content = <BrushSection />;
  else if (shown === "custom") content = <CustomSection actions={actions} />;
  else if (shown.startsWith("entity:"))
    content = <EntityEditor key={shown} registry={registry} id={shown.slice("entity:".length)} />;
  else content = <EmptyState />;

  return (
    <aside
      className={`panel-right glass${open ? " open" : ""}`}
      role="complementary"
      aria-label="Propriedades"
    >
      <header className="panel-right__header">
        <h2 className="panel-right__title">Propriedades</h2>
      </header>
      <div ref={contentRef} className="properties-content">
        {content}
      </div>
    </aside>
  );
}
