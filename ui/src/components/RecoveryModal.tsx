/** Crash recovery prompt on start (Fase 8, Q_LIST.md Q10) — a choice is required. */
import type { ProjectActions } from "../tools/project-io";
import { t } from "../state/i18n";
import { Modal } from "./Modal";

export function RecoveryModal({ project }: { project: ProjectActions }) {
  return (
    <Modal title={t("recovery.title")}>
      <p className="modal__text">{t("recovery.text")}</p>
      <div className="modal__actions">
        <button
          type="button"
          className="modal__button"
          onClick={() => void project.resolveRecovery("discard")}
        >
          {t("recovery.discard")}
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void project.resolveRecovery("recover")}
        >
          {t("recovery.recover")}
        </button>
      </div>
    </Modal>
  );
}
