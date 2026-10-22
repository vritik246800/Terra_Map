/**
 * Drop-down menu of the top bar (Fase 17, UX.md §1.1, Q_LIST.md Q46): File,
 * View, Tools and Settings. Replaces the Fase 1 FAB popover and keeps its
 * behaviour: A9 on open/close, focus on the first item, ↑/↓ cycle, Esc closes
 * and gives focus back to the button, a click outside closes. Toggle items
 * are `menuitemcheckbox` switches (Settings › Dark mode, View › Grid…).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { a9Popover } from "../anim/ui";
import "./menu.css";

export type MenuItem =
  | { kind: "action"; label: string; shortcut?: string; onSelect(): void }
  | { kind: "toggle"; label: string; shortcut?: string; checked: boolean; onToggle(): void }
  | { kind: "separator" };

export function Menu({
  label,
  icon,
  items,
  align = "start",
  iconOnly = false,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const focusables = () => [
    ...(popoverRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []),
  ];

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
      focusables()[0]?.focus();
    } else {
      a9Popover(popover, false, () => popover.classList.remove("open"));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = focusables();
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      e.preventDefault();
      items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="menu">
      <button
        ref={buttonRef}
        type="button"
        className={`tb-btn menu__button${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={iconOnly ? label : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {!iconOnly && <span className="tb-btn-label">{label}</span>}
        {!iconOnly && (
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      <div
        ref={popoverRef}
        className={`menu__popover glass menu__popover--${align}`}
        role="menu"
        aria-label={label}
      >
        {items.map((item, i) => {
          if (item.kind === "separator") return <hr key={i} className="menu__separator" />;
          const toggle = item.kind === "toggle";
          return (
            <button
              key={item.label}
              type="button"
              className="menu__item"
              role={toggle ? "menuitemcheckbox" : "menuitem"}
              aria-checked={toggle ? item.checked : undefined}
              onClick={() => {
                if (toggle) {
                  item.onToggle(); // switches stay open, like a settings sheet
                  return;
                }
                setOpen(false);
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              <span className="menu__label">{item.label}</span>
              {item.shortcut && <kbd className="menu__shortcut">{item.shortcut}</kbd>}
              {toggle && (
                <span className={`switch${item.checked ? " is-on" : ""}`} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
