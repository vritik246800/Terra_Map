/**
 * Circular FAB (bottom-right) with a popover menu ("Atalhos", "Guia do
 * programa"). The popover stays mounted and toggles `.open` so A9 can
 * animate it. Items open the "Atalhos" / "Guia do programa" modals through
 * the store (Fase 8); `?` opens the shortcuts from anywhere (UX.md §4).
 */
import { useEffect, useRef, useState } from "react";

import { a9Popover } from "../anim/ui";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import { store } from "../state/store";
import "./fab-menu.css";

type FabAction = "shortcuts" | "guide";

const MENU_ITEMS: ReadonlyArray<{ action: FabAction; label: string }> = [
  { action: "shortcuts", label: "Atalhos" },
  { action: "guide", label: "Guia do programa" },
];

export function FabMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  const firstRender = useRef(true);

  // A9 on every open/close (skipped on mount: the popover starts hidden).
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (open) {
      popover.classList.add("open");
      a9Popover(popover, true, () => {});
      itemRefs.current[0]?.focus();
    } else {
      a9Popover(popover, false, () => popover.classList.remove("open"));
    }
  }, [open]);

  // `?` opens the shortcuts modal (UX.md §4).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "?" && !shouldIgnoreShortcut(e)) store.openModal("shortcuts");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Outside click closes; Escape closes and returns focus; ↑/↓ cycle items.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        fabRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = itemRefs.current;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      e.preventDefault();
      const next = (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      <button
        ref={fabRef}
        type="button"
        className="fab"
        aria-label="Ajuda e atalhos"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <circle cx="12" cy="17" r="0.5" fill="currentColor" />
        </svg>
      </button>
      <div ref={popoverRef} className="fab-popover glass" role="menu" aria-label="Ajuda e atalhos">
        {MENU_ITEMS.map(({ action, label }, i) => (
          <button
            key={action}
            ref={(el) => {
              if (el) itemRefs.current[i] = el;
            }}
            type="button"
            className="fab-popover-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              store.openModal(action);
              fabRef.current?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
