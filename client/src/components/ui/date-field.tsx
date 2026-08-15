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
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { CalendarIcon } from "@/components/ui/icons";

/** ISO `YYYY-MM-DD` → display `dd/mm/yyyy` (empty for anything else). */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Display `dd/mm/yyyy` → ISO `YYYY-MM-DD`, or "" when incomplete/impossible.
 *  The round-trip check rejects a real-looking-but-invalid date like 31/02. */
function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return "";
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  )
    return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Keep only digits and re-insert the slashes as the operator types. */
function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

type DateFieldProps = {
  /** The stored value: ISO `YYYY-MM-DD`, or "" when unset. */
  value: string;
  /** Called with a valid ISO date, or "" while the field is incomplete/cleared. */
  onChange: (iso: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
} & React.AriaAttributes;

export function DateField({
  value,
  onChange,
  id,
  disabled,
  placeholder = "dd/mm/yyyy",
  className,
  ...aria
}: DateFieldProps) {
  const [text, setText] = React.useState(() => isoToDisplay(value));
  const nativeRef = React.useRef<HTMLInputElement>(null);

  // Re-sync the visible text when the stored value changes from the outside
  // (a form reset, an edit seeded from the API) — but never mid-type: while the
  // operator is part-way through a date, `value` is still "" and clobbering the
  // box would delete their keystrokes.
  React.useEffect(() => {
    setText((prev) =>
      displayToIso(prev) === value ? prev : isoToDisplay(value),
    );
  }, [value]);

  function onText(raw: string) {
    const next = maskInput(raw);
    setText(next);
    onChange(displayToIso(next));
  }

  function openPicker() {
    const el = nativeRef.current as
      (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    // showPicker() is the only way to surface the native calendar for a control
    // the operator drives by text; where it is unavailable, focusing the hidden
    // native input still lets the platform offer its own affordance.
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* showPicker throws without a user gesture in some engines — fall through. */
      }
    }
    el.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
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
          It carries no id/label of its own — the text box above is the field. */}
      <input
        ref={nativeRef}
        type="date"
        aria-hidden
        tabIndex={-1}
        value={value}
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
