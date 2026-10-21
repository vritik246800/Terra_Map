/** Crash recovery prompt on start (Fase 8, Q_LIST.md Q10) — a choice is required. */
import type { ProjectActions } from "../tools/project-io";
import { Modal } from "./Modal";

export function RecoveryModal({ project }: { project: ProjectActions }) {
  return (
    <Modal title="Recuperar trabalho não guardado?">
      <p className="modal__text">
        A aplicação fechou sem guardar. Há uma cópia automática do último trabalho.
      </p>
      <div className="modal__actions">
        <button
          type="button"
          className="modal__button"
          onClick={() => void project.resolveRecovery("discard")}
        >
          Descartar
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void project.resolveRecovery("recover")}
        >
          Recuperar
        </button>
      </div>
    </Modal>
  );
}
