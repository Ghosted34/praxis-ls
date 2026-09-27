/**
 * A letterhead colour: a swatch, the value as text, and a way back to the
 * default.
 *
 * Meeting 5 (21 Sep 2026, 00:41:19): typing black into the letterhead's brand
 * colour was refused ("we cannot use black — that black doesn't exist"),
 * because the box only took `#RRGGBB`, and there was no way back to "the colour
 * that was there before". Now:
 *
 *   - any colour is accepted — a name (black, noir), a hex with or without its
 *     "#", the 3-digit shorthand — and stored as `#rrggbb` by the shared
 *     `entityCommon.colourInput`, the same function the API validates with;
 *   - the swatch opens the system picker, so nobody needs a code at all;
 *   - "Default" clears the field, which prints the default colour again;
 *   - the colour is used EXACTLY for rules and fills. Text set in it ("Brand
 *     colour" tone) prints in a readable variant when the colour itself would
 *     be too light on white paper — the note says so, and shows it.
 */
import { entityCommon } from "@shared";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseHex, toAccessibleInk, type Rgb } from "@/lib/theme";

const PAPER: Rgb = [255, 255, 255];
const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/** The readable-on-white variant of a colour, or null when it already reads. */
export function printInk(value: string): string | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  const ink = hex(toAccessibleInk(rgb, [PAPER]));
  return ink.toLowerCase() === value.toLowerCase() ? null : ink;
}

export function BrandColourField({
  value,
  fallback,
  readOnly,
  onChange,
  ariaLabel,
}: {
  /** The draft text — possibly mid-typing, possibly a name. */
  value: string;
  /** What prints when the field is empty. */
  fallback: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const resolved = entityCommon.colourInput(value);
  const shown = resolved || fallback;
  const invalid = value.trim() !== "" && !resolved;
  const ink = printInk(shown);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {/* The system picker. Seeded with what actually prints — never a
            placeholder black, which made choosing black a no-op. */}
        <input
          type="color"
          value={shown}
          disabled={readOnly}
          aria-label={`${ariaLabel} — ${tr("picker")}`}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 flex-none cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-default"
        />
        <Input
          value={value}
          placeholder={fallback}
          readOnly={readOnly}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          // Normalised on leaving the field, so "black" becomes #000000 in
          // front of the person rather than silently on the server.
          onBlur={() => {
            if (resolved && resolved !== value) onChange(resolved);
          }}
        />
        {!readOnly && value.trim() !== "" && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>
            {tr("Default")}
          </Button>
        )}
      </div>
      {invalid && (
        <p className="micro text-destructive">
          {tr("Not a colour we recognise — use a name like black, or a code like #C2703D.")}
        </p>
      )}
      {!invalid && ink && (
        <p className="micro flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border"
            style={{ background: ink }}
          />
          {tr("Rules print in your colour; text in it prints as")} {ink}{" "}
          {tr("so it stays readable on white paper.")}
        </p>
      )}
    </div>
  );
}
