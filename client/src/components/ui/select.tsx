/**
 * Select — choose one option from a known list.
 *
 * TWO EXPORTS, ON PURPOSE. This is not indecision; it is the honest answer to
 * a real trade-off, and the guidance is the point of the file.
 *
 *   NativeSelect  a styled <select>. Already used at ~200 sites (exported from
 *                 ui/modal). It is smaller, faster, works offline, and on
 *                 mobile it opens the OS picker — which is genuinely better
 *                 than any custom widget. It cannot be styled inside the option
 *                 list, and it cannot hold rich options.
 *   Select        the Radix listbox. Use it when options need more than a
 *                 string (a status pill, a two-line label, an icon) or when the
 *                 list needs grouping. It brings a full ARIA listbox: type-ahead,
 *                 arrow keys, Home/End, Escape, and focus restoration.
 *
 * DEFAULT TO NativeSelect. This app is a PWA for logistics operators on thin
 * connectivity (F17 notes the offline promise), and the native control is the
 * one that never breaks. Reach for `Select` when the option list genuinely
 * needs to show more than text.
 *
 * For a list that is long, tenant-scoped or unbounded — clients, dossiers,
 * employees — use neither: use `<SearchSelect>`, which queries the server.
 *
 * @example  // the common case
 * <Field label="Currency" required>
 *   <NativeSelect value={ccy} onChange={(e) => setCcy(e.target.value)}>
 *     <option value="XAF">XAF</option>
 *     <option value="EUR">EUR</option>
 *   </NativeSelect>
 * </Field>
 *
 * @example  // rich options
 * <Field label="Status">
 *   <Select
 *     value={status}
 *     onValueChange={setStatus}
 *     placeholder="Any status"
 *     options={[
 *       { value: "OPEN", label: <Pill tone="blue">Open</Pill> },
 *       { value: "WON", label: <Pill tone="ok">Won</Pill> },
 *     ]}
 *   />
 * </Field>
 *
 * BEST PRACTICE. Always render inside a `<Field>` — that is what supplies the
 * accessible name and the required/invalid state. Do not use the first option
 * as a label ("-- choose --" as value=""); use `placeholder`, and mark the
 * field `required` if empty is not allowed.
 */
import * as React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { cn } from "@/lib/cn";
import { ChevronIcon, CheckIcon } from "@/components/ui/icons";

export { Select as NativeSelect } from "@/components/ui/modal";

export type SelectOption = {
  value: string;
  label: React.ReactNode;
  /** Plain-text fallback used for type-ahead and the closed-state display when
   *  `label` is not a string. */
  text?: string;
  disabled?: boolean;
  /** Secondary line under the label, shown only in the open list. Deliberately
   *  OUTSIDE `ItemText`: Radix clones ItemText into the closed trigger, so a
   *  hint placed in `label` would follow the selection into the collapsed
   *  control and turn a one-line field into two. */
  hint?: React.ReactNode;
  /** Optional heading this option sits under. Consecutive options sharing a
   *  `group` render inside one labelled `RadixSelect.Group`, which is what puts
   *  the heading into the accessibility tree rather than faking it with a
   *  styled div. Options WITHOUT a group render exactly as before, so every
   *  existing call site is unaffected. Order the array by group — this splits
   *  on runs, it does not sort. */
  group?: string;
};

/**
 * Split the flat option list into consecutive runs of the same `group`. An
 * ungrouped list yields exactly one ungrouped run, so the rendered output is
 * byte-identical to what it was before grouping existed.
 */
function runs(
  options: SelectOption[],
): { group?: string; options: SelectOption[] }[] {
  const out: { group?: string; options: SelectOption[] }[] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last.group === o.group) last.options.push(o);
    else out.push({ group: o.group, options: [o] });
  }
  return out;
}

function renderItem(o: SelectOption) {
  return (
    <RadixSelect.Item
      key={o.value}
      value={o.value}
      disabled={o.disabled}
      textValue={o.text ?? (typeof o.label === "string" ? o.label : o.value)}
      className={cn(
        "flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm outline-none",
        "data-[highlighted]:bg-accent/60 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      )}
    >
      <span className="min-w-0 flex-1">
        <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
        {o.hint && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {o.hint}
          </span>
        )}
      </span>
      <RadixSelect.ItemIndicator>
        <CheckIcon className="text-primary-ink" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  id,
  className,
  ...aria
}: {
  value?: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
} & React.AriaAttributes) {
  return (
    <RadixSelect.Root
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        id={id}
        {...aria}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-input bg-background px-3 py-2 text-sm text-foreground",
          "transition-colors focus-visible:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[placeholder]:text-muted-foreground",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon asChild>
          <ChevronIcon className="shrink-0 text-muted-foreground" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[var(--shadow-l)]"
        >
          <RadixSelect.Viewport className="p-1">
            {runs(options).map((run, i) =>
              run.group ? (
                <RadixSelect.Group key={`${run.group}-${i}`}>
                  <RadixSelect.Label className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {run.group}
                  </RadixSelect.Label>
                  {run.options.map(renderItem)}
                </RadixSelect.Group>
              ) : (
                run.options.map(renderItem)
              ),
            )}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
