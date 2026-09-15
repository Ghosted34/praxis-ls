/**
 * DateField — a date input that reads and writes day-first (dd/mm/yyyy),
 * whatever the browser or operating-system locale happens to be.
 *
 * WHY IT EXISTS. A native `<input type="date">` always renders in the OS
 * locale: on a US-configured machine that is mm/dd/yyyy, and there is no HTML
 * attribute that overrides it (`lang` is ignored for the value display). For a
 * Central-African audience that reads and writes dates day-first, that mismatch
 * is a daily papercut on every KYC / compliance form — the operator types 03/07
 * meaning the 3rd of July and the control reads it as the 7th of March.
 *
 * This control shows and accepts dd/mm/yyyy, formats the slashes as the operator
 * types, and still stores the ISO `YYYY-MM-DD` the API wants — so nothing
 * downstream changes. The calendar button opens the platform date picker for
 * anyone who would rather click than type; whichever they use, the two stay in
 * sync.
 *
 * ── IT IS THE ONLY DATE CONTROL ────────────────────────────────────────────
 *
 * `scripts/check-date-format.js` fails the build on a native `type="date"`
 * anywhere outside this file, so this is not a component you may choose: it is
 * the one implementation. That means it has to cover what the native control
 * covered, or a call site has a reason to reach past it. Hence `min`/`max`,
 * `required`, `name`/`onBlur` and a forwarded ref — the react-hook-form
 * `{...field}` spread works on it unchanged.
 *
 * ── HOW THE CONSTRAINTS ARE ENFORCED, AND WHY NOT ON THE NATIVE INPUT ──────
 *
 * The obvious place for `required`/`min`/`max` is the hidden native input that
 * lends its calendar. It is the wrong place: a hidden control that fails
 * constraint validation blocks submit with the browser's own
 * "An invalid form control is not focusable" and no visible message — the form
 * simply stops, pointing at nothing. So the constraints live on the visible
 * text box via `setCustomValidity`, which is focusable, carries a sentence the
 * operator can act on, and reports through the same `:invalid` path the rest of
 * the form uses.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { CalendarIcon } from "@/components/ui/icons";
import { tr } from "@/lib/i18n";
import {
  isoToDisplay,
  displayToIso,
  maskInput,
  validityMessage,
} from "@/lib/day-first-date";

type DateFieldProps = {
  /** The stored value: ISO `YYYY-MM-DD`, or "" when unset. */
  value: string;
  /** Called with a valid ISO date, or "" while the field is incomplete/cleared. */
  onChange: (iso: string) => void;
  id?: string;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  disabled?: boolean;
  required?: boolean;
  /** Earliest / latest date accepted, ISO `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
} & React.AriaAttributes;

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
  function DateField(
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
      // Translated so the box and the validation message name the SAME format —
  // a French operator reads "jj/mm/aaaa" in both, not one of each.
  placeholder = tr("dd/mm/yyyy"),
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const [text, setText] = React.useState(() => isoToDisplay(value));
    const nativeRef = React.useRef<HTMLInputElement>(null);
    const textRef = React.useRef<HTMLInputElement | null>(null);

    // Re-sync the visible text when the stored value changes from the outside
    // (a form reset, an edit seeded from the API) — but never mid-type: while the
    // operator is part-way through a date, `value` is still "" and clobbering the
    // box would delete their keystrokes.
    React.useEffect(() => {
      setText((prev) =>
        displayToIso(prev) === value ? prev : isoToDisplay(value),
      );
    }, [value]);

    // Constraint validation, re-applied whenever the text or a bound changes.
    // `setCustomValidity` is a DOM call rather than a render output, so it has
    // to run in an effect — and it must run on the MOUNT too, or a required
    // field that was never touched submits empty.
    React.useEffect(() => {
      const el = textRef.current;
      if (!el) return;
      el.setCustomValidity(
        validityMessage(text, displayToIso(text), { required, min, max, t: tr }),
      );
    }, [text, required, min, max]);

    function onText(raw: string) {
      const next = maskInput(raw);
      setText(next);
      onChange(displayToIso(next));
    }

    function openPicker() {
      const el = nativeRef.current as
        | (HTMLInputElement & { showPicker?: () => void })
        | null;
      if (!el) return;
      // showPicker() is the only way to surface the native calendar for a control
      // the operator drives by text; where it is unavailable, focusing the hidden
      // native input still lets the platform offer its own affordance.
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
          onChange={(e) => onText(e.target.value)}
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
        {/* The native date input is present only to lend its calendar popup; it is
            layered, invisible, over the button so `showPicker()` anchors there.
            It carries no id/label of its own — the text box above is the field,
            and no `required` either (see the header: a hidden invalid control
            blocks submit with a message nobody can see). `min`/`max` DO belong
            here, where they grey out the days the picker must not offer. */}
        <input
          ref={nativeRef}
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
  },
);
