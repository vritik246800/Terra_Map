/** Unsaved-changes prompt before closing or opening another project (Fase 8). */
import type { ProjectActions } from "../tools/project-io";
import { Modal } from "./Modal";

export function UnsavedModal({ project }: { project: ProjectActions }) {
  return (
    <Modal
      title="Tens alterações por guardar"
      onDismiss={() => void project.resolveUnsaved("cancel")}
    >
      <p className="modal__text">Queres guardar o projeto antes de continuar?</p>
      <div className="modal__actions">
        <button
          type="button"
          className="modal__button modal__button--danger"
          onClick={() => void project.resolveUnsaved("discard")}
        >
          Descartar
        </button>
        <button
          type="button"
          className="modal__button"
          onClick={() => void project.resolveUnsaved("cancel")}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={() => void project.resolveUnsaved("save")}
        >
          Guardar
        </button>
      </div>
    </Modal>
  );
}
