/**
 * Right properties panel (DESIGN.md §5).
 *
 * Content priority: brush settings while the brush tool is active; cable
 * type/route pickers while the cable tool is active and a hint while the
 * marker tool is active (Fase 6); otherwise the selected entity editor
 * (Fase 4: phase stepper, X/Y/Z spinners, floors, collision badge; Fase 6:
 * marker label/note, dynamic props of network elements) or the selected
 * cable editor (Fase 6: endpoints, type, route, length, dynamic props) —
 * both with the Fase 7 "Simulação" section (origin/destination, simulated
 * failure, antenna coverage);
 * otherwise the custom-terrain params when that preset is active; otherwise
 * the empty state.
 *
 * A7 cross-fade plays only when the content kind changes (signature: brush /
 * cableTool / markerTool / entity:<id> / cable:<id> / custom / empty); other
 * store changes just re-render, and the spinners keep their DOM nodes, so
 * focus and ↑/↓ editing survive.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { a7In, a7Out } from "../anim/ui";
import { DEFAULT_FLOORS } from "../scene/buildings";
import type { CableRegistry } from "../scene/cables";
import type { EntityRegistry } from "../scene/entities";
import type { RoadRegistry } from "../scene/roads";
import { deleteSelection } from "../scene/shortcuts";
import {
  cloneTransform,
  CUSTOM_GLB_KIND,
  isNetworkKind,
  MARKER_KIND,
  type CableRoute,
  type CableType,
  type MaterialId,
  type PlantKind,
  type SnapGrid,
  type TransformData,
} from "../state/store";
import { KIND_LABELS } from "../state/labels";
import { useStore } from "../state/use-store";
import { arrangeSelection, type ArrangeAxis, type ArrangeMode } from "../tools/arrange";
import type { SimulationActions } from "../tools/simulation";
import type { TerrainActions } from "../tools/terrain-actions";
import { DynamicPropsEditor } from "./DynamicPropsEditor";
import { SegmentedPicker } from "./SegmentedPicker";
import { Spinner } from "./Spinner";
import "./right-panel.css";

/** pt-PT labels for cable types and routes (Fase 6, DESIGN.md §4.1). */
const CABLE_TYPE_LABELS: Record<CableType, string> = {
  fiber: "Fibra",
  copper: "Cobre",
  coax: "Coaxial",
};
const CABLE_ROUTE_LABELS: Record<CableRoute, string> = {
  underground: "Subterrâneo",
  aerial: "Aéreo",
  direct: "Direto",
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

/**
 * Simulator controls of a node or cable (Fase 7, UX.md §2): origin/destination
 * toggles (nodes only), simulated failure, antenna coverage.
 */
function SimulationSection({
  id,
  simulation,
  isCable,
}: {
  id: string;
  simulation: SimulationActions;
  isCable: boolean;
}) {
  const store = useStore();
  const sim = store.simulation;
  const failed = sim.failed.has(id);
  const isAntenna = store.getEntityInfo(id)?.kind === "antenna";
  const toggleClass = (active: boolean, danger = false) =>
    `phase-stepper__button${active ? (danger ? " phase-stepper__button--danger" : " phase-stepper__button--active") : ""}`;

  return (
    <Section title="Simulação">
      <div className="phase-stepper" role="group" aria-label="Simulação">
        {!isCable &&
          (["from", "to"] as const).map((role) => {
            const active = (role === "from" ? sim.fromId : sim.toId) === id;
            return (
              <button
                key={role}
                type="button"
                className={toggleClass(active)}
                aria-pressed={active}
                onClick={() => store.setSimEndpoint(role, active ? null : id)}
              >
                {role === "from" ? "Origem" : "Destino"}
              </button>
            );
          })}
        <button
          type="button"
          className={toggleClass(failed, true)}
          aria-pressed={failed}
          onClick={() => simulation.toggleFailure(id)}
        >
          Em falha
        </button>
      </div>
      {isAntenna && (
        <button
          type="button"
          className="properties-action"
          onClick={() => void simulation.coverage(id)}
        >
          Simular cobertura
        </button>
      )}
      <p className="properties-section__hint">
        {isCable
          ? "Um cabo em falha é ignorado pelo Dijkstra; a rota é recalculada."
          : "Escolhe origem e destino e calcula o caminho no simulador."}
      </p>
    </Section>
  );
}

const SNAP_LABELS: Record<string, string> = {
  "0": "Desligado",
  "0.25": "0,25 m",
  "0.5": "0,5 m",
  "1": "1 m",
};

/** Snap settings (Fase 10, Q_LIST.md Q15): gizmo, drag & drop and paste. */
function SnapSection() {
  const store = useStore();
  return (
    <Section title="Snap">
      <SegmentedPicker
        label="Grelha"
        options={SNAP_LABELS}
        value={String(store.snap.grid)}
        onChange={(v) => store.setSnap({ grid: Number(v) as SnapGrid })}
      />
      <div className="phase-stepper" role="group" aria-label="Snap a objetos">
        <button
          type="button"
          className={`phase-stepper__button${store.snap.objects ? " phase-stepper__button--active" : ""}`}
          aria-pressed={store.snap.objects}
          onClick={() => store.setSnap({ objects: !store.snap.objects })}
        >
          Snap a objetos
        </button>
      </div>
    </Section>
  );
}

const ARRANGE_ROWS: Array<{ axis: ArrangeAxis; buttons: Array<[ArrangeMode, string]> }> = [
  {
    axis: "x",
    buttons: [
      ["min", "Esquerda"],
      ["center", "Centro"],
      ["distribute", "Distribuir"],
    ],
  },
  {
    axis: "z",
    buttons: [
      ["min", "Frente"],
      ["center", "Centro"],
      ["distribute", "Distribuir"],
    ],
  },
];

/**
 * Multi-selection (Fase 10, UX.md §2): count per kind, align/distribute along
 * X or Z, snap and «Eliminar seleção».
 */
function MultiSelectionPanel({
  registry,
  cables,
  roads,
}: {
  registry: EntityRegistry;
  cables: CableRegistry;
  roads: RoadRegistry;
}) {
  const store = useStore();
  const counts = new Map<string, number>();
  for (const id of store.selection) {
    const kind = store.getEntityInfo(id)?.kind;
    const label = kind ? (KIND_LABELS[kind] ?? kind) : "Cabo";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    <div className="properties-info">
      <dl className="properties-list">
        <div className="properties-row">
          <dt className="properties-row__label">Seleção</dt>
          <dd className="properties-row__value">{store.selection.length} elementos</dd>
        </div>
        {[...counts].map(([label, n]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{n}</dd>
          </div>
        ))}
      </dl>

      <Section title="Alinhar e distribuir">
        {ARRANGE_ROWS.map(({ axis, buttons }) => (
          <div key={axis} className="segmented-picker">
            <span className="segmented-picker__label">Eixo {axis.toUpperCase()}</span>
            <div
              className="phase-stepper"
              role="group"
              aria-label={`Alinhar em ${axis.toUpperCase()}`}
            >
              {buttons.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className="phase-stepper__button"
                  onClick={() => arrangeSelection(registry, axis, mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <SnapSection />

      <button
        type="button"
        className="properties-action properties-action--danger"
        onClick={() => deleteSelection(registry, cables, roads)}
      >
        Eliminar seleção
      </button>
      <p className="properties-section__hint">
        Shift+clique junta ou tira · Shift+arrastar seleciona por área · o gizmo move o lote.
      </p>
    </div>
  );
}

// ---- Fase 11: environment, material brush, vegetation, roads ----

const MATERIAL_LABELS: Record<string, string> = {
  "0": "Auto",
  "1": "Relva",
  "2": "Terra",
  "3": "Areia",
  "4": "Rocha",
  "5": "Neve",
};
const PLANT_LABELS: Record<PlantKind, string> = { tree: "Árvores", bush: "Arbustos" };

/** "13.5" → "13:30". */
function clock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Hour (slider + spinner, Q_LIST.md Q17), fog and water (UX.md §2). */
function EnvironmentSection() {
  const store = useStore();
  const env = store.environment;
  return (
    <div className="properties-info">
      <Section title={`Hora do dia — ${clock(env.hour)}`}>
        <input
          type="range"
          className="properties-range"
          min={0}
          max={24}
          step={0.25}
          value={env.hour}
          aria-label="Hora do dia"
          onChange={(e) => store.setEnvironment({ hour: Number(e.target.value) })}
        />
        <Spinner
          label="Hora"
          value={env.hour}
          min={0}
          max={24}
          step={0.5}
          onChange={(hour) => store.setEnvironment({ hour })}
        />
      </Section>
      <Section title="Céu e névoa">
        <Spinner
          label="Névoa"
          value={env.fog}
          min={0}
          max={1}
          step={0.05}
          onChange={(fog) => store.setEnvironment({ fog })}
        />
      </Section>
      <Section title="Água">
        <div className="phase-stepper" role="group" aria-label="Água">
          <button
            type="button"
            className={`phase-stepper__button${env.water.enabled ? " phase-stepper__button--active" : ""}`}
            aria-pressed={env.water.enabled}
            onClick={() =>
              store.setEnvironment({ water: { ...env.water, enabled: !env.water.enabled } })
            }
          >
            {env.water.enabled ? "Água ligada" : "Água desligada"}
          </button>
        </div>
        <Spinner
          label="Nível (m)"
          value={env.water.level}
          min={-50}
          max={100}
          step={0.5}
          onChange={(level) => store.setEnvironment({ water: { ...env.water, level } })}
        />
      </Section>
      <p className="properties-section__hint">
        A hora muda o sol, o céu e as sombras (A18). Guardado com o projeto, fora do desfazer.
      </p>
    </div>
  );
}

/** Material brush (Fase 11): material + radius. */
function PaintToolSection() {
  const store = useStore();
  return (
    <Section title="Pincel de materiais">
      <SegmentedPicker
        label="Material"
        options={MATERIAL_LABELS}
        value={String(store.paintTool.material)}
        onChange={(v) => store.setPaintMaterial(Number(v) as MaterialId)}
      />
      <Spinner
        label="Raio"
        value={store.brush.radius}
        min={1}
        max={50}
        step={1}
        onChange={store.setBrushRadius}
      />
      <p className="properties-section__hint">
        Arrastar pinta · «Auto» repõe o gradiente de altitude · Esc sai.
      </p>
    </Section>
  );
}

/** Vegetation brush (Fase 11): species, density (per 100 m²) and radius. */
function VegetationToolSection() {
  const store = useStore();
  return (
    <Section title="Vegetação">
      <SegmentedPicker
        label="Espécie"
        options={PLANT_LABELS}
        value={store.vegetationTool.kind}
        onChange={(kind) => store.setVegetationTool({ kind })}
      />
      <Spinner
        label="Densidade (por 100 m²)"
        value={Math.round(store.vegetationTool.density * 100)}
        min={1}
        max={50}
        step={1}
        onChange={(v) => store.setVegetationTool({ density: v / 100 })}
      />
      <Spinner
        label="Raio"
        value={store.brush.radius}
        min={1}
        max={50}
        step={1}
        onChange={store.setBrushRadius}
      />
      <p className="properties-section__hint">
        Arrastar planta até à densidade · Shift apaga · Esc sai.
      </p>
    </Section>
  );
}

/** Road tool (Fase 11): width of the next road. */
function RoadToolSection() {
  const store = useStore();
  return (
    <Section title="Ferramenta estrada">
      <Spinner
        label="Largura (m)"
        value={store.roadTool.width}
        min={1}
        max={20}
        step={0.5}
        onChange={store.setRoadWidth}
      />
      <p className="properties-section__hint">
        Clique no terreno para cada ponto · Enter ou duplo clique termina · Backspace tira o último
        · Esc cancela.
      </p>
    </Section>
  );
}

/** Selected road (Fase 11): points, length and width. */
function RoadEditor({ roads, id }: { roads: RoadRegistry; id: string }) {
  const store = useStore();
  const info = store.getRoadInfo(id);
  if (!info) return null;
  return (
    <div className="properties-info">
      <dl className="properties-list">
        {[
          ["ID", id],
          ["Tipo", "Estrada"],
          ["Pontos", String(info.points.length)],
          ["Comprimento", `${roads.getLength(id).toFixed(1)} m`],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>
      <Section title="Largura">
        <Spinner
          label="Largura (m)"
          value={info.width}
          min={1}
          max={20}
          step={0.5}
          onChange={(width) => {
            store.updateRoad(id, { width });
            roads.rebuild(id);
          }}
        />
      </Section>
      <p className="properties-section__hint">Delete elimina a estrada selecionada.</p>
    </div>
  );
}

/** Cable tool settings (Fase 6): type and route of the next cable. */
function CableToolSection() {
  const store = useStore();
  return (
    <Section title="Ferramenta cabo">
      <SegmentedPicker
        label="Tipo"
        options={CABLE_TYPE_LABELS}
        value={store.cableTool.cableType}
        onChange={store.setCableType}
      />
      <SegmentedPicker
        label="Percurso"
        options={CABLE_ROUTE_LABELS}
        value={store.cableTool.route}
        onChange={store.setCableRoute}
      />
      <p className="properties-section__hint">
        Clique no elemento de origem e depois no destino. Esc cancela.
      </p>
    </Section>
  );
}

/** Ruler (Fase 12, UX.md §2): distances of the measurement + terrain profile. */
function RulerSection() {
  const store = useStore();
  const { from, to } = store.ruler;
  const rows =
    from && to
      ? [
          [
            "Distância 3D",
            `${Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z).toFixed(2)} m`,
          ],
          ["Horizontal", `${Math.hypot(to.x - from.x, to.z - from.z).toFixed(2)} m`],
          ["Desnível", `${to.y >= from.y ? "+" : ""}${(to.y - from.y).toFixed(2)} m`],
        ]
      : [];
  return (
    <Section title="Régua">
      {rows.length > 0 && (
        <dl className="properties-list">
          {rows.map(([label, value]) => (
            <div key={label} className="properties-row">
              <dt className="properties-row__label">{label}</dt>
              <dd className="properties-row__value">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        className="properties-action"
        disabled={!to}
        onClick={() => store.openModal("profile")}
      >
        Perfil do terreno
      </button>
      <p className="properties-section__hint">
        {!from
          ? "Clique no terreno para o 1.º ponto. R ou Esc sai."
          : !to
            ? "Clique no 2.º ponto — a etiqueta mostra a distância até ao cursor."
            : "Clique de novo para outra medida · R ou Esc sai."}
      </p>
    </Section>
  );
}

/** Marker tool hint (Fase 6): the tool has no settings. */
function MarkerToolSection() {
  return (
    <Section title="Ferramenta marcador">
      <p className="properties-section__hint">
        Clique no terreno ou num elemento para colocar um pin com etiqueta. Esc cancela.
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
function EntityEditor({
  registry,
  simulation,
  id,
}: {
  registry: EntityRegistry;
  simulation: SimulationActions;
  id: string;
}) {
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

  // Fase 6 (markers): the label rebuilds the 3D sprite; the note is data only.
  function writeLabel(label: string): void {
    store.updateEntity(id, { label });
    registry.applyPhase(id);
  }

  function writeNote(note: string): void {
    store.updateEntity(id, { note });
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

      {/* Lots ignore the phase (§6); imported .glb models and markers have none (Fases 5–6). */}
      {info.kind !== "lot" && info.kind !== CUSTOM_GLB_KIND && info.kind !== MARKER_KIND && (
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

      {/* Fase 6: marker pins carry a label (3D sprite) and a note. */}
      {info.kind === MARKER_KIND && (
        <Section title="Marcador">
          <label className="properties-field">
            <span className="properties-field__label">Etiqueta</span>
            <input
              type="text"
              className="properties-input"
              value={info.label ?? ""}
              maxLength={48}
              onChange={(e) => writeLabel(e.target.value)}
            />
          </label>
          <label className="properties-field">
            <span className="properties-field__label">Nota</span>
            <input
              type="text"
              className="properties-input"
              value={info.note ?? ""}
              maxLength={200}
              onChange={(e) => writeNote(e.target.value)}
            />
          </label>
          {info.targetId && (
            <p className="properties-section__hint">Colocado em: {info.targetId}</p>
          )}
        </Section>
      )}

      {/* Fase 6: dynamic key-value props of network elements (DESIGN.md §4.2). */}
      {isNetworkKind(info.kind) && (
        <Section title="Propriedades dinâmicas">
          <DynamicPropsEditor
            props={info.dynamicProps}
            onChange={(dynamicProps) => store.updateEntity(id, { dynamicProps })}
          />
        </Section>
      )}

      {/* Fase 7: network elements (and anything wired by a cable) are graph nodes. */}
      {(isNetworkKind(info.kind) || store.cablesOf(id).length > 0) && (
        <SimulationSection id={id} simulation={simulation} isCable={false} />
      )}

      <SnapSection />

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

/**
 * Cable editor (Fase 6): id, endpoints and world length, type/route pickers
 * (the mesh is rebuilt so the color/path follow) and dynamic props
 * (DESIGN.md §4.2: bandwidth, attenuation, costPerMeter…).
 */
function CableEditor({
  cables,
  simulation,
  id,
}: {
  cables: CableRegistry;
  simulation: SimulationActions;
  id: string;
}) {
  const store = useStore();
  const info = store.getCableInfo(id);
  if (!info) return null;

  const length = cables.getLength(id);

  function writeType(cableType: CableType): void {
    store.updateCable(id, { cableType });
    cables.rebuildMesh(id); // color follows the type
  }

  function writeRoute(route: CableRoute): void {
    store.updateCable(id, { route });
    cables.rebuildMesh(id); // path follows the route
  }

  return (
    <div className="properties-info">
      <dl className="properties-list">
        {[
          ["ID", id],
          ["Tipo", "Cabo"],
          ["Ligação", `${info.fromId} → ${info.toId}`],
          ["Comprimento", length === undefined ? "—" : `${length.toFixed(1)} m`],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Tipo de cabo">
        <SegmentedPicker
          label="Tipo de cabo"
          options={CABLE_TYPE_LABELS}
          value={info.cableType}
          onChange={writeType}
        />
      </Section>

      <Section title="Percurso">
        <SegmentedPicker
          label="Percurso"
          options={CABLE_ROUTE_LABELS}
          value={info.route}
          onChange={writeRoute}
        />
      </Section>

      <Section title="Propriedades dinâmicas">
        <DynamicPropsEditor
          props={info.dynamicProps}
          onChange={(dynamicProps) => store.updateCable(id, { dynamicProps })}
        />
      </Section>

      <SimulationSection id={id} simulation={simulation} isCable />

      <p className="properties-section__hint">Delete elimina o cabo selecionado.</p>
    </div>
  );
}

export function RightPanel({
  actions,
  registry,
  cables,
  roads,
  simulation,
  open,
}: {
  actions: TerrainActions;
  registry: EntityRegistry;
  cables: CableRegistry;
  roads: RoadRegistry;
  simulation: SimulationActions;
  open: boolean;
}) {
  const store = useStore();

  const selected = store.selected;
  const signature =
    store.tool === "brush"
      ? "brush"
      : store.tool === "paint"
        ? "paintTool"
        : store.tool === "vegetation"
          ? "vegetationTool"
          : store.tool === "road"
            ? "roadTool"
            : store.tool === "cable"
              ? "cableTool"
              : store.tool === "marker"
                ? "markerTool"
                : store.tool === "ruler"
                  ? "rulerTool"
                  : store.selection.length > 1
                    ? "multi"
                    : selected && store.getEntityInfo(selected)
                      ? `entity:${selected}`
                      : selected && store.getCableInfo(selected)
                        ? `cable:${selected}`
                        : selected && store.getRoadInfo(selected)
                          ? `road:${selected}`
                          : store.environmentPanelOpen
                            ? "environment"
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
  else if (shown === "cableTool") content = <CableToolSection />;
  else if (shown === "markerTool") content = <MarkerToolSection />;
  else if (shown === "rulerTool") content = <RulerSection />;
  else if (shown === "custom") content = <CustomSection actions={actions} />;
  else if (shown === "multi")
    content = <MultiSelectionPanel registry={registry} cables={cables} roads={roads} />;
  else if (shown === "paintTool") content = <PaintToolSection />;
  else if (shown === "vegetationTool") content = <VegetationToolSection />;
  else if (shown === "roadTool") content = <RoadToolSection />;
  else if (shown === "environment") content = <EnvironmentSection />;
  else if (shown.startsWith("road:"))
    content = <RoadEditor key={shown} roads={roads} id={shown.slice("road:".length)} />;
  else if (shown.startsWith("entity:"))
    content = (
      <EntityEditor
        key={shown}
        registry={registry}
        simulation={simulation}
        id={shown.slice("entity:".length)}
      />
    );
  else if (shown.startsWith("cable:"))
    content = (
      <CableEditor
        key={shown}
        cables={cables}
        simulation={simulation}
        id={shown.slice("cable:".length)}
      />
    );
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
