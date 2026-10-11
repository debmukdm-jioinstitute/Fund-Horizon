import { inr } from "@/lib/format";

interface Common {
  id: string;
  label: string;
  error?: string;
  help?: string;
  disabled?: boolean;
}

function describedBy(id: string, error?: string, hasHelp?: boolean): string | undefined {
  const ids = [error ? `${id}-err` : null, hasHelp ? `${id}-help` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function TextField({ id, label, value, onChange, error, help, placeholder, maxLength, disabled, autoComplete }: Common & {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input disabled:bg-navy-50 disabled:text-navy-700" value={value} placeholder={placeholder}
        maxLength={maxLength} disabled={disabled} autoComplete={autoComplete}
        aria-invalid={!!error} aria-describedby={describedBy(id, error, !!help && !error)}
        onChange={(e) => onChange(e.target.value)} />
      {help && !error && <p id={`${id}-help`} className="help">{help}</p>}
      {error && <p id={`${id}-err`} className="err" role="alert">{error}</p>}
    </div>
  );
}

/** Numeric text input (digits only). `money` shows an Indian-format preview. */
export function NumberField({ id, label, value, onChange, error, help, money, disabled }: Common & {
  value: string; onChange: (v: string) => void; money?: boolean;
}) {
  const n = value === "" ? null : Number(value);
  const hasHelp = Boolean(help) || (Boolean(money) && n !== null);
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-700"
        inputMode="numeric" value={value} disabled={disabled} readOnly={disabled}
        aria-invalid={!!error} aria-describedby={describedBy(id, error, hasHelp)}
        aria-readonly={disabled || undefined}
        onChange={(e) => { if (!disabled) onChange(e.target.value.replace(/[^0-9]/g, "")); }} />
      {hasHelp && (
        <p id={`${id}-help`} className="help">
          {money && n !== null ? <strong>{inr(n)}</strong> : null}
          {money && n !== null && help ? " · " : null}
          {help}
        </p>
      )}
      {error && <p id={`${id}-err`} className="err" role="alert">{error}</p>}
    </div>
  );
}

export function SelectField({ id, label, value, onChange, options, error, help, disabled }: Common & {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} className="input disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-700"
        value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error} aria-describedby={describedBy(id, error, !!help)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p id={`${id}-help`} className="help">{help}</p>}
      {error && <p id={`${id}-err`} className="err" role="alert">{error}</p>}
    </div>
  );
}
