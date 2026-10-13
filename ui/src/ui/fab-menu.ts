import gsap from "gsap";
import "./fab-menu.css";

/** Actions dispatched by the FAB popover (modals arrive in Fase 8). */
export type FabAction = "shortcuts" | "guide";

const MENU_ITEMS: ReadonlyArray<{ action: FabAction; label: string }> = [
  { action: "shortcuts", label: "Atalhos" },
  { action: "guide", label: "Guia do programa" },
];

/** Inline question-mark icon (stroke follows currentColor). */
const HELP_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
  <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
</svg>`;

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Creates the circular FAB (bottom-right) and its popover menu with
 * "Atalhos" and "Guia do programa". The popover stays in the DOM and is
 * toggled via the `.open` class so GSAP can animate it (A9: 300ms,
 * back.out(1.6), scale 0.8→1 + fade). Menu item clicks dispatch a
 * `fab:action` CustomEvent on `document` with detail `shortcuts | guide`.
 */
export function createFabMenu(): HTMLElement {
  const root = document.createElement("div");

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "fab";
  fab.setAttribute("aria-label", "Ajuda e atalhos");
  fab.setAttribute("aria-haspopup", "menu");
  fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = HELP_ICON;

  const popover = document.createElement("div");
  popover.className = "fab-popover glass";
  popover.setAttribute("role", "menu");
  popover.setAttribute("aria-label", "Ajuda e atalhos");

  const items = MENU_ITEMS.map(({ action, label }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "fab-popover-item";
    item.setAttribute("role", "menuitem");
    item.dataset.action = action;
    item.textContent = label;
    popover.appendChild(item);
    return item;
  });

  root.append(fab, popover);

  let open = false;

  const setOpen = (next: boolean): void => {
    open = next;
    fab.setAttribute("aria-expanded", String(next));
  };

  const openPopover = (): void => {
    if (open) return;
    setOpen(true);
    popover.classList.add("open");
    gsap.killTweensOf(popover);
    if (prefersReducedMotion()) {
      // Reduced motion: no scale/fade animation, final state immediately.
      gsap.set(popover, { scale: 1, opacity: 1 });
    } else {
      gsap.fromTo(
        popover,
        { scale: 0.8, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.6)" },
      );
    }
    items[0]?.focus();
  };

  const closePopover = (restoreFocus = false): void => {
    if (!open) return;
    setOpen(false);
    gsap.killTweensOf(popover);
    const hide = (): void => popover.classList.remove("open");
    if (prefersReducedMotion()) {
      gsap.set(popover, { scale: 0.8, opacity: 0 });
      hide();
    } else {
      gsap.to(popover, {
        scale: 0.8,
        opacity: 0,
        duration: 0.3,
        ease: "power2.in",
        onComplete: hide,
      });
    }
    if (restoreFocus) fab.focus();
  };

  fab.addEventListener("click", () => {
    if (open) {
      closePopover();
    } else {
      openPopover();
    }
  });

  for (const item of items) {
    item.addEventListener("click", () => {
      const action = item.dataset.action as FabAction;
      document.dispatchEvent(new CustomEvent<FabAction>("fab:action", { detail: action }));
      closePopover(true);
    });
  }

  // Close on outside click.
  document.addEventListener("pointerdown", (event) => {
    if (open && event.target instanceof Node && !root.contains(event.target)) {
      closePopover();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      closePopover(true);
      return;
    }
    // Basic menu keyboard navigation (ArrowUp/ArrowDown cycle items).
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!popover.contains(document.activeElement)) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + step + items.length) % items.length;
      items[next]?.focus();
    }
  });

  return root;
}
