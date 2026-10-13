import "./topbar.css";

export interface TopBarCallbacks {
  onSave?: () => void;
  onOpen?: () => void;
  onImport?: () => void;
  onExport?: () => void;
}

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const SVG_CLOSE = "</svg>";

const ICONS = {
  panelLeft: `${SVG_OPEN}<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="10" y1="4" x2="10" y2="20"/>${SVG_CLOSE}`,
  panelRight: `${SVG_OPEN}<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="14" y1="4" x2="14" y2="20"/>${SVG_CLOSE}`,
  save: `${SVG_OPEN}<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>${SVG_CLOSE}`,
  open: `${SVG_OPEN}<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>${SVG_CLOSE}`,
  import: `${SVG_OPEN}<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>${SVG_CLOSE}`,
  export: `${SVG_OPEN}<path d="M12 15V3"/><polyline points="7 8 12 3 17 8"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>${SVG_CLOSE}`,
} as const;

interface ActionSpec {
  key: keyof TopBarCallbacks;
  label: string;
  icon: string;
}

const ACTIONS: readonly ActionSpec[] = [
  { key: "onSave", label: "Guardar", icon: ICONS.save },
  { key: "onOpen", label: "Abrir", icon: ICONS.open },
  { key: "onImport", label: "Importar", icon: ICONS.import },
  { key: "onExport", label: "Exportar", icon: ICONS.export },
];

function createPanelToggle(
  target: "left" | "right",
  ariaLabel: string,
  icon: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "panel-toggle";
  button.dataset.target = target;
  button.setAttribute("aria-label", ariaLabel);
  button.innerHTML = icon;
  button.addEventListener("click", () => {
    const panel = document.querySelector(target === "left" ? ".panel-left" : ".panel-right");
    panel?.classList.toggle("open");
  });
  return button;
}

function createActionButton(spec: ActionSpec, callbacks: TopBarCallbacks): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tb-btn";
  button.setAttribute("aria-label", spec.label);
  button.title = spec.label;
  button.innerHTML = `${spec.icon}<span class="tb-btn-label">${spec.label}</span>`;
  button.addEventListener("click", () => callbacks[spec.key]?.());
  return button;
}

/**
 * Builds the top navigation bar: panel toggles (narrow screens), project
 * actions (Guardar/Abrir/Importar/Exportar) and the editable project title.
 * Import/Export (`.glb`) are wired in Fase 5; Save/Open arrive in Fase 8.
 */
export function createTopBar(callbacks: TopBarCallbacks = {}): HTMLElement {
  const header = document.createElement("header");
  header.className = "navbar-top glass";

  const toggles = document.createElement("div");
  toggles.className = "navbar-top-toggles";
  toggles.append(
    createPanelToggle("left", "Alternar painel esquerdo", ICONS.panelLeft),
    createPanelToggle("right", "Alternar painel direito", ICONS.panelRight),
  );

  const actions = document.createElement("div");
  actions.className = "navbar-top-actions";
  for (const spec of ACTIONS) {
    actions.append(createActionButton(spec, callbacks));
  }

  const title = document.createElement("input");
  title.type = "text";
  title.className = "project-title";
  title.value = "Sem título";
  title.setAttribute("aria-label", "Título do projeto");
  title.spellcheck = false;
  title.autocomplete = "off";

  header.append(toggles, actions, title);
  return header;
}
