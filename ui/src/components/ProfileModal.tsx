/**
 * "Perfil do terreno" modal (Fase 12, UX.md §2, DESIGN.md §1.8): SVG chart of
 * the heights sampled by the core along the ruler measurement — 2 px
 * `--accent` line over a `--accent-soft` area, discreet grid, crosshair +
 * tooltip following the pointer or `←`/`→` (`Home`/`End`) on the focused
 * chart — plus min, max, rise and distance.
 */
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { ProfilePoint } from "../net/bridge";
import { errorText } from "../state/toasts";
import type { ReportActions } from "../tools/report";
import { Modal } from "./Modal";

const W = 600;
const H = 240;
const PAD = { left: 48, right: 14, top: 14, bottom: 28 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const DIVISIONS = 4;

const m = (v: number, decimals = 1) => `${v.toFixed(decimals)} m`;

function Chart({ points }: { points: ProfilePoint[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const length = points[points.length - 1].distance;
  const heights = points.map((p) => p.height);
  let lo = Math.min(...heights);
  let hi = Math.max(...heights);
  const pad = Math.max((hi - lo) * 0.1, 0.5); // flat ground still gets a band
  lo -= pad;
  hi += pad;
  const x = (d: number) => PAD.left + (d / length) * PLOT_W;
  const y = (h: number) => PAD.top + (1 - (h - lo) / (hi - lo)) * PLOT_H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.distance)},${y(p.height)}`).join("");
  const bottom = PAD.top + PLOT_H;
  const area = `${line}L${x(length)},${bottom}L${PAD.left},${bottom}Z`;
  const last = points.length - 1;
  const at = index === null ? null : points[index];

  function onPointerMove(e: PointerEvent<SVGSVGElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * W - PAD.left;
    setIndex(Math.min(last, Math.max(0, Math.round((t / PLOT_W) * last))));
  }

  function onKeyDown(e: KeyboardEvent<SVGSVGElement>): void {
    const step = e.shiftKey ? 10 : 1;
    const current = index ?? 0;
    const next =
      e.key === "ArrowRight"
        ? current + step
        : e.key === "ArrowLeft"
          ? current - step
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setIndex(Math.min(last, Math.max(0, next)));
  }

  const tipText = at ? `${m(at.distance)} · ${m(at.height)}` : "";
  const tipW = tipText.length * 6.6 + 16;
  const tipX = at
    ? Math.min(Math.max(x(at.distance) - tipW / 2, PAD.left), W - PAD.right - tipW)
    : 0;

  return (
    <svg
      className="profile-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="slider"
      tabIndex={0}
      aria-label="Perfil do terreno — setas percorrem as amostras"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index ?? 0}
      aria-valuetext={at ? tipText : "início"}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setIndex(null)}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: DIVISIONS + 1 }, (_, i) => {
        const gy = PAD.top + (i / DIVISIONS) * PLOT_H;
        const gx = PAD.left + (i / DIVISIONS) * PLOT_W;
        return (
          <g key={i}>
            <line
              className="profile-chart__grid"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={gy}
              y2={gy}
            />
            <line className="profile-chart__grid" x1={gx} x2={gx} y1={PAD.top} y2={bottom} />
            <text className="profile-chart__axis" x={PAD.left - 6} y={gy + 4} textAnchor="end">
              {(hi - ((hi - lo) * i) / DIVISIONS).toFixed(1)}
            </text>
            <text className="profile-chart__axis" x={gx} y={H - 8} textAnchor="middle">
              {m((length * i) / DIVISIONS, 0)}
            </text>
          </g>
        );
      })}
      <path className="profile-chart__area" d={area} />
      <path className="profile-chart__line" d={line} />
      {at && (
        <g>
          <line
            className="profile-chart__cross"
            x1={x(at.distance)}
            x2={x(at.distance)}
            y1={PAD.top}
            y2={bottom}
          />
          <circle className="profile-chart__dot" cx={x(at.distance)} cy={y(at.height)} r={4} />
          <rect
            className="profile-chart__tip"
            x={tipX}
            y={PAD.top + 4}
            width={tipW}
            height={22}
            rx={8}
          />
          <text
            className="profile-chart__tip-text"
            x={tipX + tipW / 2}
            y={PAD.top + 19}
            textAnchor="middle"
          >
            {tipText}
          </text>
        </g>
      )}
    </svg>
  );
}

export function ProfileModal({ report, onClose }: { report: ReportActions; onClose: () => void }) {
  const [points, setPoints] = useState<ProfilePoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    report
      .profile()
      .then((p) => alive && setPoints(p ?? []))
      .catch((err: unknown) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [report]);

  const usable = points && points.length > 1 && points[points.length - 1].distance > 0.01;
  const heights = points?.map((p) => p.height) ?? [];

  return (
    <Modal title="Perfil do terreno" onDismiss={onClose} wide>
      {error && (
        <p className="sim-panel__alert" role="alert">
          Não foi possível calcular o perfil: {error}
        </p>
      )}
      {!points && !error && <p className="modal__text">A calcular…</p>}
      {points && !usable && (
        <p className="modal__text">Mede primeiro dois pontos diferentes com a régua (R).</p>
      )}
      {points && usable && (
        <>
          <Chart points={points} />
          <dl className="properties-list profile-stats">
            {[
              ["Mínimo", m(Math.min(...heights), 2)],
              ["Máximo", m(Math.max(...heights), 2)],
              ["Desnível", m(heights[heights.length - 1] - heights[0], 2)],
              ["Distância", m(points[points.length - 1].distance, 2)],
            ].map(([label, value]) => (
              <div key={label} className="properties-row">
                <dt className="properties-row__label">{label}</dt>
                <dd className="properties-row__value">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <div className="modal__actions">
        <button type="button" className="modal__button modal__button--primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
