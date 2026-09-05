/**
 * The working week, as a week.
 *
 * ── WHY THIS REPLACED A TEXT BOX ───────────────────────────────────────────
 *
 * `working_hours` was one free-text field printed verbatim into the contract:
 * "Mon–Fri, 08:00–17:00". Fine while everybody works the same five days in the
 * same building — and the moment somebody works Friday from home there is
 * nowhere to SAY so. Each clerk types it in their own words, and everything
 * that has to answer "is this person on site on Friday" (dispatch, attendance,
 * a hybrid allowance) is left parsing prose.
 *
 * So the days are boxes you tick, each with its own hours and its own place of
 * work. The sentence underneath is not a second field to fill in: it is
 * `summarise()` — the SAME function the API re-derives `working_hours` with on
 * every write — run as you type, so what the contract will print is on screen
 * before anybody saves.
 *
 * ── A RECORD THAT PREDATES THE GRID KEEPS ITS SENTENCE ─────────────────────
 *
 * Every employee created before 13775 has free text and no schedule, and those
 * are two different states: `null` is "no schedule recorded", not "works no
 * days". Overwriting their line with a cheerful Mon–Fri default would rewrite a
 * term somebody agreed to, on a record nobody was even editing for that reason.
 * So the old text is shown as it stands and replacing it is a decision — one
 * button, which the person clicks or does not.
 */
import { workSchedule, type WorkSchedule, type WorkDay } from "@shared";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { cn } from "@/lib/cn";

const { DAYS, defaultSchedule, summarise, weeklyHours, workMode } = workSchedule;

/** Round-number hours read better than "37.5" when they are round. */
const hoursLabel = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

export function WorkScheduleField({
  value,
  onChange,
  /** What the record says today, for the legacy case where there is no grid. */
  legacyText,
}: {
  value: WorkSchedule | null;
  onChange: (v: WorkSchedule | null) => void;
  legacyText?: string;
}) {
  const setDay = (code: string, patch: Partial<WorkDay>) => {
    if (!value) return;
    onChange({
      days: value.days.map((d) => (d.day === code ? { ...d, ...patch } : d)),
    });
  };

  /* Nothing recorded yet. Two different nothings: a record that has never had a
     working pattern at all (offer the default and get on with it) and one whose
     pattern is a sentence somebody wrote (show it, and make replacing it an
     explicit act). */
  if (!value) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        {legacyText ? (
          <>
            <p className="text-sm text-foreground">{legacyText}</p>
            <p className="micro">
              {tr(
                "Recorded before the weekly grid existed. Replacing it lets you say which days are remote — and rewrites the line the contract prints.",
              )}
            </p>
          </>
        ) : (
          <p className="micro">
            {tr("No working pattern recorded — a contract would have a gap here.")}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange(defaultSchedule())}
        >
          {legacyText ? tr("Replace with a weekly grid") : tr("Set the working week")}
        </Button>
      </div>
    );
  }

  const worked = value.days.filter((d) => d.worked);
  const line = summarise(value);
  const hours = weeklyHours(value);
  const mode = workMode(value);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      {/* The days themselves. `aria-pressed` rather than a checkbox role: these
          are toggles that reveal the rows below, and a screen reader should hear
          "Monday, pressed" rather than a checkbox with no group. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr("Working days")}>
        {DAYS.map((d) => {
          const row = value.days.find((x) => x.day === d.code);
          const on = Boolean(row && row.worked);
          return (
            <button
              key={d.code}
              type="button"
              aria-pressed={on}
              onClick={() => setDay(d.code, { worked: !on })}
              className={cn("chip", on && "on")}
            >
              {tr(d.short)}
            </button>
          );
        })}
      </div>

      {worked.length === 0 ? (
        <p className="micro">
          {tr("No working days ticked — pick the days this person works.")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {worked.map((d, i) => {
            const day = DAYS.find((x) => x.code === d.day);
            const label = day ? day.label : d.day;
            return (
              <div
                key={d.day}
                className="grid grid-cols-[3.5rem_1fr_1fr_auto] items-center gap-2"
              >
                <span className="text-xs text-muted-foreground">
                  {tr(day ? day.short : d.day)}
                </span>
                <Input
                  type="time"
                  value={d.start}
                  aria-label={`${tr(label)} — ${tr("starts")}`}
                  onChange={(e) => setDay(d.day, { start: e.target.value })}
                  className="h-8 text-xs"
                />
                <Input
                  type="time"
                  value={d.end}
                  aria-label={`${tr(label)} — ${tr("ends")}`}
                  onChange={(e) => setDay(d.day, { end: e.target.value })}
                  className="h-8 text-xs"
                />
                <Select
                  value={d.mode}
                  aria-label={`${tr(label)} — ${tr("worked from")}`}
                  onChange={(e) =>
                    setDay(d.day, { mode: e.target.value as WorkDay["mode"] })
                  }
                  className="h-8 w-28 text-xs"
                >
                  <option value="ON_SITE">{tr("On site")}</option>
                  <option value="REMOTE">{tr("Remote")}</option>
                </Select>
                {/* One button, on the first row only: five days of identical
                    hours is the common case and typing them five times is how
                    a Tuesday ends up finishing at 17:30 by accident. */}
                {i === 0 && worked.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        days: value.days.map((x) =>
                          x.worked ? { ...x, start: d.start, end: d.end } : x,
                        ),
                      })
                    }
                    className="col-span-4 justify-self-start text-xs text-primary-ink underline underline-offset-2"
                  >
                    {tr("Use these hours for every working day")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* What the contract will actually say. Rendered through the same
          function the API derives the stored line with, so this is a preview
          rather than a second opinion. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-2">
        <p className="text-xs text-foreground">
          <span className="text-muted-foreground">{tr("The contract will say")}: </span>
          {line || "—"}
        </p>
        <p className="micro">
          {hoursLabel(hours)} {tr("hours a week")}
          {mode ? ` · ${tr(mode)}` : ""}
        </p>
      </div>
    </div>
  );
}
