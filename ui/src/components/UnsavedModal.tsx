/** Unsaved-changes prompt before closing or opening another project (Fase 8). */
import type { ProjectActions } from "../tools/project-io";
import { t } from "../state/i18n";
import { Modal } from "./Modal";

export function UnsavedModal({ project }: { project: ProjectActions }) {
  return (
    <Modal title={t("unsaved.title")} onDismiss={() => void project.resolveUnsaved("cancel")}>
      <p className="modal__text">{t("unsaved.text")}</p>
      <div className="modal__actions">
        <button
          type="button"
          className="modal__button modal__button--danger"
          onClick={() => void project.resolveUnsaved("discard")}
        >
          {t("unsaved.discard")}
        </button>
        <button
          type="button"
          className="modal__button"
          onClick={() => void project.resolveUnsaved("cancel")}
        >
          {t("unsaved.cancel")}
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void project.resolveUnsaved("save")}
        >
          {t("unsaved.save")}
        </button>
      </div>
    </Modal>
  );
}
