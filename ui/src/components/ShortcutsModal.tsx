/** "Atalhos" modal (Fase 8): the full shortcut table of UX.md §4. */
import { Modal } from "./Modal";

const SHORTCUTS: ReadonlyArray<[keys: string, action: string]> = [
  ["Ctrl/Cmd + S", "Guardar"],
  ["Ctrl/Cmd + Shift + S", "Guardar como"],
  ["Ctrl/Cmd + O", "Abrir"],
  ["Ctrl/Cmd + E", "Exportar .glb"],
  ["Ctrl/Cmd + I", "Importar .glb"],
  ["Ctrl/Cmd + Z", "Desfazer"],
  ["Ctrl/Cmd + Shift + Z", "Refazer"],
  ["Ctrl/Cmd + C / V", "Copiar / colar selecionado"],
  ["Ctrl/Cmd + D", "Duplicar selecionado"],
  ["Delete / Backspace", "Eliminar selecionado"],
  ["B", "Pincel de terreno"],
  ["C", "Ferramenta cabo"],
  ["M", "Ferramenta marcador"],
  ["R", "Ferramenta régua"],
  ["G", "Mostrar/esconder grelha"],
  ["W / E / T", "Gizmo: mover / rodar / escalar"],
  ["L", "Painel de camadas"],
  ["Esc", "Cancelar ferramenta/seleção"],
  ["↑ / ↓", "Ajustar o spinner focado"],
  ["Shift + ↑/↓", "Passo ×10"],
  ["Alt + ↑/↓", "Passo ÷10"],
  ["F", "Focar câmara no selecionado"],
  ["1 / 2 / 3", "Vista topo / frente / isométrica"],
  ["Home", "Repor câmara"],
  ["?", "Este menu de atalhos"],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Atalhos de teclado" onDismiss={onClose} wide>
      <table className="shortcuts-table">
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <th scope="row">
                <kbd>{keys}</kbd>
              </th>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
