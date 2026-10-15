/**
 * Dynamic key-value properties editor (PLAN.md Fase 6, DESIGN.md §4.2):
 * network elements and cables carry a `dynamicProps` map (`bandwidth`,
 * `latency`, `power`, …) that feeds the Fase 7 simulations.
 *
 * Existing entries edit in place — numbers via Spinner (UX.md §2, no
 * textboxes for numbers), booleans via a Sim/Não toggle, strings via a text
 * input — and each row has a remove button. The add form takes a key and a
 * raw value; the type is inferred from the value (`true`/`false` → boolean,
 * numeric → number, otherwise string — UX.md §2).
 */
import { useState, type KeyboardEvent } from "react";

import type { DynamicValue } from "../state/store";
import { Spinner } from "./Spinner";
import "./dynamic-props-editor.css";

/** Bounds/step of the generic numeric spinner of dynamic props. */
const NUMBER_MIN = -999_999;
const NUMBER_MAX = 999_999;
const NUMBER_STEP = 1;

/** Infers the DynamicValue type from the raw text of the add form. */
function parseValue(raw: string): DynamicValue {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const n = Number(trimmed);
  if (trimmed !== "" && !Number.isNaN(n)) return n;
  return trimmed;
}

export interface DynamicPropsEditorProps {
  props: Record<string, DynamicValue>;
  /** Receives the full next map (entry edited, added or removed). */
  onChange(next: Record<string, DynamicValue>): void;
}

export function DynamicPropsEditor({ props, onChange }: DynamicPropsEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  function write(key: string, value: DynamicValue): void {
    onChange({ ...props, [key]: value });
  }

  function remove(key: string): void {
    const next = { ...props };
    delete next[key];
    onChange(next);
  }

  function addProp(): void {
    const key = newKey.trim();
    if (!key) return;
    onChange({ ...props, [key]: parseValue(newValue) });
    setNewKey("");
    setNewValue("");
  }

  function onAddKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      addProp();
    }
  }

  return (
    <div className="dyn-props">
      {Object.entries(props).map(([key, value]) => (
        <div key={key} className="dyn-props__entry">
          {typeof value === "number" && (
            <div className="dyn-props__row">
              <Spinner
                label={key}
                value={value}
                min={NUMBER_MIN}
                max={NUMBER_MAX}
                step={NUMBER_STEP}
                onChange={(v) => write(key, v)}
              />
              <button
                type="button"
                className="dyn-props__remove"
                aria-label={`Remover ${key}`}
                onClick={() => remove(key)}
              >
                ×
              </button>
            </div>
          )}
          {typeof value === "boolean" && (
            <div className="dyn-props__row">
              <span className="dyn-props__key">{key}</span>
              <button
                type="button"
                className={`dyn-props__toggle${value ? " dyn-props__toggle--on" : ""}`}
                aria-pressed={value}
                onClick={() => write(key, !value)}
              >
                {value ? "Sim" : "Não"}
              </button>
              <button
                type="button"
                className="dyn-props__remove"
                aria-label={`Remover ${key}`}
                onClick={() => remove(key)}
              >
                ×
              </button>
            </div>
          )}
          {typeof value === "string" && (
            <div className="dyn-props__row">
              <span className="dyn-props__key">{key}</span>
              <input
                type="text"
                className="properties-input"
                value={value}
                aria-label={`Valor de ${key}`}
                onChange={(e) => write(key, e.target.value)}
              />
              <button
                type="button"
                className="dyn-props__remove"
                aria-label={`Remover ${key}`}
                onClick={() => remove(key)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="dyn-props__add">
        <input
          type="text"
          className="properties-input"
          placeholder="Chave"
          aria-label="Chave da nova propriedade"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={onAddKeyDown}
        />
        <input
          type="text"
          className="properties-input"
          placeholder="Valor"
          aria-label="Valor da nova propriedade"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={onAddKeyDown}
        />
        <button
          type="button"
          className="properties-action"
          disabled={!newKey.trim()}
          onClick={addProp}
        >
          Adicionar
        </button>
      </div>
      <p className="properties-section__hint">
        O tipo é inferido do valor: número, true/false (booleano) ou texto.
      </p>
    </div>
  );
}
