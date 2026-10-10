import { inr } from "@/lib/format";

interface Common {
  id: string;
  label: string;
  error?: string;
  help?: string;
}

export function TextField({ id, label, value, onChange, error, help, placeholder, maxLength }: Common & {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input" value={value} placeholder={placeholder} maxLength={maxLength}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}
        onChange={(e) => onChange(e.target.value)} />
      {help && !error && <p id={`${id}-help`} className="help">{help}</p>}
      {error && <p id={`${id}-err`} className="err" role="alert">{error}</p>}
    </div>
  );
}

/** Numeric text input (digits only). `money` shows an Indian-format preview. */
export function NumberField({ id, label, value, onChange, error, help, money }: Common & {
  value: string; onChange: (v: string) => void; money?: boolean;
}) {
  const n = value === "" ? null : Number(value);
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input" inputMode="numeric" value={value}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : `${id}-help`}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))} />
      <p id={`${id}-help`} className="help">
        {money && n !== null ? <strong>{inr(n)}</strong> : null}
        {money && n !== null && help ? " · " : null}
        {help}
      </p>
      {error && <p id={`${id}-err`} className="err" role="alert">{error}</p>}
    </div>
  );
}

export function SelectField({ id, label, value, onChange, options, error, help }: Common & {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p className="help">{help}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
