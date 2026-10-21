/** "Guia do programa" modal (Fase 8): the workflow in illustrated steps (Fase 13: Fases 10–13 + «Ver introdução»). */
import type { ReactNode } from "react";

import { t } from "../state/i18n";
import { store } from "../state/store";
import { Modal } from "./Modal";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="guide-steps__icon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
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

type StepId =
  | "terrain"
  | "infra"
  | "network"
  | "props"
  | "simulate"
  | "productivity"
  | "environment"
  | "report"
  | "keyboard"
  | "save";

/** Steps of the guide (texts: `guide.steps.<id>`); Fase 13 added Fases 10–13. */
const STEPS: ReadonlyArray<{ id: StepId; icon: ReactNode }> = [
  { id: "terrain", icon: <path d="M2 19 9 8l4 6 3-4 6 9z" /> },
  { id: "infra", icon: <path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6" /> },
  {
    id: "network",
    icon: (
      <>
        <circle cx="5" cy="12" r="2.5" />
        <circle cx="19" cy="6" r="2.5" />
        <circle cx="19" cy="18" r="2.5" />
        <path d="M7.3 11 16.7 7M7.3 13l9.4 4" />
      </>
    ),
  },
  {
    id: "props",
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="7" cy="18" r="2" />
      </>
    ),
  },
  { id: "simulate", icon: <path d="M3 17c4 0 4-10 9-10s5 10 9 10" /> },
  { id: "productivity", icon: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /> },
  {
    id: "environment",
    icon: (
      <>
        <circle cx="17" cy="7" r="3" />
        <path d="M2 20h20M7 20v-5M4 15l3-6 3 6z" />
      </>
    ),
  },
  {
    id: "report",
    icon: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6M8 17v-3M12 17v-5M16 17v-2" />
      </>
    ),
  },
  {
    id: "keyboard",
    icon: (
      <>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
      </>
    ),
  },
  {
    id: "save",
    icon: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8M7 3v5h8" />
      </>
    ),
  },
];

export function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("guide.title")} onDismiss={onClose} wide>
      <ol className="guide-steps">
        {STEPS.map(({ id, icon }, i) => (
          <li key={id} className="guide-steps__item">
            <Icon>{icon}</Icon>
            <div>
              <h3 className="guide-steps__title">
                {i + 1}. {t(`guide.steps.${id}.title`)}
              </h3>
              <p className="guide-steps__text">{t(`guide.steps.${id}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="modal__actions">
        {/* Fase 13: replays the first-run introduction (Q_LIST.md Q26). */}
        <button
          type="button"
          className="modal__button"
          onClick={() => store.openModal("onboarding")}
        >
          {t("guide.replay")}
        </button>
      </div>
    </Modal>
  );
}
