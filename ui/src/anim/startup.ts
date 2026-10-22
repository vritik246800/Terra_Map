import gsap from "gsap";

import { prefersReducedMotion } from "./reduced-motion";

/**
 * Boot sequence of the UI (DESIGN.md §8.2, PLAN.md Fase 1):
 *  - A2: top navbar slides down + fades in (350ms, power3.out)
 *  - A1: side panels slide in from their edges + fade (400ms, power3.out, stagger 60ms)
 *
 * Missing elements are skipped without throwing. With
 * `prefers-reduced-motion: reduce` nothing runs — the layout is already
 * in its final state (DESIGN.md §8.3).
 */
export function playStartupAnimation(root: ParentNode = document): void {
  if (prefersReducedMotion()) return;

  const navbar = root.querySelector(".navbar-top");
  if (navbar) {
    gsap.from(navbar, {
      y: -52,
      opacity: 0,
      duration: 0.35,
      ease: "power3.out",
    });
  }

  const panels = root.querySelectorAll(".panel-left, .panel-right");
  if (panels.length > 0) {
    gsap.from(panels, {
      x: (i: number) => (i === 0 ? -260 : 300),
      opacity: 0,
      duration: 0.4,
      ease: "power3.out",
      stagger: 0.06,
      // Fase 16 (ERRORS.md E52): hand opacity back to the CSS — the right
      // panel starts hidden (`is-empty`), so a kept inline 0 would hide it for good.
      clearProps: "transform,opacity",
    });
  }
}
