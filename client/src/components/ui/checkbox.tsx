/**
 * Checkbox and RadioGroup — the two controls the app had no primitive for.
 *
 * The client used bare `<input type="checkbox">` inside a `<label>` at ~30
 * sites, each with its own spacing and none with a shared disabled or
 * indeterminate state. The `<label>`-wrapping pattern does associate correctly,
 * so this is not fixing a broken baseline the way `Field` was — it is removing
 * the per-site restyling and giving the controls a token-based appearance that
 * matches `Input`.
 *
 * Radix carries the ARIA state (`aria-checked`, including "mixed" for
 * indeterminate, which a native checkbox cannot express declaratively) and
 * keeps Space activation and focus behaviour correct on the styled element.
 *
 * @example
 * <Checkbox checked={includeResolved} onCheckedChange={setIncludeResolved} label="Include resolved" />
 *
 * @example  // header checkbox over a partially-selected table
 * <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={toggleAll} label="Select all rows" />
 *
 * BEST PRACTICE. A checkbox needs its own visible label — that is what the
 * `label` prop renders, and it is the click target as well as the accessible
 * name. Use a checkbox for an independent on/off; use `RadioGroup` when exactly
 * one of several must be chosen, and `Segmented` when those choices are a view
 * switch rather than a form value.
 */
import * as React from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixRadio from "@radix-ui/react-radio-group";
import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/ui/icons";

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  id,
  className,
}: {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  /** Visible label AND accessible name. Required — an unlabelled checkbox is
   *  unusable with a screen reader and has a 16px hit target. */
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const uid = React.useId();
  const boxId = id ?? `${uid}-box`;
  const hintId = hint ? `${uid}-hint` : undefined;

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <RadixCheckbox.Root
        id={boxId}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        aria-describedby={hintId}
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-input bg-background transition-colors",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <RadixCheckbox.Indicator className="text-primary-foreground">
          {checked === "indeterminate" ? (
            <span aria-hidden className="block h-0.5 w-2 rounded-full bg-current" />
          ) : (
            <CheckIcon width={12} height={12} />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>

      <div className="min-w-0">
        <label htmlFor={boxId} className={cn("text-sm text-foreground", disabled && "opacity-50")}>
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export type RadioOption = {
  value: string;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
};

/**
 * RadioGroup — exactly one of several, each option visible.
 *
 * @example
 * <Field label="Payment method" required>
 *   <RadioGroup
 *     value={method}
 *     onValueChange={setMethod}
 *     options={[
 *       { value: "BANK", label: "Bank transfer" },
 *       { value: "MOMO", label: "Mobile money", hint: "MTN and Orange." },
 *     ]}
 *   />
 * </Field>
 *
 * BEST PRACTICE. Radios below about six options; past that a `Select` costs
 * less vertical space and scans faster. There is no way to clear a radio group,
 * so either default to a sensible option or include an explicit "None".
 */
export function RadioGroup({
  value,
  onValueChange,
  options,
  disabled,
  id,
  className,
  ...aria
}: {
  value?: string;
  onValueChange: (v: string) => void;
  options: RadioOption[];
  disabled?: boolean;
  id?: string;
  className?: string;
} & React.AriaAttributes) {
  const uid = React.useId();

  return (
    <RadixRadio.Root
      id={id}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      {...aria}
      className={cn("space-y-2", className)}
    >
      {options.map((o) => {
        const itemId = `${uid}-${o.value}`;
        const hintId = o.hint ? `${itemId}-hint` : undefined;
        return (
          <div key={o.value} className="flex items-start gap-2.5">
            <RadixRadio.Item
              id={itemId}
              value={o.value}
              disabled={o.disabled}
              aria-describedby={hintId}
              className={cn(
                "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-input bg-background transition-colors",
                "data-[state=checked]:border-primary",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <RadixRadio.Indicator className="block h-2 w-2 rounded-full bg-primary" />
            </RadixRadio.Item>
            <div className="min-w-0">
              <label htmlFor={itemId} className={cn("text-sm text-foreground", o.disabled && "opacity-50")}>
                {o.label}
              </label>
              {o.hint && (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {o.hint}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </RadixRadio.Root>
  );
}
