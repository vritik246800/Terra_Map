/**
 * UI strings (UX.md §6): English only (Fase 14, Q_LIST.md Q28).
 *
 * Strings live in `locales/en.json`, the source of the keys — `MessageKey`
 * is checked by TypeScript. `t()` interpolates `{name}` placeholders; `fmt()`
 * formats numbers with a dot (never "-0").
 */
import en from "../locales/en.json";

type Dict = typeof en;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Dict>;

function flatten(obj: object, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else flatten(value as object, `${prefix}${key}.`, out);
  }
  return out;
}

const MESSAGES = flatten(en);

/** Text of `key`, with `{param}` placeholders filled. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = MESSAGES.get(key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** `12.345` → "12.35" with `decimals` places; no grouping. */
export function fmt(value: number, decimals = 0): string {
  const rounded = Number(value.toFixed(decimals)) + 0; // + 0: no "-0"
  return rounded.toLocaleString("en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  });
}
