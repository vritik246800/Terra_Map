/**
 * UI animations of the DESIGN.md §8.1 catalog used by the React components
 * (A7, A8, A9, A10, A11, A15). Durations/eases unchanged from the imperative UI.
 * With `prefers-reduced-motion` every one jumps to its final state, or does
 * a 100ms fade where §8.3 says so (A11).
 */
import gsap from "gsap";

import { prefersReducedMotion } from "./reduced-motion";

const A7_HALF = 0.125; // two 125ms fades = 250ms cross-fade
const A8_DURATION = 0.12;
const A9_DURATION = 0.3;
const A10_DURATION = 0.3;
const A20_DURATION = 0.25;
const A11_IN = 0.25;
const A11_OUT = 0.3;
const A15_DURATION = 0.25;
const REDUCED_FADE = 0.1;

/** A7 out: fades the panel content; `done` runs when it is safe to swap. */
export function a7Out(el: HTMLElement, done: () => void): () => void {
  if (prefersReducedMotion()) {
    done();
    return () => {};
  }
  const tween = gsap.to(el, {
    opacity: 0,
    duration: A7_HALF,
    ease: "power2.inOut",
    onComplete: done,
  });
  return () => tween.kill();
}

/** A7 in: fades the swapped content back in. */
export function a7In(el: HTMLElement): void {
  if (prefersReducedMotion()) {
    gsap.set(el, { opacity: 1 });
    return;
  }
  gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: A7_HALF, ease: "power2.inOut" });
}

/** A8: background flash on a spinner value change. */
export function a8Flash(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  // --accent-soft follows the theme (DESIGN.md §3).
  const soft = getComputedStyle(document.documentElement).getPropertyValue("--accent-soft").trim();
  gsap.fromTo(
    el,
    { backgroundColor: soft },
    {
      backgroundColor: "transparent",
      duration: A8_DURATION,
      ease: "power1.out",
      clearProps: "backgroundColor",
    },
  );
}

/** A9: FAB popover scale 0.8→1 + fade (open) and back (close). */
export function a9Popover(el: HTMLElement, open: boolean, onClosed: () => void): void {
  gsap.killTweensOf(el);
  if (prefersReducedMotion()) {
    gsap.set(el, open ? { scale: 1, opacity: 1 } : { scale: 0.8, opacity: 0 });
    if (!open) onClosed();
    return;
  }
  if (open) {
    gsap.fromTo(
      el,
      { scale: 0.8, opacity: 0 },
      { scale: 1, opacity: 1, duration: A9_DURATION, ease: "back.out(1.6)" },
    );
  } else {
    gsap.to(el, {
      scale: 0.8,
      opacity: 0,
      duration: A9_DURATION,
      ease: "power2.in",
      onComplete: onClosed,
    });
  }
}

/** A10 in: modal backdrop fades in, its card scales 0.95→1 (Fase 8). */
export function a10In(root: HTMLElement): void {
  const card = root.querySelector(".modal__card");
  gsap.killTweensOf([root, card]);
  if (prefersReducedMotion()) {
    gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: REDUCED_FADE });
    return;
  }
  gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: A10_DURATION, ease: "power3.out" });
  if (card) {
    gsap.fromTo(card, { scale: 0.95 }, { scale: 1, duration: A10_DURATION, ease: "power3.out" });
  }
}

/** A10 out: the reverse (power2.in); `done` unmounts. Returns a cancel function. */
export function a10Out(root: HTMLElement, done: () => void): () => void {
  const card = root.querySelector(".modal__card");
  gsap.killTweensOf([root, card]);
  const reduced = prefersReducedMotion();
  const duration = reduced ? REDUCED_FADE : A10_DURATION;
  if (card && !reduced) gsap.to(card, { scale: 0.95, duration, ease: "power2.in" });
  const tween = gsap.to(root, { opacity: 0, duration, ease: "power2.in", onComplete: done });
  return () => tween.kill();
}

/** A20: minimap overlay grows/shrinks to `size` px and fades back to opaque. */
export function a20Resize(el: HTMLElement, size: number): void {
  gsap.killTweensOf(el);
  if (prefersReducedMotion()) {
    gsap.set(el, { width: size, height: size, opacity: 1 });
    return;
  }
  gsap.to(el, { width: size, height: size, duration: A20_DURATION, ease: "power2.inOut" });
  gsap.fromTo(el, { opacity: 0.6 }, { opacity: 1, duration: A20_DURATION, ease: "power2.inOut" });
}

/** A11 in: toast slides up + fades (reduced motion: plain fade). */
export function a11In(el: HTMLElement): void {
  if (prefersReducedMotion()) {
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: REDUCED_FADE });
    return;
  }
  gsap.fromTo(
    el,
    { y: 24, opacity: 0 },
    { y: 0, opacity: 1, duration: A11_IN, ease: "power2.out" },
  );
}

/** A11 out: toast fades away, then `done` removes it. */
export function a11Out(el: HTMLElement, done: () => void): void {
  const reduced = prefersReducedMotion();
  gsap.to(el, {
    opacity: 0,
    y: reduced ? 0 : 12,
    duration: reduced ? REDUCED_FADE : A11_OUT,
    ease: "power2.in",
    onComplete: done,
  });
}

/** A15 initial state (no animation): items shown/hidden, chevron rotated. */
export function a15Init(items: HTMLElement, chevron: HTMLElement, open: boolean): void {
  items.style.display = open ? "" : "none";
  gsap.set(chevron, { rotate: open ? 90 : 0 });
}

/** A15: catalog group expand/collapse (height + chevron rotation). */
export function a15Toggle(items: HTMLElement, chevron: HTMLElement, open: boolean): void {
  gsap.killTweensOf([items, chevron]);

  if (prefersReducedMotion()) {
    items.style.display = open ? "" : "none";
    items.style.height = "";
    gsap.set(chevron, { rotate: open ? 90 : 0 });
    return;
  }

  if (open) {
    items.style.display = "";
    gsap.fromTo(
      items,
      { height: 0 },
      {
        height: items.scrollHeight,
        duration: A15_DURATION,
        ease: "power2.inOut",
        // Clear the inline height so the container can grow with its content.
        onComplete: () => {
          items.style.height = "";
        },
      },
    );
  } else {
    gsap.fromTo(
      items,
      { height: items.offsetHeight },
      {
        height: 0,
        duration: A15_DURATION,
        ease: "power2.inOut",
        onComplete: () => {
          items.style.display = "none";
          items.style.height = "";
        },
      },
    );
  }

  gsap.to(chevron, { rotate: open ? 90 : 0, duration: A15_DURATION, ease: "power2.inOut" });
}
