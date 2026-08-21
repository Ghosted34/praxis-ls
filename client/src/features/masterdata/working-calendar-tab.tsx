/**
 * Working calendar — the hours this entity actually operates in.
 *
 * WHY IT IS ON THE ENTITY. The milestone engine schedules in WORKING time, not
 * elapsed time: "eight hours of customs clearance" means eight hours of a day
 * when the counter is open. Which days those are is a property of the office
 * doing the work — a Douala branch and an N'Djamena branch keep different hours
 * and observe different days — so it lives here rather than in a global setting.
 *
 * INHERITANCE IS SHOWN, NOT HIDDEN. Until someone gives an entity its own
 * calendar it follows the tenant default (seeded at 9090). The banner says so
 * plainly, because presenting borrowed hours as if they had been chosen is how
 * a tenant ends up surprised that changing one branch changed nothing.
 *
 * THE MOVABLE FEASTS CARRY A WARNING. Easter and the two Eids move each year and
 * the Islamic dates are fixed locally by moon sighting, so the seeded values are
 * estimates with a real year attached. They must be confirmed annually — a
 * holiday the calendar believes in but the port does not is a due date that is
 * wrong in the expensive direction.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { TimezonePicker } from "@/components/timezone-picker";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { errMsg, useResource } from "@/lib/use-resource";
import { dateDmy } from "@/lib/format";
import { tenant } from "@/lib/api-client";

type Day = { weekday: number; opens_at: string; closes_at: string };
type Holiday = {
  working_calendar_holiday_id?: string;
  holiday_date: string;
  is_recurring?: boolean;
  name_fr: string;
  name_en?: string | null;
  is_system?: boolean;
};
type Calendar = {
  working_calendar_id?: string;
  inherited: boolean;
  name?: string | null;
  timezone: string;
  days: Day[];
  holidays: Holiday[];
};

/** 0 = Sunday, matching working_calendar_day.weekday and JS getDay(). */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const getCalendar = (entityId: string) =>
  tenant<Calendar>(`/entities/${entityId}/working-calendar`);
const putCalendar = (entityId: string, body: Omit<Calendar, "inherited">) =>
  tenant<Calendar>(`/entities/${entityId}/working-calendar`, {
    method: "PUT",
    body,
  });
const resetCalendar = (entityId: string) =>
  tenant<Calendar>(`/entities/${entityId}/working-calendar/reset`, {
    method: "POST",
    body: {},
  });

/** "07:30:00" → "07:30" — a time column comes back with seconds. */
const hhmm = (v: string) => String(v || "").slice(0, 5);

