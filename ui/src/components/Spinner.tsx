/**
 * Numeric spinner (DESIGN.md §6): `−` / `+` buttons plus ↑/↓ on the focused
 * value (`Shift` ×10, `Alt` ÷10), monospace readout, A8 flash on change,
 * `role="spinbutton"` with aria attributes (§17). No textboxes.
 *
 * Controlled: `value` comes from the store, so external changes (gizmo, Y
 * re-snap) show up on the next render without flashing.
 */
import { useRef, type KeyboardEvent } from "react";

import { a8Flash } from "../anim/ui";
import "./spinner.css";

export interface SpinnerProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Base step (DESIGN.md §6: position 0.5, radius 1, intensity 0.1, …). */
  step: number;
  onChange(value: number): void;
}

/** Decimal places needed to display `step` without float dust. */
function decimalsFor(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

export function Spinner({ label, value, min, max, step, onChange }: SpinnerProps) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const decimals = decimalsFor(step);

  function apply(delta: number): void {
    const next = Math.min(max, Math.max(min, Number((value + delta).toFixed(decimals + 2))));
    if (next === value) return;
    if (valueRef.current) a8Flash(valueRef.current);
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; // DESIGN.md §6
    apply((e.key === "ArrowUp" ? step : -step) * mult);
  }

  return (
    <div className="spinner">
      <span className="spinner__label">{label}</span>
      <div className="spinner__control">
        <button
          type="button"
          className="spinner__button"
          aria-label={`${label}: diminuir`}
          onClick={() => apply(-step)}
        >
          −
        </button>
        <span
          ref={valueRef}
          className="spinner__value"
          tabIndex={0}
          role="spinbutton"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {value.toFixed(decimals)}
        </span>
        <button
          type="button"
          className="spinner__button"
          aria-label={`${label}: aumentar`}
          onClick={() => apply(step)}
        >
          +
        </button>
      </div>
    </div>
  );
}
