/**
 * Toast notifications — animation A11 (DESIGN.md §8.1): GSAP slide-up + fade,
 * 250ms in / 300ms out, auto-dismiss after 3s. With reduced motion the toast
 * just fades (100ms, DESIGN.md §8.3).
 *
 * Stacked bottom-center so it never collides with the FAB (bottom-right).
 * Variants use the design tokens: `--ok` (success), `--danger` (error),
 * `--accent` (info) — DESIGN.md §7.1.
 */
import gsap from "gsap";

import { prefersReducedMotion } from "../anim/reduced-motion";
import "./toast.css";

export type ToastKind = "success" | "danger" | "info";

const A11_IN = 0.25; // seconds — DESIGN.md §8.1 (A11, power2.out)
const A11_OUT = 0.3;
const A11_HOLD_MS = 3000; // auto-dismiss 3s
const REDUCED_FADE = 0.1; // §8.3: reduced motion = simple 100ms fade

let host: HTMLElement | null = null;

/** Lazily creates the toast container (appended to `<body>`, above the app). */
function ensureHost(): HTMLElement {
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

/** Shows a toast with the A11 animation; it dismisses itself after 3s. */
export function showToast(message: string, kind: ToastKind = "info"): void {
  const container = ensureHost();
  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;
  toast.setAttribute("role", kind === "danger" ? "alert" : "status");
  toast.textContent = message;
  container.appendChild(toast);

  const reduced = prefersReducedMotion();
  if (reduced) {
    gsap.fromTo(toast, { opacity: 0 }, { opacity: 1, duration: REDUCED_FADE });
  } else {
    gsap.fromTo(
      toast,
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: A11_IN, ease: "power2.out" },
    );
  }

  window.setTimeout(() => {
    gsap.to(toast, {
      opacity: 0,
      y: reduced ? 0 : 12,
      duration: reduced ? REDUCED_FADE : A11_OUT,
      ease: "power2.in",
      onComplete: () => toast.remove(),
    });
  }, A11_HOLD_MS);
}
