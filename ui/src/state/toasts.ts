/**
 * Toast queue (A11, DESIGN.md §8.1). Kept out of the components so `tools/`
 * can raise toasts without importing the UI; `components/Toasts.tsx` renders it.
 */
export type ToastKind = "success" | "danger" | "info";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: readonly Toast[]): void {
  toasts = next;
  listeners.forEach((l) => l());
}

/** Queues a toast; `Toasts` animates it in and dismisses it after 3s. */
export function showToast(message: string, kind: ToastKind = "info"): void {
  set([...toasts, { id: nextId++, message, kind }]);
}

export function dismissToast(id: number): void {
  set(toasts.filter((t) => t.id !== id));
}

export const toastStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: (): readonly Toast[] => toasts,
};
