/**
 * Segmented picker (Fase 6; shared with the simulator in Fase 7): same look
 * as the phase stepper, one active option. Styles live in right-panel.css.
 */
export function SegmentedPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Record<T, string>;
  value: T;
  onChange(next: T): void;
}) {
  return (
    <div className="segmented-picker">
      <span className="segmented-picker__label">{label}</span>
      <div className="phase-stepper" role="group" aria-label={label}>
        {(Object.keys(options) as T[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`phase-stepper__button${option === value ? " phase-stepper__button--active" : ""}`}
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {options[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
