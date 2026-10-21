/**
 * Modal shell (Fase 8, UX.md §1.1): glass card centered over a `--backdrop`
 * layer. While open it swallows keyboard shortcuts (the scene/tools listen on
 * `window`); `Esc` and a click on the backdrop call `onDismiss` when given —
 * modals that require a choice omit it. Focus moves to the primary action
 * (never a destructive one — Enter must not discard work), else the first
 * button, and returns to where it was on close. A10 is played by
 * `ModalHost`, which owns mounting. Fase 13: `Tab` cycles inside the card
 * (focus trap); the onboarding passes `trap={false}` (the highlighted zone
 * stays usable, shortcuts included) and `corner` (bottom-right card).
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

import { t } from "../state/i18n";
import "./modal.css";

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onDismiss,
  wide = false,
  trap = true,
  corner = false,
  children,
}: {
  title: string;
  onDismiss?: () => void;
  wide?: boolean;
  /** Keeps focus and keys inside the card (default); false for the onboarding. */
  trap?: boolean;
  /** Card at the bottom-right instead of centered (onboarding). */
  corner?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;
    (
      card?.querySelector<HTMLElement>(".modal__button--primary") ??
      card?.querySelector<HTMLElement>("button")
    )?.focus();

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismissRef.current?.();
        return;
      }
      if (!trap) return;
      e.stopPropagation(); // no scene/tool shortcuts behind the modal
      if (e.key !== "Tab" || !card) return;
      // Focus trap: Tab / Shift+Tab cycle through the card.
      const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!card.contains(active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [trap]);

  return (
    <div
      className={`modal${corner ? " modal--corner" : ""}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={cardRef}
        className={`modal__card glass${wide ? " modal__card--wide" : ""}`}
        role="dialog"
        aria-modal={trap}
        aria-labelledby={titleId}
      >
        <header className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          {onDismiss && (
            <button
              type="button"
              className="modal__close"
              aria-label={t("common.close")}
              onClick={onDismiss}
            >
              ×
            </button>
          )}
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
