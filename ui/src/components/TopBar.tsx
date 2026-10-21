/**
 * Top navigation bar: panel toggles (narrow screens), project actions
 * (Guardar/Abrir/Importar/Exportar) and the editable project title.
 * Import/Export (`.glb`) are wired in Fase 5; Save/Open and the title
 * (store `projectName`, dot while there are unsaved changes) in Fase 8.
 */
import type { ReactNode } from "react";

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
    { label: "Guardar", icon: ICONS.save, onClick: onSave },
    { label: "Abrir", icon: ICONS.open, onClick: onOpen },
    { label: "Importar", icon: ICONS.import, onClick: onImport },
    { label: "Exportar", icon: ICONS.export, onClick: onExport },
    { label: "Camadas", icon: ICONS.layers, onClick: () => store.toggleLayersPanel() }, // Fase 10 (L)
  ];

  return (
    <header className="navbar-top glass">
      <div className="navbar-top-toggles">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Alternar painel esquerdo"
          onClick={() => onTogglePanel("left")}
        >
          {ICONS.panelLeft}
        </button>
        <button
          type="button"
          className="panel-toggle"
          aria-label="Alternar painel direito"
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
          aria-label="Título do projeto"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => store.setProjectName(e.target.value)}
        />
        {store.dirty && (
          <span className="project-dirty" role="status" aria-label="Alterações por guardar" />
        )}
      </div>
    </header>
  );
}
