/**
 * DateField — the console's day-first date control.
 *
 * WHY IT EXISTS. A native `<input type="date">` renders in the operating
 * system's locale, so on a US-configured machine it shows and accepts
 * mm/dd/yyyy with no HTML attribute that can override it. Praxis is read
 * day-first, and an Error Command Center filter that says 10/09 when the
 * operator meant the 10th of September points the whole investigation at the
 * wrong week. `scripts/check-date-format.js` fails the build on a native date
 * input, here as well as in the tenant client.
 *
 * WHY IT IS A SECOND FILE AND NOT A SECOND IMPLEMENTATION. The console is
 * plain CSS and has no `Input` primitive, so the markup cannot be shared with
 * the client's `DateField`. What CAN drift is the part that matters — what
 * counts as a real date, and how dd/mm/yyyy maps to ISO — and that lives in
 * `lib/day-first-date.ts`, which is kept byte-identical to the client's copy by
 * the same gate. See that file's header for why it is a copy and not an import:
 * the Dockerfile's console build stage copies only `platform-console/`, so a
 * relative import into `client/` builds locally and then fails in the image.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  isoToDisplay,
  displayToIso,
  maskInput,
  validityMessage,
} from "@/lib/day-first-date";

export function DateField({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  style,
  "aria-label": ariaLabel,
}: {
  /** The stored value: ISO `YYYY-MM-DD`, or "" when unset. */
  value: string;
  /** Called with a valid ISO date, or "" while incomplete/cleared. */
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const ref = useRef<HTMLInputElement>(null);

  // Re-sync from the outside (a reset, a seeded filter) but never mid-type:
  // while the operator is part-way through, `value` is "" and rewriting the box
  // would eat their keystrokes.
  useEffect(() => {
    setText((prev) => (displayToIso(prev) === value ? prev : isoToDisplay(value)));
  }, [value]);

  useEffect(() => {
    ref.current?.setCustomValidity(
      validityMessage(text, displayToIso(text), { required, min, max }),
    );
  }, [text, required, min, max]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      value={text}
      required={required}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = maskInput(e.target.value);
        setText(next);
        onChange(displayToIso(next));
      }}
      style={style}
    />
  );
}
