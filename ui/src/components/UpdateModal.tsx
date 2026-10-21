/** Update notice (Fase 14, Q_LIST.md Q29) — optional: «Later», `Esc` or the backdrop close it. */
import { t } from "../state/i18n";
import { update } from "../tools/update-check";
import { Modal } from "./Modal";

export function UpdateModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("update.title")} onDismiss={onClose}>
      <p className="modal__text">{t("update.text", { version: update.tag })}</p>
      <div className="modal__actions">
        <button type="button" className="modal__button" onClick={onClose}>
          {t("update.later")}
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void update.download()}
        >
          {t("update.download")}
        </button>
      </div>
    </Modal>
  );
}
