import { useSyncExternalStore } from "react";

import { store } from "./store";

/**
 * Re-renders the calling component on every store notification. The store
 * mutates its objects in place, so the snapshot is the notification counter;
 * read the actual values straight from `store` during render.
 */
export function useStore(): typeof store {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}
