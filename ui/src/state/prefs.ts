/**
 * App preferences that are not part of the project (Fase 17, like the theme):
 * «Snap buildings to roads» (Q_LIST.md Q40) — on by default, saved locally.
 */
import { store } from "./store";

const SNAP_KEY = "terra-map.snapToRoads";

function initialSnap(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== "0";
  } catch {
    return true; // storage blocked: default
  }
}

let snapToRoads = initialSnap();

export const prefs = {
  /** Houses and buildings only go next to a road, facing it. */
  get snapToRoads(): boolean {
    return snapToRoads;
  },

  setSnapToRoads(on: boolean): void {
    snapToRoads = on;
    try {
      localStorage.setItem(SNAP_KEY, on ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts for this session
    }
    store.notifyChange();
  },
};
