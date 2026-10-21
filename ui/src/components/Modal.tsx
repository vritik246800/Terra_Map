/**
 * Modal shell (Fase 8, UX.md §1.1): glass card centered over a `--backdrop`
 * layer. While open it swallows keyboard shortcuts (the scene/tools listen on
 * `window`); `Esc` and a click on the backdrop call `onDismiss` when given —
 * modals that require a choice omit it. Focus moves to the primary action
 * (never a destructive one — Enter must not discard work), else the first
 * button, and returns to where it was on close. A10 is played by
 * `ModalHost`, which owns mounting.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

import "./modal.css";

export function Modal({
  title,
  onDismiss,
  wide = false,
  children,
}: {
  title: string;
  onDismiss?: () => void;
  wide?: boolean;
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
      e.stopPropagation(); // no scene/tool shortcuts behind the modal
      if (e.key === "Escape") dismissRef.current?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="modal"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={cardRef}
        className={`modal__card glass${wide ? " modal__card--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          {onDismiss && (
            <button type="button" className="modal__close" aria-label="Fechar" onClick={onDismiss}>
              ×
            </button>
          )}
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