export function WorkingCalendarTab({ entityId }: { entityId: string }) {
  const loaded = useResource<Calendar>(() => getCalendar(entityId), [entityId]);
  const [draft, setDraft] = React.useState<Calendar | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!loaded.data) return;
    setDraft({
      ...loaded.data,
      days: loaded.data.days.map((d) => ({
        ...d,
        opens_at: hhmm(d.opens_at),
        closes_at: hhmm(d.closes_at),
      })),
      holidays: loaded.data.holidays.map((h) => ({
        ...h,
        holiday_date: String(h.holiday_date).slice(0, 10),
      })),
    });
  }, [loaded.data]);

  if (loaded.error) return <ErrorState message={loaded.error} />;
  if (!draft) return <p className="micro">Loading the calendar…</p>;

  const openOn = (weekday: number) =>
    draft.days.find((d) => d.weekday === weekday);

  const toggleDay = (weekday: number, on: boolean) =>
    setDraft((c) => {
      if (!c) return c;
      const days = on
        ? [...c.days, { weekday, opens_at: "07:30", closes_at: "17:00" }].sort(
            (a, b) => a.weekday - b.weekday,
          )
        : c.days.filter((d) => d.weekday !== weekday);
      return { ...c, days };
    });

  const setHours = (weekday: number, patch: Partial<Day>) =>
    setDraft((c) =>
      c
        ? {
            ...c,
            days: c.days.map((d) =>
              d.weekday === weekday ? { ...d, ...patch } : d,
            ),
          }
        : c,
    );

  const addHoliday = () =>
    setDraft((c) =>
      c
        ? {
            ...c,
            holidays: [
              ...c.holidays,
              { holiday_date: "", name_fr: "", is_recurring: true },
            ],
          }
        : c,
    );
  const setHoliday = (i: number, patch: Partial<Holiday>) =>
    setDraft((c) =>
      c
        ? {
            ...c,
            holidays: c.holidays.map((h, ix) =>
              ix === i ? { ...h, ...patch } : h,
            ),
          }
        : c,
    );
  const removeHoliday = (i: number) =>
    setDraft((c) =>
      c ? { ...c, holidays: c.holidays.filter((_, ix) => ix !== i) } : c,
    );

  const invalidDay = draft.days.find((d) => !(d.closes_at > d.opens_at));
  const canSave =
    draft.days.length > 0 &&
    !invalidDay &&
    draft.holidays.every((h) => h.holiday_date && h.name_fr.trim()) &&
    !busy;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await putCalendar(entityId, {
        timezone: draft.timezone,
        name: draft.name,
        days: draft.days,
        holidays: draft.holidays.map((h) => ({
          holiday_date: h.holiday_date,
          is_recurring: !!h.is_recurring,
          name_fr: h.name_fr,
          name_en: h.name_en || null,
          is_system: !!h.is_system,
        })),
      });
      loaded.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function useDefault() {
    setBusy(true);
    setError(null);
    try {
      await resetCalendar(entityId);
      loaded.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const movable = draft.holidays.filter((h) => !h.is_recurring);

  return (
    <div className="space-y-4">
      {draft.inherited ? (
        <Callout tone="info" title="Following the tenant default">
          This entity has no calendar of its own, so the milestone engine
          schedules it against the tenant-wide hours below. Saving here gives it
          its own — the default is left alone for everyone still following it.
        </Callout>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="ok">Own calendar</Pill>
          <Button
            size="sm"
            variant="outline"
            onClick={useDefault}
            loading={busy}
          >
            Follow the tenant default instead
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Timezone"
          hint="Opening hours below are wall-clock time in this zone."
        >
          <TimezonePicker
            value={draft.timezone}
            onChange={(timezone) => setDraft({ ...draft, timezone })}
            label="Timezone"
            allowEmpty={false}
          />
        </Field>
        <Field label="Calendar name">
          <Input
            value={draft.name || ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Douala branch"
          />
        </Field>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Opening hours</h3>
        <p className="micro">
          A day that is switched off is closed — no milestone time accrues on
          it. Sunday is off by default.
        </p>
        <div className="space-y-1">
          {WEEKDAYS.map((label, weekday) => {
            const day = openOn(weekday);
            return (
              <div
                key={weekday}
                className="grid items-center gap-2 sm:grid-cols-[10rem_auto_auto_1fr]"
              >
                <Checkbox
                  checked={!!day}
                  onCheckedChange={(on) => toggleDay(weekday, on)}
                  label={label}
                />
                {day ? (
                  <>
                    <Input
                      value={day.opens_at}
                      onChange={(e) =>
                        setHours(weekday, { opens_at: e.target.value })
                      }
                      className="num w-24"
                      aria-label={`${label} opening time`}
                      placeholder="07:30"
                    />
                    <Input
                      value={day.closes_at}
                      onChange={(e) =>
                        setHours(weekday, { closes_at: e.target.value })
                      }
                      className="num w-24"
                      aria-label={`${label} closing time`}
                      placeholder="17:00"
                    />
                    {!(day.closes_at > day.opens_at) && (
                      <span className="text-sm text-[rgb(var(--bad))]">
                        Closing must be after opening.
                      </span>
                    )}
                  </>
                ) : (
                  <span className="micro sm:col-span-3">{tr("Closed")}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">
            Public holidays
          </h3>
          <Button size="sm" variant="outline" onClick={addHoliday}>
            Add a holiday
          </Button>
        </div>

        {movable.length > 0 && (
          <Callout tone="warn" title="Confirm the movable feasts each year">
            {movable.length === 1
              ? "One date moves"
              : `${movable.length} dates move`}{" "}
            with the lunar or Easter calendar and the Islamic ones are fixed
            locally by moon sighting. The values shipped are published estimates
            — a holiday the calendar believes in but the port does not is a due
            date that is wrong in the expensive direction.
          </Callout>
        )}

        {draft.holidays.length === 0 ? (
          <EmptyState
            title="No holidays"
            hint="Without them the engine will schedule work on 20 May."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{tr("Date")}</TH>
                <TH>Name (French)</TH>
                <TH>Name (English)</TH>
                <TH>Repeats yearly</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {draft.holidays.map((h, i) => (
                <TR key={h.working_calendar_holiday_id || i}>
                  <TD>
                    <DateField
                      value={h.holiday_date}
                      onChange={(iso) => setHoliday(i, { holiday_date: iso })}
                      className="w-40"
                      aria-label={`Holiday ${i + 1} date`}
                    />
                    {h.is_recurring && h.holiday_date && (
                      <span className="micro block">
                        every {dateDmy(h.holiday_date).slice(0, 5)}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Input
                      value={h.name_fr}
                      onChange={(e) =>
                        setHoliday(i, { name_fr: e.target.value })
                      }
                      aria-label={`Holiday ${i + 1} French name`}
                    />
                  </TD>
                  <TD>
                    <Input
                      value={h.name_en || ""}
                      onChange={(e) =>
                        setHoliday(i, { name_en: e.target.value })
                      }
                      aria-label={`Holiday ${i + 1} English name`}
                    />
                  </TD>
                  <TD>
                    <Checkbox
                      checked={!!h.is_recurring}
                      onCheckedChange={(v) =>
                        setHoliday(i, { is_recurring: v })
                      }
                      label={h.is_recurring ? "Fixed date" : "Moves each year"}
                    />
                  </TD>
                  <TD>
                    <button
                      type="button"
                      onClick={() => removeHoliday(i)}
                      aria-label={`Remove ${h.name_fr || `holiday ${i + 1}`}`}
                      className="px-2 text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button onClick={save} loading={busy} disabled={!canSave}>
          {draft.inherited
            ? "Give this entity its own calendar"
            : "Save calendar"}
        </Button>
      </div>
    </div>
  );
}
