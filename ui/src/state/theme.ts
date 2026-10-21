/**
 * Light/dark theme (Fase 13, DESIGN.md §3, Q_LIST.md Q27): only tokens change
 * (`[data-theme="dark"]` in style.css). Local app preference; the first run
 * follows `prefers-color-scheme`. The A23 fade is played by the top bar.
 */
import { store } from "./store";

export type Theme = "light" | "dark";

const STORAGE_KEY = "terra-map.theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage blocked: fall back to the system theme
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let current: Theme = initialTheme();
document.documentElement.dataset.theme = current;

export const theme = {
  get current(): Theme {
    return current;
  },

  toggle(): void {
    current = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = current;
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // storage blocked: the choice lasts for this session
    }
    store.notifyChange();
  },
};
