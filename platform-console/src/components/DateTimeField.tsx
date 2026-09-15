/**
 * DateTimeField — the console's day-first date-and-time control.
 *
 * `<input type="datetime-local">` renders its DATE part in the operating
 * system's locale, so a US-configured workstation shows "09/11/2026, 02:00 PM"
 * for the 11th of September. A maintenance window announced for the wrong day
 * is the kind of mistake that is only discovered by the tenants it surprises.
 *
 * Stores `YYYY-MM-DDTHH:mm` — what the native control emitted and what the API
 * already accepts. Conversion comes from `lib/day-first-date.ts`, kept
 * byte-identical to the client's copy by `scripts/check-date-format.js`; see
 * that file's header for why it is a copy and not an import.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  isoToDisplayDateTime,
  displayToIsoDateTime,
  maskDateTimeInput,
  validityMessageDateTime,
} from "@/lib/day-first-date";

export function DateTimeField({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  style,
  "aria-label": ariaLabel,
}: {
  /** The stored value: ISO `YYYY-MM-DDTHH:mm`, or "" when unset. */
  value: string;
  /** Called with a valid ISO date-time, or "" while incomplete/cleared. */
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() => isoToDisplayDateTime(value));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText((prev) =>
      displayToIsoDateTime(prev) === value ? prev : isoToDisplayDateTime(value),
    );
  }, [value]);

  useEffect(() => {
    ref.current?.setCustomValidity(
      validityMessageDateTime(text, displayToIsoDateTime(text), { required, min, max }),
    );
  }, [text, required, min, max]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy HH:mm"
      value={text}
      required={required}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = maskDateTimeInput(e.target.value);
        setText(next);
        onChange(displayToIsoDateTime(next));
      }}
      style={style}
    />
  );
}
