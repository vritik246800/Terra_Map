/**
 * Toast stack — animation A11 (DESIGN.md §8.1): slide-up + fade in, auto
 * dismiss after 3s. Bottom-center so it never collides with the FAB.
 * Variants use the tokens `--ok` / `--danger` / `--accent` (§7.1).
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { a11In, a11Out } from "../anim/ui";
import { dismissToast, toastStore, type Toast } from "../state/toasts";
import "./toast.css";

const A11_HOLD_MS = 3000;

function ToastItem({ toast }: { toast: Toast }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    a11In(el);
    const timer = window.setTimeout(() => a11Out(el, () => dismissToast(toast.id)), A11_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id]);

  return (
    <div
      ref={ref}
      className={`toast toast--${toast.kind}`}
      role={toast.kind === "danger" ? "alert" : "status"}
    >
      {toast.message}
    </div>
  );
}

export function Toasts() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.get);
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
