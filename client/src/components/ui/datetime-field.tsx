/**
 * DateTimeField — `DateField`'s sibling for a date AND a time, day-first.
 *
 * WHY IT EXISTS. `<input type="datetime-local">` has precisely the defect
 * `<input type="date">` has: it renders its DATE part in the operating system's
 * locale, so a US-configured workstation shows "09/11/2026, 02:00 PM" for the
 * 11th of September and there is no attribute that overrides it. The native
 * date-input ban missed these at first only because they carry a different
 * `type` — which is why `scripts/check-date-format.js` now bans both.
 *
 * The stored value stays `YYYY-MM-DDTHH:mm`, exactly what the native control
 * emitted and what the API already accepts, so no call site changes shape.
 *
 * Time is 24-hour. These are operational timestamps — a scheduled send, a
 * vessel ETA, when an incident happened — and 14:00 cannot be misread the way
 * a "2:00" that lost its AM/PM can.
 *
 * Everything else follows `date-field.tsx`, including WHY the constraints live
 * on the visible text box rather than on the hidden native input: a hidden
 * control that fails validation blocks submit with the browser's own "not
 * focusable" error and no message anyone can act on. Read that file first.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { CalendarIcon } from "@/components/ui/icons";
import { tr } from "@/lib/i18n";
import {
  isoToDisplayDateTime,
  displayToIsoDateTime,
  maskDateTimeInput,
  validityMessageDateTime,
} from "@/lib/day-first-date";

type DateTimeFieldProps = {
  /** The stored value: ISO `YYYY-MM-DDTHH:mm`, or "" when unset. */
  value: string;
  /** Called with a valid ISO date-time, or "" while incomplete/cleared. */
  onChange: (iso: string) => void;
  id?: string;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  disabled?: boolean;
  required?: boolean;
  /** Earliest / latest accepted, ISO `YYYY-MM-DDTHH:mm`. */
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
} & React.AriaAttributes;

export const DateTimeField = React.forwardRef<
  HTMLInputElement,
  DateTimeFieldProps
>(function DateTimeField(
  {
    value,
    onChange,
    id,
    name,
    onBlur,
    disabled,
    required,
    min,
    max,
    placeholder = tr("dd/mm/yyyy HH:mm"),
    className,
    ...aria
  },
  forwardedRef,
) {
  const [text, setText] = React.useState(() => isoToDisplayDateTime(value));
  const nativeRef = React.useRef<HTMLInputElement>(null);
  const textRef = React.useRef<HTMLInputElement | null>(null);

  // Re-sync from the outside, but never mid-type: while the operator is
  // part-way through, `value` is "" and rewriting the box eats their keystrokes.
  React.useEffect(() => {
    setText((prev) =>
      displayToIsoDateTime(prev) === value ? prev : isoToDisplayDateTime(value),
    );
  }, [value]);

  React.useEffect(() => {
    textRef.current?.setCustomValidity(
      validityMessageDateTime(text, displayToIsoDateTime(text), {
        required,
        min,
        max,
        t: tr,
      }),
    );
  }, [text, required, min, max]);

  function openPicker() {
    const el = nativeRef.current as
      | (HTMLInputElement & { showPicker?: () => void })
      | null;
    if (!el) return;
    // The fallback lives INSIDE the catch rather than after it. Not a style
    // choice: a catch whose body is only a comment is a SILENT catch, and R1
    // (doc/ERROR_HANDLING.md) wants either a taxonomy marker or real handling.
    // None of storage/parse/teardown describes "the engine refused to open a
    // picker without a user gesture", and picking one to quiet the rule would
    // put a lie in a comment. There IS real handling here — it was just written
    // one line too low.
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
      <Input
        id={id}
        name={name}
        ref={(node: HTMLInputElement | null) => {
          textRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        required={required}
        onBlur={onBlur}
        onChange={(e) => {
          const next = maskDateTimeInput(e.target.value);
          setText(next);
          onChange(displayToIsoDateTime(next));
        }}
        className="pr-10"
        {...aria}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        disabled={disabled}
        onClick={openPicker}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <CalendarIcon width={16} height={16} />
      </button>
      {/* Present only to lend its picker — see date-field.tsx. No `required`
          here: a hidden invalid control blocks submit with no visible message. */}
      <input
        ref={nativeRef}
        type="datetime-local"
        aria-hidden
        tabIndex={-1}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          setText(isoToDisplayDateTime(e.target.value));
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-10 opacity-0"
      />
    </div>
  );
});
