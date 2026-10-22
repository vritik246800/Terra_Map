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
import { fmt, t, type MessageKey } from "../state/i18n";
import { kindLabel } from "../state/labels";
import { useStore } from "../state/use-store";
import { arrangeSelection, type ArrangeAxis, type ArrangeMode } from "../tools/arrange";
import type { SimulationActions } from "../tools/simulation";
import type { TerrainActions } from "../tools/terrain-actions";
import { DynamicPropsEditor } from "./DynamicPropsEditor";
import { SegmentedPicker } from "./SegmentedPicker";
import { Spinner } from "./Spinner";
import "./right-panel.css";

/** Labels of cable types and routes (Fase 6), in the current language (Fase 13). */
const cableTypeLabels = (): Record<CableType, string> => ({
  fiber: t("cable.fiber"),
  copper: t("cable.copper"),
  coax: t("cable.coax"),
});
const cableRouteLabels = (): Record<CableRoute, string> => ({
  underground: t("cable.underground"),
  aerial: t("cable.aerial"),
  direct: t("cable.direct"),
});

/** Construction phases (DESIGN.md §6: fundações → estrutura → acabamento). */
const PHASE_KEYS: MessageKey[] = [
  "panel.entity.foundations",
  "panel.entity.structure",
  "panel.entity.finish",
];

/** `12.3` → "12.3 m". */
const meters = (v: number, decimals = 1) => `${fmt(v, decimals)} m`;

/** Spinner bounds/steps (DESIGN.md §6: position 0.5, rotation 5°, scale 0.1). */
const TRANSFORM_SECTIONS: Array<{
  title: MessageKey;
  field: keyof TransformData;
  min: number;
  max: number;
  step: number;
}> = [
  { title: "panel.entity.position", field: "position", min: -500, max: 500, step: 0.5 },
  { title: "panel.entity.rotation", field: "rotation", min: -360, max: 360, step: 5 },
  { title: "panel.entity.scale", field: "scale", min: 0.1, max: 10, step: 0.1 },
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
      <p className="panel-right__empty-text">{t("panel.empty")}</p>
      <p className="panel-right__empty-hint">{t("panel.emptyHint")}</p>
    </div>
  );
}

/** Brush settings (Fase 3): radius/intensity spinners, steps of §6. */
function BrushSection() {
  const store = useStore();
  return (
    <Section title={t("panel.brush.title")}>
      <Spinner
        label={t("panel.brush.radius")}
        value={store.brush.radius}
        min={1}
        max={50}
        step={1}
        onChange={store.setBrushRadius}
      />
      <Spinner
        label={t("panel.brush.intensity")}
        value={store.brush.intensity}
        min={0.1}
        max={5}
        step={0.1}
        onChange={store.setBrushIntensity}
      />
      <p className="properties-section__hint">{t("panel.brush.hint")}</p>
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
    <Section title={t("panel.sim.title")}>
      <div className="phase-stepper" role="group" aria-label={t("panel.sim.title")}>
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
                {t(role === "from" ? "panel.sim.from" : "panel.sim.to")}
              </button>
            );
          })}
        <button
          type="button"
          className={toggleClass(failed, true)}
          aria-pressed={failed}
          onClick={() => simulation.toggleFailure(id)}
        >
          {t("panel.sim.failed")}
        </button>
      </div>
      {isAntenna && (
        <button
          type="button"
          className="properties-action"
          onClick={() => void simulation.coverage(id)}
        >
          {t("panel.sim.coverage")}
        </button>
      )}
      <p className="properties-section__hint">
        {t(isCable ? "panel.sim.hintCable" : "panel.sim.hintNode")}
      </p>
    </Section>
  );
}

const snapLabels = (): Record<string, string> => ({
  "0": t("panel.snap.off"),
  "0.25": meters(0.25, 2),
  "0.5": meters(0.5),
  "1": meters(1, 0),
});

/** Snap settings (Fase 10, Q_LIST.md Q15): gizmo, drag & drop and paste. */
function SnapSection() {
  const store = useStore();
  return (
    <Section title={t("panel.snap.title")}>
      <SegmentedPicker
        label={t("panel.snap.grid")}
        options={snapLabels()}
        value={String(store.snap.grid)}
        onChange={(v) => store.setSnap({ grid: Number(v) as SnapGrid })}
      />
      <div className="phase-stepper" role="group" aria-label={t("panel.snap.objects")}>
        <button
          type="button"
          className={`phase-stepper__button${store.snap.objects ? " phase-stepper__button--active" : ""}`}
          aria-pressed={store.snap.objects}
          onClick={() => store.setSnap({ objects: !store.snap.objects })}
        >
          {t("panel.snap.objects")}
        </button>
      </div>
    </Section>
  );
}

