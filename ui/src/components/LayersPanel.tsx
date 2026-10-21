/**
 * Layers + history card over the viewport (Fase 10, UX.md §1.1), toggled by
 * `L` or the top bar: visibility (eye) and lock per fixed layer, and the undo
 * history — newest first, undone entries muted, a click jumps to that point.
 */
import type { ReactNode } from "react";

import { LAYER_LABELS } from "../state/labels";
import { LAYER_IDS } from "../state/store";
import { useStore } from "../state/use-store";
import type { HistoryActions } from "../tools/history";
import "./layers-panel.css";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const EYE = (
  <Icon>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const EYE_OFF = (
  <Icon>
    <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
  </Icon>
);
const LOCK = (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);
const UNLOCK = (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.8-1.3" />
  </Icon>
);

export function LayersPanel({ history }: { history: HistoryActions }) {
  const store = useStore();
  if (!store.layersPanelOpen) return null;
  const labels = history.labels;
  const position = history.position;

  return (
    <section className="layers-panel glass" aria-label="Camadas e histórico">
      <header className="layers-panel__header">
        <h2 className="layers-panel__title">Camadas</h2>
        <button
          type="button"
          className="layers-panel__close"
          aria-label="Fechar camadas"
          onClick={() => store.toggleLayersPanel()}
        >
          ×
        </button>
      </header>
      <ul className="layers-list">
        {LAYER_IDS.map((id) => {
          const { visible, locked } = store.layer(id);
          const name = LAYER_LABELS[id];
          return (
            <li key={id} className={`layers-list__item${visible ? "" : " is-hidden"}`}>
              <span className="layers-list__name">{name}</span>
              <button
                type="button"
                className="layers-list__toggle"
                aria-pressed={visible}
                aria-label={`${visible ? "Esconder" : "Mostrar"} ${name}`}
                onClick={() => store.setLayer(id, { visible: !visible })}
              >
                {visible ? EYE : EYE_OFF}
              </button>
              <button
                type="button"
                className={`layers-list__toggle${locked ? " is-active" : ""}`}
                aria-pressed={locked}
                aria-label={`${locked ? "Desbloquear" : "Bloquear"} ${name}`}
                onClick={() => store.setLayer(id, { locked: !locked })}
              >
                {locked ? LOCK : UNLOCK}
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className="layers-panel__title layers-panel__title--section">Histórico</h2>
      <div className="history-actions">
        <button
          type="button"
          className="history-actions__button"
          disabled={position === 0}
          onClick={history.undo}
        >
          Desfazer
        </button>
        <button
          type="button"
          className="history-actions__button"
          disabled={position === labels.length}
          onClick={history.redo}
        >
          Refazer
        </button>
      </div>
      <ol className="history-list" aria-label="Histórico de ações">
        {labels
          .map((label, i) => ({ label, i }))
          .reverse()
          .map(({ label, i }) => (
            <li key={i}>
              <button
                type="button"
                className={`history-list__item${i === position - 1 ? " is-current" : ""}${i >= position ? " is-undone" : ""}`}
                aria-current={i === position - 1 ? "step" : undefined}
                onClick={() => history.jumpTo(i + 1)}
              >
                {label}
              </button>
            </li>
          ))}
        <li>
          <button
            type="button"
            className={`history-list__item${position === 0 ? " is-current" : ""}`}
            aria-current={position === 0 ? "step" : undefined}
            onClick={() => history.jumpTo(0)}
          >
            Estado inicial
          </button>
        </li>
      </ol>
    </section>
  );
}
