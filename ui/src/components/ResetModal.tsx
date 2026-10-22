/** History › Reset confirmation (Fase 17, Q_LIST.md Q45) — the reset itself is undoable. */
import { t } from "../state/i18n";
import type { ProjectActions } from "../tools/project-io";
import { Modal } from "./Modal";

export function ResetModal({ project, onClose }: { project: ProjectActions; onClose: () => void }) {
  return (
    <Modal title={t("reset.title")} onDismiss={onClose}>
      <p className="modal__text">{t("reset.text")}</p>
      <div className="modal__actions">
        <button type="button" className="modal__button" onClick={onClose}>
          {t("reset.cancel")}
        </button>
        <button
          type="button"
          className="modal__button modal__button--danger"
          onClick={() => {
            onClose();
            void project.resetMap();
          }}
        >
          {t("reset.confirm")}
        </button>
      </div>
    </Modal>
  );
}
