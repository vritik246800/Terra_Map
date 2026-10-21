/** "Guia do programa" modal (Fase 8): the basic workflow in illustrated steps. */
import type { ReactNode } from "react";

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

const STEPS: ReadonlyArray<{ title: string; text: string; icon: ReactNode }> = [
  {
    title: "Terreno",
    text: "No grupo Terreno escolhe Plano, Montanhas, Vale ou Personalizado. Esculpe com o Pincel (B); Shift baixa o relevo.",
    icon: <path d="M2 19 9 8l4 6 3-4 6 9z" />,
  },
  {
    title: "Infraestruturas",
    text: "Arrasta casas, prédios e lotes para o terreno. Edita fase, posição, rotação e escala no painel direito; W/E/T mudam o gizmo.",
    icon: <path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6" />,
  },
  {
    title: "Rede",
    text: "Arrasta OLT, splitters, ONU e antenas. Liga-os com a ferramenta Cabo (C): clique na origem e depois no destino.",
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
    title: "Propriedades",
    text: "Cada elemento e cabo tem propriedades dinâmicas (bandwidth, latency, power…) que alimentam o simulador.",
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="7" cy="18" r="2" />
      </>
    ),
  },
  {
    title: "Simular",
    text: "No painel, marca Origem e Destino e carrega em Calcular. «Em falha» testa a rota alternativa; nas antenas, Simular cobertura.",
    icon: <path d="M3 17c4 0 4-10 9-10s5 10 9 10" />,
  },
  {
    title: "Guardar",
    text: "Ctrl/Cmd+S guarda o projeto (.json). Há uma cópia automática a cada minuto para recuperar depois de um crash.",
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
    <Modal title="Guia do programa" onDismiss={onClose} wide>
      <ol className="guide-steps">
        {STEPS.map(({ title, text, icon }, i) => (
          <li key={title} className="guide-steps__item">
            <Icon>{icon}</Icon>
            <div>
              <h3 className="guide-steps__title">
                {i + 1}. {title}
              </h3>
              <p className="guide-steps__text">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
