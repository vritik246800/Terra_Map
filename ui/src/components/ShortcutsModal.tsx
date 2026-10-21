/** "Atalhos" modal (Fase 8): the full shortcut table of UX.md §4 (Fase 13: keyboard navigation). */
import { t, type MessageKey } from "../state/i18n";
import { Modal } from "./Modal";

/** Key combination (literal, or a key of `shortcuts.keys` when it has words) + action. */
const SHORTCUTS: ReadonlyArray<[keys: string, action: MessageKey]> = [
  ["Ctrl/Cmd + S", "shortcuts.actions.save"],
  ["Ctrl/Cmd + Shift + S", "shortcuts.actions.saveAs"],
  ["Ctrl/Cmd + O", "shortcuts.actions.open"],
  ["Ctrl/Cmd + E", "shortcuts.actions.exportGlb"],
  ["Ctrl/Cmd + I", "shortcuts.actions.importGlb"],
  ["Ctrl/Cmd + Z", "shortcuts.actions.undo"],
  ["Ctrl/Cmd + Shift + Z", "shortcuts.actions.redo"],
  ["Ctrl/Cmd + C / V", "shortcuts.actions.copyPaste"],
  ["Ctrl/Cmd + D", "shortcuts.actions.duplicate"],
  ["Delete / Backspace", "shortcuts.actions.delete"],
  ["B", "shortcuts.actions.brush"],
  ["C", "shortcuts.actions.cable"],
  ["M", "shortcuts.actions.marker"],
  ["R", "shortcuts.actions.ruler"],
  ["G", "shortcuts.actions.grid"],
  ["W / E / T", "shortcuts.actions.gizmo"],
  ["L", "shortcuts.actions.layers"],
  ["Esc", "shortcuts.actions.escape"],
  ["↑ / ↓", "shortcuts.actions.spinner"],
  ["Shift + ↑/↓", "shortcuts.actions.step10"],
  ["Alt + ↑/↓", "shortcuts.actions.step01"],
  ["F", "shortcuts.actions.focus"],
  ["1 / 2 / 3", "shortcuts.actions.views"],
  ["Home", "shortcuts.actions.home"],
  ["N / Shift + N", "shortcuts.actions.next"],
  ["Tab / Shift + Tab", "shortcuts.actions.tab"],
  ["shortcuts.keys.space", "shortcuts.actions.space"],
  ["shortcuts.keys.arrows", "shortcuts.actions.arrows"],
  ["shortcuts.keys.shiftArrows", "shortcuts.actions.shiftArrows"],
  ["shortcuts.keys.zoom", "shortcuts.actions.zoom"],
  ["?", "shortcuts.actions.help"],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("shortcuts.title")} onDismiss={onClose} wide>
      <table className="shortcuts-table">
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <th scope="row">
                <kbd>{keys.startsWith("shortcuts.") ? t(keys as MessageKey) : keys}</kbd>
              </th>
              <td>{t(action)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
