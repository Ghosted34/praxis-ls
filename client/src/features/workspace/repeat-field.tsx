/**
 * RepeatField — the one control that turns "remind the accountant on the 14th of
 * every month" into a rule, shared by the task and event dialogs so the two can
 * not drift.
 *
 * It holds the picker STATE (not the RRULE) and emits a rule through `onChange`,
 * mirroring how the reminder preset works: an empty choice means "does not
 * repeat" and is sent as `null`, which the server reads as a one-off.
 *
 * The extra inputs appear only for the kinds that use them — a weekday picker on
 * a monthly rule would be a control that does nothing, and FRONTEND_GUIDE §3 is
 * explicit that a control which appears to work but does not is worse than
 * absent.
 */
import * as React from "react";
import { Field } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import {
  REPEAT_KINDS,
  WEEKDAY_OPTIONS,
  buildRule,
  parseRule,
  repeatStateFromDue,
  type RepeatState,
} from "./repeat";

export function RepeatField({
  idPrefix,
  value,
  dueIso,
  onChange,
}: {
  idPrefix: string;
  /** The stored rule (create = null). */
  value: string | null;
  /** The anchor date, so "monthly" defaults to the task's own day. */
  dueIso: string | null;
  onChange: (rule: string | null) => void;
}) {
  const [state, setState] = React.useState<RepeatState>(() => parseRule(value, dueIso));

  // Re-read when the dialog opens with a different row.
  React.useEffect(() => {
    setState(parseRule(value, dueIso));
  }, [value, dueIso]);

  function update(patch: Partial<RepeatState>) {
    const next = { ...state, ...patch };
    setState(next);
    onChange(buildRule(next));
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Repeats" htmlFor={`${idPrefix}-repeat-kind`}>
          <NativeSelect
            id={`${idPrefix}-repeat-kind`}
            value={state.kind}
            onChange={(e) => update({ kind: e.target.value as RepeatState["kind"] })}
          >
            {REPEAT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {state.kind !== "none" && (
          <Field label="Every" htmlFor={`${idPrefix}-repeat-interval`} hint="How many apart.">
            <Input
              id={`${idPrefix}-repeat-interval`}
              type="number"
              min={1}
              max={366}
              value={String(state.interval)}
              onChange={(e) => {
                const n = Number(e.target.value);
                update({ interval: Number.isInteger(n) && n >= 1 && n <= 366 ? n : 1 });
              }}
            />
          </Field>
        )}
      </div>

      {state.kind === "weekly" && (
        <Field label="On" htmlFor={`${idPrefix}-repeat-weekday`}>
          <NativeSelect
            id={`${idPrefix}-repeat-weekday`}
            value={String(state.weekday ?? 1)}
            onChange={(e) => update({ weekday: Number(e.target.value) })}
          >
            {WEEKDAY_OPTIONS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {state.kind === "monthly" && (
        <Field label="On day" htmlFor={`${idPrefix}-repeat-monthday`} hint="Months without that day are skipped.">
          <Input
            id={`${idPrefix}-repeat-monthday`}
            type="number"
            min={1}
            max={31}
            value={String(state.monthDay ?? 1)}
            onChange={(e) => {
              const n = Number(e.target.value);
              update({ monthDay: Number.isInteger(n) && n >= 1 && n <= 31 ? n : 1 });
            }}
          />
        </Field>
      )}

      {state.kind !== "none" && (
        <Field
          label="Until"
          htmlFor={`${idPrefix}-repeat-until`}
          hint="Leave empty to keep repeating until you stop it."
        >
          <DateField
            id={`${idPrefix}-repeat-until`}
            value={state.until ?? ""}
            onChange={(iso) => update({ until: iso || null })}
          />
        </Field>
      )}
    </div>
  );
}

/** A default state so callers can seed the picker from a due date. */
export { repeatStateFromDue };
