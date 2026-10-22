/**
 * Top navigation bar, floating over the map (Fase 17, UX.md §1.1, Q_LIST.md
 * Q46): panel toggles (narrow screens), the **File / View / Tools** menus,
 * the editable project title (Fase 8: dot while there are unsaved changes)
 * and the **Settings** gear — Dark mode and Snap buildings to roads as
 * switches, Shortcuts and User guide (they lived in the round `?` button,
 * gone in Fase 17; the `?` key still opens the shortcuts).
 */
import { useEffect, type ReactNode } from "react";

import { a23ThemeFade } from "../anim/ui";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import { t } from "../state/i18n";
import { prefs } from "../state/prefs";
import { store as appStore } from "../state/store";
import { theme } from "../state/theme";
import { useStore } from "../state/use-store";
import { Menu } from "./Menu";
import "./topbar.css";

export interface TopBarProps {
  onSave(): void;
  onSaveAs(): void;
  onOpen(): void;
  onImport(): void;
  onExport(): void;
  onPresent(): void;
  onTogglePanel(side: "left" | "right"): void;
}

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

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
  gear: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  ),
};

export function TopBar({
  onSave,
  onSaveAs,
  onOpen,
  onImport,
  onExport,
  onPresent,
  onTogglePanel,
}: TopBarProps) {
  const store = useStore();
  const dark = theme.current === "dark";

  // `?` opens the shortcuts from anywhere (UX.md §4 — was the FAB's, Fase 8).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "?" && !shouldIgnoreShortcut(e)) appStore.openModal("shortcuts");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      <nav className="navbar-top-actions" aria-label={t("topbar.menus")}>
        <Menu
          label={t("topbar.file")}
          items={[
            { kind: "action", label: t("topbar.open"), shortcut: `${MOD}O`, onSelect: onOpen },
            { kind: "action", label: t("topbar.save"), shortcut: `${MOD}S`, onSelect: onSave },
            { kind: "action", label: t("topbar.saveAs"), shortcut: `⇧${MOD}S`, onSelect: onSaveAs },
            { kind: "separator" },
            { kind: "action", label: t("topbar.import"), shortcut: `${MOD}I`, onSelect: onImport },
            { kind: "action", label: t("topbar.export"), shortcut: `${MOD}E`, onSelect: onExport },
          ]}
        />
        <Menu
          label={t("topbar.view")}
          items={[
            {
              kind: "toggle",
              label: t("topbar.layers"),
              shortcut: "L",
              checked: store.layersPanelOpen,
              onToggle: () => store.toggleLayersPanel(),
            },
            {
              kind: "toggle",
              label: t("topbar.grid"),
              shortcut: "G",
              checked: store.gridVisible,
              onToggle: () => store.toggleGrid(),
            },
            { kind: "separator" },
            { kind: "action", label: t("topbar.present"), onSelect: onPresent },
          ]}
        />
        <Menu
          label={t("topbar.tools")}
          items={[
            {
              kind: "action",
              label: t("topbar.report"),
              onSelect: () => store.openModal("report"),
            },
            {
              kind: "action",
              label: t("topbar.ruler"),
              shortcut: "R",
              onSelect: () => store.setTool(store.tool === "ruler" ? "select" : "ruler"),
            },
          ]}
        />
      </nav>
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
      <div className="navbar-top-prefs">
        <Menu
          label={t("topbar.settings")}
          icon={ICONS.gear}
          iconOnly
          align="end"
          items={[
            {
              kind: "toggle",
              label: t("topbar.darkTheme"),
              checked: dark,
              onToggle: () => a23ThemeFade(theme.toggle),
            },
            {
              kind: "toggle",
              label: t("topbar.snapToRoads"),
              checked: prefs.snapToRoads,
              onToggle: () => prefs.setSnapToRoads(!prefs.snapToRoads),
            },
            { kind: "separator" },
            {
              kind: "action",
              label: t("topbar.shortcuts"),
              shortcut: "?",
              onSelect: () => store.openModal("shortcuts"),
            },
            { kind: "action", label: t("topbar.guide"), onSelect: () => store.openModal("guide") },
          ]}
        />
      </div>
    </header>
  );
}
