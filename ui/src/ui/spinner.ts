/**
 * Numeric spinner (DESIGN.md §6): `−` / `+` buttons plus ↑/↓ on the focused
 * value (`Shift` ×10, `Alt` ÷10), monospace readout, A8 flash on change,
 * `role="spinbutton"` with aria attributes (§17). No textboxes.
 */
import gsap from "gsap";

import { prefersReducedMotion } from "../anim/reduced-motion";
import "./spinner.css";

export interface SpinnerOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Base step (DESIGN.md §6: position 0.5, radius 1, intensity 0.1, …). */
  step: number;
  onChange(value: number): void;
}

/**
 * The element returned by `createSpinner`: a plain `HTMLElement` plus an
 * imperative `setValue` for external syncs (e.g. the Y position re-snap after
 * an X/Z edit) — clamps and re-renders without flash and without `onChange`.
 */
export interface SpinnerElement extends HTMLElement {
  setValue(value: number): void;
}

const A8_DURATION = 0.12; // seconds — DESIGN.md §8.1 (A8)

/** Decimal places needed to display `step` without float dust. */
function decimalsFor(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

export function createSpinner(options: SpinnerOptions): SpinnerElement {
  const { label, min, max, step, onChange } = options;
  const decimals = decimalsFor(step);
  let value = options.value;

  const root = document.createElement("div");
  root.className = "spinner";

  const labelEl = document.createElement("span");
  labelEl.className = "spinner__label";
  labelEl.textContent = label;

  const control = document.createElement("div");
  control.className = "spinner__control";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "spinner__button";
  minus.textContent = "−";
  minus.setAttribute("aria-label", `${label}: diminuir`);

  const valueEl = document.createElement("span");
  valueEl.className = "spinner__value";
  valueEl.tabIndex = 0;
  valueEl.setAttribute("role", "spinbutton");
  valueEl.setAttribute("aria-valuemin", String(min));
  valueEl.setAttribute("aria-valuemax", String(max));
  valueEl.setAttribute("aria-label", label);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "spinner__button";
  plus.textContent = "+";
  plus.setAttribute("aria-label", `${label}: aumentar`);

  function render(): void {
    valueEl.textContent = value.toFixed(decimals);
    valueEl.setAttribute("aria-valuenow", String(value));
  }

  /** A8: background flash on every change (GSAP, 120ms, power1.out). */
  function flash(): void {
    if (prefersReducedMotion()) return;
    gsap.fromTo(
      valueEl,
      { backgroundColor: "rgba(0, 113, 227, 0.18)" }, // --accent at low alpha
      { backgroundColor: "rgba(0, 113, 227, 0)", duration: A8_DURATION, ease: "power1.out" },
    );
  }

  function apply(delta: number): void {
    const next = Math.min(max, Math.max(min, Number((value + delta).toFixed(decimals + 2))));
    if (next === value) return;
    value = next;
    render();
    flash();
    onChange(value);
  }

  /** External sync (e.g. Y re-snap): clamps and re-renders, no flash/onChange. */
  function setValue(next: number): void {
    const clamped = Math.min(max, Math.max(min, Number(next.toFixed(decimals + 2))));
    if (clamped === value) return;
    value = clamped;
    render();
  }

  minus.addEventListener("click", () => apply(-step));
  plus.addEventListener("click", () => apply(step));

  valueEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; // DESIGN.md §6
    apply((e.key === "ArrowUp" ? step : -step) * mult);
  });

  render();
  control.append(minus, valueEl, plus);
  root.append(labelEl, control);
  return Object.assign(root, { setValue });
}
