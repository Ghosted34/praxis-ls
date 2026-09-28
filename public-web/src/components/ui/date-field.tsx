/**
 * DateField — a date input that reads and writes day-first (dd/mm/yyyy),
 * whatever the browser or operating-system locale happens to be.
 *
 * This app's twin of `client/src/components/ui/date-field.tsx`; read that
 * file's header for the whole argument. In one line: a native
 * `<input type="date">` renders in the OS locale, so on a US-configured phone a
 * client types 03/07 meaning the 3rd of July and the control stores the 7th of
 * March — and nothing downstream can tell. `npm run check:dates` bans the
 * native control everywhere except here, where a hidden one lends only its
 * calendar popup.
 *
 * It stores the ISO `YYYY-MM-DD` the API wants; `onChange` receives "" while
 * the box does not yet hold a real date, so a caller's "ready" check is simply
 * `value !== ""`. Sentences (the placeholder, the calendar button's name) are
 * passed in by the caller from its own dictionary, because this component is
 * shared by surfaces with different dictionaries.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { isoToDisplay, displayToIso, maskInput } from "@/lib/day-first-date";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder: string;
  calendarLabel: string;
  className?: string;
  inputClassName?: string;
  invalid?: boolean;
} & React.AriaAttributes;

export function DateField({
  value,
  onChange,
  id,
  min,
  max,
  disabled,
  placeholder,
  calendarLabel,
  className,
  inputClassName,
  invalid,
  ...aria
}: Props) {
  const [text, setText] = React.useState(() => isoToDisplay(value));
  const native = React.useRef<HTMLInputElement>(null);

  // Follow an outside change (a chip that sets "yesterday") — never mid-type.
  React.useEffect(() => {
    setText((prev) => (displayToIso(prev) === value ? prev : isoToDisplay(value)));
  }, [value]);

  const iso = displayToIso(text);
  const outOfRange = !!iso && ((min && iso < min) || (max && iso > max));

  function openPicker() {
    const el = native.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    if (typeof el.showPicker !== "function") {
      el.focus();
      return;
    }
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        aria-invalid={invalid || (text.length === 10 && (!iso || !!outOfRange)) || undefined}
        className={cn("pr-14", inputClassName)}
        onChange={(e) => {
          const next = maskInput(e.target.value);
          setText(next);
          const out = displayToIso(next);
          onChange(out && !((min && out < min) || (max && out > max)) ? out : "");
        }}
        {...aria}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={calendarLabel}
        disabled={disabled}
        onClick={openPicker}
        className="absolute inset-y-0 right-1.5 my-auto grid h-10 w-10 place-items-center rounded-xl text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {/* Present only to lend its calendar popup; the text box is the field.
          `min`/`max` grey out the days the picker must not offer. */}
      <input
        ref={native}
        type="date"
        aria-hidden
        tabIndex={-1}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          setText(isoToDisplay(e.target.value));
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-10 opacity-0"
      />
    </div>
  );
}
