/**
 * Mounts the modal named by `store.modal` (Fase 8) and plays A10: the shown
 * modal lags the store by the close animation, then the next one opens.
 */
import { useLayoutEffect, useRef, useState } from "react";

import { a10In, a10Out } from "../anim/ui";
import type { ModalId } from "../state/store";
import { useStore } from "../state/use-store";
import type { ProjectActions } from "../tools/project-io";
import { GuideModal } from "./GuideModal";
import { RecoveryModal } from "./RecoveryModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { UnsavedModal } from "./UnsavedModal";

export function ModalHost({ project }: { project: ProjectActions }) {
  const store = useStore();
  const wanted = store.modal;
  const [shown, setShown] = useState<ModalId | null>(wanted);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (wanted === shown) return;
    const el = ref.current;
    if (shown && el?.firstElementChild) {
      return a10Out(el.firstElementChild as HTMLElement, () => setShown(wanted));
    }
    setShown(wanted);
  }, [wanted, shown]);

  useLayoutEffect(() => {
    const root = ref.current?.firstElementChild;
    if (shown && root instanceof HTMLElement) a10In(root);
  }, [shown]);

  const close = () => store.closeModal();
  return (
    <div ref={ref}>
      {shown === "shortcuts" && <ShortcutsModal onClose={close} />}
      {shown === "guide" && <GuideModal onClose={close} />}
      {shown === "recovery" && <RecoveryModal project={project} />}
      {shown === "unsaved" && <UnsavedModal project={project} />}
    </div>
  );
}
