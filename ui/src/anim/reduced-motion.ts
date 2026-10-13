/**
 * Shared helper to check the `prefers-reduced-motion` media query (DESIGN.md §8.3).
 */
export const prefersReducedMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
