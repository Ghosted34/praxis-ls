/**
 * FontPicker — pick one family from the shipped library (lib/fonts.ts).
 *
 * REUSABLE BY DESIGN. It is a controlled input over a single CSS font-family
 * string and knows nothing about tenants, users or endpoints, so the same
 * component serves the tenant-wide editor (features/settings/appearance-page)
 * and each user's personal override (features/settings/my-appearance) without a
 * variant or a flag. Anything that stores a font stack can mount it.
 *
 * EVERY NAME RENDERS IN ITS OWN FACE — that is the point of the control, not a
 * flourish. Reading "Merriweather" set in Merriweather tells you what you are
 * choosing; reading it in the UI font tells you nothing, which is exactly why
 * the free-text box it replaces was so easy to get wrong. That requires the
 * faces to be present, so mounting the picker loads the whole library (~15
 * chunks, in parallel, off the startup path).
 *
 * CUSTOM VALUES SURVIVE. A stack saved before the library existed, or typed
 * into the advanced escape hatch, is kept and shown as "Custom" rather than
 * being silently rewritten to Inter the first time someone opens the screen and
 * saves. Only an explicit pick changes the value.
 */
import * as React from "react";
import { Select, type SelectOption } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { fontByValue, fontGroups, loadAllFonts, type FontSlot } from "@/lib/fonts";
import { cn } from "@/lib/cn";

/** Sentinel for a stack that matches no library entry. Not a persisted value. */
const CUSTOM = "__custom__";

export function FontPicker({
  slot,
  value,
  onChange,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  /** Which token this fills. Orders the groups so the apt one leads. */
  slot: FontSlot;
  /** The persisted CSS font-family string ("" = inherit the default). */
  value: string;
  onChange: (stack: string) => void;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  // Load the library on mount rather than on open. Opening a dropdown and
  // watching fifteen names reflow from system-ui into their real faces looks
  // broken; by the time anyone clicks, the faces are there.
  React.useEffect(() => {
    void loadAllFonts();
  }, []);

  const selected = fontByValue(value);
  const isCustom = Boolean(value) && !selected;
  const [showAdvanced, setShowAdvanced] = React.useState(isCustom);

  const options: SelectOption[] = React.useMemo(() => {
    const out: SelectOption[] = [];
    for (const group of fontGroups(slot)) {
      for (const font of group.fonts) {
        out.push({
          value: font.id,
          group: group.label,
          // 15px: the names are the preview, and several of these families
          // (Montserrat, Merriweather) only show their character above the 13px
          // the shell runs at.
          label: (
            <span style={{ fontFamily: font.stack, fontSize: 15 }} className="truncate">
              {font.name}
            </span>
          ),
          // Type-ahead has to match the NAME. Without this Radix would fall
          // back to the option's value, so typing "mer" would not find
          // Merriweather in a fifteen-item list.
          text: font.name,
          hint: font.note,
        });
      }
    }
    if (isCustom) {
      out.push({
        value: CUSTOM,
        group: "Custom",
        label: <span style={{ fontFamily: value, fontSize: 15 }} className="truncate">Custom</span>,
        text: "Custom",
        hint: value,
      });
    }
    return out;
  }, [slot, isCustom, value]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Select
        id={id}
        aria-label={ariaLabel}
        value={selected ? selected.id : isCustom ? CUSTOM : ""}
        placeholder="Use the default"
        options={options}
        onValueChange={(id) => {
          if (id === CUSTOM) return; // display-only; edited through the field below
          const font = fontGroups(slot)
            .flatMap((g) => g.fonts)
            .find((f) => f.id === id);
          if (font) onChange(font.stack);
        }}
      />

      {/* The escape hatch. Kept because a white-label product will eventually
          meet a tenant with a licensed corporate typeface served from their own
          CDN, and a closed list with no way out would make this screen a dead
          end for them. Collapsed by default so it never reads as the main path;
          auto-opened when the current value IS custom, so nobody has to hunt
          for where their existing setting went. */}
      {showAdvanced ? (
        <div className="flex flex-col gap-1">
          <Input
            aria-label="Custom CSS font-family"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='"Acme Grotesk", system-ui, sans-serif'
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            A raw CSS font-family. Only renders where the font is installed or self-hosted — the library
            above is guaranteed on every device.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Use a custom font stack
        </button>
      )}
    </div>
  );
}

export default FontPicker;
