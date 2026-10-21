/**
 * i18n (Fase 13, UX.md §6): pt-PT (default) and English.
 *
 * Strings live in `locales/*.json`; `pt.json` is the source of the keys —
 * `MessageKey` is checked by TypeScript and `en.json` must have the same
 * shape. `t()` interpolates `{name}` placeholders; `fmt()` formats numbers
 * with the language's decimal separator (never "-0"). The choice is a local
 * app preference (`localStorage`, Q_LIST.md Q27); changing it re-renders
 * through the store and keeps `<html lang>` in sync.
 */
import en from "../locales/en.json";
import pt from "../locales/pt.json";
import { store } from "./store";

export type Locale = "pt" | "en";

type Dict = typeof pt;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Dict>;

const english: Dict = en; // fails to compile when en.json misses a key
const STORAGE_KEY = "terra-map.locale";

function flatten(obj: object, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else flatten(value as object, `${prefix}${key}.`, out);
  }
  return out;
}

const MESSAGES: Record<Locale, Map<string, string>> = { pt: flatten(pt), en: flatten(english) };

const tagOf = (l: Locale): string => (l === "pt" ? "pt-PT" : "en");

function storedLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "pt";
  } catch {
    return "pt";
  }
}

let locale: Locale = storedLocale();
document.documentElement.lang = tagOf(locale);

/** Text of `key` in the current language, with `{param}` placeholders filled. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = MESSAGES[locale].get(key) ?? MESSAGES.pt.get(key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** `12.345` → "12,35" (pt) / "12.35" (en) with `decimals` places; no grouping. */
export function fmt(value: number, decimals = 0): string {
  const rounded = Number(value.toFixed(decimals)) + 0; // + 0: no "-0"
  return rounded.toLocaleString(tagOf(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  });
}

export const i18n = {
  get locale(): Locale {
    return locale;
  },

  /** BCP 47 tag of the current language (dates, `<html lang>`). */
  get tag(): string {
    return tagOf(locale);
  },

  setLocale(next: Locale): void {
    if (next === locale) return;
    const untitled = t("app.untitled");
    locale = next;
    document.documentElement.lang = tagOf(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // storage blocked (private mode): the choice lasts for this session
    }
    // A project nobody named yet follows the language.
    if (store.projectName === untitled)
      store.setProjectIdentity(store.projectId, t("app.untitled"));
    store.notifyChange();
  },
};