const ARRANGE_ROWS: Array<{ axis: ArrangeAxis; buttons: Array<[ArrangeMode, MessageKey]> }> = [
  {
    axis: "x",
    buttons: [
      ["min", "panel.multi.left"],
      ["center", "panel.multi.center"],
      ["distribute", "panel.multi.distribute"],
    ],
  },
  {
    axis: "z",
    buttons: [
      ["min", "panel.multi.front"],
      ["center", "panel.multi.center"],
      ["distribute", "panel.multi.distribute"],
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
    const label = kind ? kindLabel(kind) : t(store.getRoadInfo(id) ? "kind.road" : "kind.cable");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    <div className="properties-info">
      <dl className="properties-list">
        <div className="properties-row">
          <dt className="properties-row__label">{t("panel.multi.selection")}</dt>
          <dd className="properties-row__value">
            {t("panel.multi.count", { n: store.selection.length })}
          </dd>
        </div>
        {[...counts].map(([label, n]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{n}</dd>
          </div>
        ))}
      </dl>

      <Section title={t("panel.multi.arrange")}>
        {ARRANGE_ROWS.map(({ axis, buttons }) => (
          <div key={axis} className="segmented-picker">
            <span className="segmented-picker__label">
              {t("panel.multi.axis", { axis: axis.toUpperCase() })}
            </span>
            <div
              className="phase-stepper"
              role="group"
              aria-label={t("panel.multi.alignIn", { axis: axis.toUpperCase() })}
            >
              {buttons.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className="phase-stepper__button"
                  onClick={() => arrangeSelection(registry, axis, mode)}
                >
                  {t(label)}
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
        {t("panel.multi.delete")}
      </button>
      <p className="properties-section__hint">{t("panel.multi.hint")}</p>
    </div>
  );
}

// ---- Fase 11: environment, material brush, vegetation, roads ----

const materialLabels = (): Record<string, string> => ({
  "0": t("panel.paint.auto"),
  "1": t("panel.paint.grass"),
  "2": t("panel.paint.dirt"),
  "3": t("panel.paint.sand"),
  "4": t("panel.paint.rock"),
  "5": t("panel.paint.snow"),
});
const plantLabels = (): Record<PlantKind, string> => ({
  tree: t("panel.veg.trees"),
  bush: t("panel.veg.bushes"),
});

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
      <Section title={t("panel.env.hourTitle", { time: clock(env.hour) })}>
        <input
          type="range"
          className="properties-range"
          min={0}
          max={24}
          step={0.25}
          value={env.hour}
          aria-label={t("panel.env.hourSlider")}
          onChange={(e) => store.setEnvironment({ hour: Number(e.target.value) })}
        />
        <Spinner
          label={t("panel.env.hour")}
          value={env.hour}
          min={0}
          max={24}
          step={0.5}
          onChange={(hour) => store.setEnvironment({ hour })}
        />
      </Section>
      <Section title={t("panel.env.sky")}>
        <Spinner
          label={t("panel.env.fog")}
          value={env.fog}
          min={0}
          max={1}
          step={0.05}
          onChange={(fog) => store.setEnvironment({ fog })}
        />
      </Section>
      <Section title={t("panel.env.water")}>
        <div className="phase-stepper" role="group" aria-label={t("panel.env.water")}>
          <button
            type="button"
            className={`phase-stepper__button${env.water.enabled ? " phase-stepper__button--active" : ""}`}
            aria-pressed={env.water.enabled}
            onClick={() =>
              store.setEnvironment({ water: { ...env.water, enabled: !env.water.enabled } })
            }
          >
            {t(env.water.enabled ? "panel.env.waterOn" : "panel.env.waterOff")}
          </button>
        </div>
        <Spinner
          label={t("panel.env.level")}
          value={env.water.level}
          min={-50}
          max={100}
          step={0.5}
          onChange={(level) => store.setEnvironment({ water: { ...env.water, level } })}
        />
      </Section>
      <p className="properties-section__hint">{t("panel.env.hint")}</p>
    </div>
  );
}

/** Material brush (Fase 11): material + radius. */
function PaintToolSection() {
  const store = useStore();
  return (
    <Section title={t("panel.paint.title")}>
      <SegmentedPicker
        label={t("panel.paint.material")}
        options={materialLabels()}
        value={String(store.paintTool.material)}
        onChange={(v) => store.setPaintMaterial(Number(v) as MaterialId)}
      />
      <Spinner
        label={t("panel.brush.radius")}
        value={store.brush.radius}
        min={1}
        max={50}
        step={1}
        onChange={store.setBrushRadius}
      />
      <p className="properties-section__hint">{t("panel.paint.hint")}</p>
    </Section>
  );
}

/** Vegetation brush (Fase 11): species, density (per 100 m²) and radius. */
function VegetationToolSection() {
  const store = useStore();
  return (
    <Section title={t("panel.veg.title")}>
      <SegmentedPicker
        label={t("panel.veg.species")}
        options={plantLabels()}
        value={store.vegetationTool.kind}
        onChange={(kind) => store.setVegetationTool({ kind })}
      />
      <Spinner
        label={t("panel.veg.density")}
        value={Math.round(store.vegetationTool.density * 100)}
        min={1}
        max={50}
        step={1}
        onChange={(v) => store.setVegetationTool({ density: v / 100 })}
      />
      <Spinner
        label={t("panel.brush.radius")}
        value={store.brush.radius}
        min={1}
        max={50}
        step={1}
        onChange={store.setBrushRadius}
      />
      <p className="properties-section__hint">{t("panel.veg.hint")}</p>
    </Section>
  );
}

/** Road tool (Fase 11): width of the next road. */
function RoadToolSection() {
  const store = useStore();
  return (
    <Section title={t("panel.road.toolTitle")}>
      <Spinner
        label={t("panel.road.width")}
        value={store.roadTool.width}
        min={1}
        max={20}
        step={0.5}
        onChange={store.setRoadWidth}
      />
      <p className="properties-section__hint">{t("panel.road.toolHint")}</p>
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
          [t("common.id"), id],
          [t("common.type"), t("kind.road")],
          [t("panel.road.points"), String(info.points.length)],
          [t("common.length"), meters(roads.getLength(id))],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>
      <Section title={t("panel.road.widthTitle")}>
        <Spinner
          label={t("panel.road.width")}
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
      <p className="properties-section__hint">{t("panel.road.deleteHint")}</p>
    </div>
  );
}

/** Cable tool settings (Fase 6): type and route of the next cable. */
function CableToolSection() {
  const store = useStore();
  return (
    <Section title={t("panel.cableTool.title")}>
      <SegmentedPicker
        label={t("panel.cableTool.type")}
        options={cableTypeLabels()}
        value={store.cableTool.cableType}
        onChange={store.setCableType}
      />
      <SegmentedPicker
        label={t("panel.cableTool.route")}
        options={cableRouteLabels()}
        value={store.cableTool.route}
        onChange={store.setCableRoute}
      />
      <p className="properties-section__hint">{t("panel.cableTool.hint")}</p>
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
          [t("panel.ruler.d3"), meters(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), 2)],
          [t("panel.ruler.horizontal"), meters(Math.hypot(to.x - from.x, to.z - from.z), 2)],
          [t("panel.ruler.rise"), `${to.y >= from.y ? "+" : ""}${meters(to.y - from.y, 2)}`],
        ]
      : [];
  return (
    <Section title={t("panel.ruler.title")}>
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
        {t("panel.ruler.profile")}
      </button>
      <p className="properties-section__hint">
        {t(
          !from ? "panel.ruler.hintStart" : !to ? "panel.ruler.hintSecond" : "panel.ruler.hintDone",
        )}
      </p>
    </Section>
  );
}

/** Marker tool hint (Fase 6): the tool has no settings. */
function MarkerToolSection() {
  return (
    <Section title={t("panel.markerTool.title")}>
      <p className="properties-section__hint">{t("panel.markerTool.hint")}</p>
    </Section>
  );
}

/** Custom terrain params (Fase 3): seed/amplitude/frequency/size. */
function CustomSection({ actions }: { actions: TerrainActions }) {
  const store = useStore();
  const p = store.customParams;
  return (
    <Section title={t("panel.custom.title")}>
      <Spinner
        label={t("panel.custom.seed")}
        value={p.seed}
        min={0}
        max={9999}
        step={1}
        onChange={(v) => store.setCustomParams({ seed: Math.round(v) })}
      />
      <Spinner
        label={t("panel.custom.amplitude")}
        value={p.amplitude}
        min={1}
        max={100}
        step={1}
        onChange={(v) => store.setCustomParams({ amplitude: v })}
      />
      <Spinner
        label={t("panel.custom.frequency")}
        value={p.frequency}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(v) => store.setCustomParams({ frequency: v })}
      />
      <Spinner
        label={t("panel.custom.size")}
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
        {t("panel.custom.generate")}
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
          [t("common.id"), id],
          [t("common.type"), kindLabel(info.kind)],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>

      {info.colliding && (
        <p className="collision-badge" role="alert">
          {t("panel.entity.colliding")}
        </p>
      )}

      {/* Lots ignore the phase (§6); imported .glb models and markers have none (Fases 5–6). */}
      {info.kind !== "lot" && info.kind !== CUSTOM_GLB_KIND && info.kind !== MARKER_KIND && (
        <Section title={t("panel.entity.phase")}>
          <div className="phase-stepper" role="group" aria-label={t("panel.entity.phaseGroup")}>
            {PHASE_KEYS.map((label, phase) => (
              <button
                key={label}
                type="button"
                className={`phase-stepper__button${phase === info.phase ? " phase-stepper__button--active" : ""}`}
                aria-pressed={phase === info.phase}
                onClick={() => writePhase(phase)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </Section>
      )}

      {info.kind === "building" && (
        <Section title={t("panel.entity.floors")}>
          <Spinner
            label={t("panel.entity.floors")}
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
        <Section title={t("panel.entity.marker")}>
          <label className="properties-field">
            <span className="properties-field__label">{t("panel.entity.label")}</span>
            <input
              type="text"
              className="properties-input"
              value={info.label ?? ""}
              maxLength={48}
              onChange={(e) => writeLabel(e.target.value)}
            />
          </label>
          <label className="properties-field">
            <span className="properties-field__label">{t("panel.entity.note")}</span>
            <input
              type="text"
              className="properties-input"
              value={info.note ?? ""}
              maxLength={200}
              onChange={(e) => writeNote(e.target.value)}
            />
          </label>
          {info.targetId && (
            <p className="properties-section__hint">
              {t("panel.entity.placedOn", { id: info.targetId })}
            </p>
          )}
        </Section>
      )}

      {/* Fase 6: dynamic key-value props of network elements (DESIGN.md §4.2). */}
      {isNetworkKind(info.kind) && (
        <Section title={t("panel.entity.dynProps")}>
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
        <Section key={field} title={t(title)}>
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

      <p className="properties-section__hint">{t("panel.entity.hint")}</p>
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
          [t("common.id"), id],
          [t("common.type"), t("kind.cable")],
          [t("panel.cable.link"), `${info.fromId} → ${info.toId}`],
          [t("common.length"), length === undefined ? "—" : meters(length)],
        ].map(([label, value]) => (
          <div key={label} className="properties-row">
            <dt className="properties-row__label">{label}</dt>
            <dd className="properties-row__value">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title={t("panel.cable.type")}>
        <SegmentedPicker
          label={t("panel.cable.type")}
          options={cableTypeLabels()}
          value={info.cableType}
          onChange={writeType}
        />
      </Section>

      <Section title={t("panel.cable.route")}>
        <SegmentedPicker
          label={t("panel.cable.route")}
          options={cableRouteLabels()}
          value={info.route}
          onChange={writeRoute}
        />
      </Section>

      <Section title={t("panel.entity.dynProps")}>
        <DynamicPropsEditor
          props={info.dynamicProps}
          onChange={(dynamicProps) => store.updateCable(id, { dynamicProps })}
        />
      </Section>

      <SimulationSection id={id} simulation={simulation} isCable />

      <p className="properties-section__hint">{t("panel.cable.deleteHint")}</p>
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
      // Fase 16 (Q_LIST.md Q37): wide screens hide the panel while it has nothing to show.
      className={`panel-right glass${open ? " open" : ""}${signature === "empty" ? " is-empty" : ""}`}
      role="complementary"
      aria-label={t("panel.label")}
    >
      <header className="panel-right__header">
        <h2 className="panel-right__title">{t("panel.title")}</h2>
      </header>
      <div ref={contentRef} className="properties-content">
        {content}
      </div>
    </aside>
  );
}
