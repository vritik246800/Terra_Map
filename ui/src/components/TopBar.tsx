/**
 * Top navigation bar: panel toggles (narrow screens), project actions
 * (Save/Open/Import/Export, Layers, Report — Fase 12), the editable
 * project title and the theme button (Fase 13; language button gone in Fase 14).
 * Import/Export (`.glb`) are wired in Fase 5; Save/Open and the title
 * (store `projectName`, dot while there are unsaved changes) in Fase 8.
 */
import type { ReactNode } from "react";

import { a23ThemeFade } from "../anim/ui";
import { t } from "../state/i18n";
import { theme } from "../state/theme";
import { useStore } from "../state/use-store";
import "./topbar.css";

export interface TopBarProps {
  onSave?: () => void;
  onOpen?: () => void;
  onImport?: () => void;
  onExport?: () => void;
  onTogglePanel(side: "left" | "right"): void;
}

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
    >
      {children}
    </svg>
  );
}

const ICONS = {
  panelLeft: (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="10" y1="4" x2="10" y2="20" />
    </Icon>
  ),
  panelRight: (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="14" y1="4" x2="14" y2="20" />
    </Icon>
  ),
  save: (
    <Icon>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </Icon>
  ),
  open: (
    <Icon>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  ),
  import: (
    <Icon>
      <path d="M12 3v12" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
  layers: (
    <Icon>
      <path d="M12 3 2 8l10 5 10-5z" />
      <path d="M2 13l10 5 10-5" />
    </Icon>
  ),
  report: (
    <Icon>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
      <line x1="8" y1="17" x2="8" y2="14" />
      <line x1="12" y1="17" x2="12" y2="12" />
      <line x1="16" y1="17" x2="16" y2="15" />
    </Icon>
  ),
  sun: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  ),
  moon: (
    <Icon>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Icon>
  ),
  export: (
    <Icon>
      <path d="M12 15V3" />
      <polyline points="7 8 12 3 17 8" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
};

export function TopBar({ onSave, onOpen, onImport, onExport, onTogglePanel }: TopBarProps) {
  const store = useStore();
  const actions = [
    { label: t("topbar.save"), icon: ICONS.save, onClick: onSave },
    { label: t("topbar.open"), icon: ICONS.open, onClick: onOpen },
    { label: t("topbar.import"), icon: ICONS.import, onClick: onImport },
    { label: t("topbar.export"), icon: ICONS.export, onClick: onExport },
    { label: t("topbar.layers"), icon: ICONS.layers, onClick: () => store.toggleLayersPanel() }, // Fase 10 (L)
    { label: t("topbar.report"), icon: ICONS.report, onClick: () => store.openModal("report") }, // Fase 12
  ];
  const dark = theme.current === "dark";

  return (
    <header className="navbar-top glass">
      <div className="navbar-top-toggles">
        <button
          type="button"
          className="panel-toggle"
          aria-label={t("topbar.toggleLeft")}
          onClick={() => onTogglePanel("left")}
        >
          {ICONS.panelLeft}
        </button>
        <button
          type="button"
          className="panel-toggle"
          aria-label={t("topbar.toggleRight")}
          onClick={() => onTogglePanel("right")}
        >
          {ICONS.panelRight}
        </button>
      </div>
      <div className="navbar-top-actions">
        {actions.map(({ label, icon, onClick }) => (
          <button
            key={label}
            type="button"
            className="tb-btn"
            aria-label={label}
            title={label}
            onClick={onClick}
          >
            {icon}
            <span className="tb-btn-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="project-title-wrap">
        <input
          type="text"
          className="project-title"
          value={store.projectName}
          maxLength={80}
          size={Math.max(10, store.projectName.length + 2)}
          aria-label={t("topbar.projectTitle")}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => store.setProjectName(e.target.value)}
        />
        {store.dirty && (
          <span className="project-dirty" role="status" aria-label={t("topbar.unsaved")} />
        )}
      </div>
      {/* Fase 13 (UX.md §1.1, Q_LIST.md Q27): theme, a local preference. */}
      <div className="navbar-top-prefs">
        <button
          type="button"
          className="tb-btn"
          aria-label={t("topbar.darkTheme")}
          aria-pressed={dark}
          title={t("topbar.darkTheme")}
          onClick={() => a23ThemeFade(theme.toggle)}
        >
          {dark ? ICONS.moon : ICONS.sun}
        </button>
      </div>
    </header>
  );
}
