/**
 * THE WORKING WEEK — the grid, and the sentence derived from it.
 *
 * WHY THIS IS TESTED AND NOT JUST WRITTEN. `summarise()` is the only thing
 * standing between the days HR ticks and the line a work contract prints. Three
 * consumers run it: the employee form (as a live preview), the API on every
 * write that carries a schedule, and therefore the contract generator, which
 * reads what the API stored. If those disagree, the disagreement takes the form
 * of a legal document stating hours nobody agreed to — which is not a bug
 * somebody notices on screen.
 *
 * The 200-character case is here for the same reason: `working_hours` is
 * `text(200)` in the validator, and a summary that overflows it turns a saved
 * form into a 422 naming a field the operator never typed in.
 */
"use strict";

const { workSchedule } = require("@praxis/shared");
const {
  withDerivedWorkingHours,
} = require("../../src/modules/master/employees/employees.rules");

const {
  DAY_CODES, defaultSchedule, normalise, summarise, weeklyHours, workMode,
} = workSchedule;

/** A week built from a partial spec — everything unnamed is a day off. */
const week = (spec) =>
  normalise({
    days: DAY_CODES.map((day) => ({
      day,
      worked: Boolean(spec[day]),
      ...(spec[day] || {}),
    })),
  });

describe("the default week", () => {
  it("is Monday to Friday, nine to five, on site", () => {
    const d = defaultSchedule();
    expect(summarise(d)).toBe("Mon–Fri, 09:00–17:00");
    expect(weeklyHours(d)).toBe(40);
    expect(workMode(d)).toBe("On-site");
  });
});

describe("summarise", () => {
  it("collapses consecutive days that share hours and place", () => {
    expect(summarise(week({ MON: {}, TUE: {}, WED: {}, THU: {}, FRI: {} })))
      .toBe("Mon–Fri, 09:00–17:00");
  });

  it("names two non-consecutive days rather than spanning them", () => {
    // "Mon–Wed" would claim Tuesday, which is the whole point of the run rule.
    expect(summarise(week({ MON: {}, WED: {} }))).toBe("Mon, Wed, 09:00–17:00");
  });

  it("annotates a remote day and leaves on-site unsaid", () => {
    const s = week({
      MON: {}, TUE: {}, WED: {}, THU: {},
      FRI: { mode: "REMOTE" },
    });
    expect(summarise(s)).toBe("Mon–Thu 09:00–17:00; Fri 09:00–17:00 (remote)");
    expect(workMode(s)).toBe("Hybrid");
  });

  it("says remote once when the whole week is", () => {
    const s = week({
      MON: { mode: "REMOTE" }, TUE: { mode: "REMOTE" }, WED: { mode: "REMOTE" },
      THU: { mode: "REMOTE" }, FRI: { mode: "REMOTE" },
    });
    expect(summarise(s)).toBe("Mon–Fri, 09:00–17:00 (remote)");
    expect(workMode(s)).toBe("Remote");
  });

  it("splits a short Friday out of the run", () => {
    const s = week({
      MON: {}, TUE: {}, WED: {}, THU: {},
      FRI: { end: "13:00" },
    });
    expect(summarise(s)).toBe("Mon–Thu 09:00–17:00; Fri 09:00–13:00");
    expect(weeklyHours(s)).toBe(36);
  });

  it("fits inside the 200 characters working_hours accepts, at its worst", () => {
    // Seven days, no two alike, every one remote: nothing collapses.
    const spec = {};
    DAY_CODES.forEach((day, i) => {
      spec[day] = { start: `0${i + 1}:00`, end: `1${i}:00`, mode: "REMOTE" };
    });
    expect(summarise(week(spec)).length).toBeLessThanOrEqual(200);
  });

  it("does not read a night shift as negative hours", () => {
    // 22:00–06:00 crosses midnight. Subtracting gives −16, which is the one
    // answer that is certainly wrong.
    expect(weeklyHours(week({ MON: { start: "22:00", end: "06:00" } }))).toBe(8);
  });

  it("says so when no day is worked, rather than going blank", () => {
    expect(summarise(week({}))).toBe("No fixed working days");
    expect(workMode(week({}))).toBeNull();
  });
});

describe("normalise", () => {
  it("keeps 'nothing recorded' distinct from 'works no days'", () => {
    expect(normalise(null)).toBeNull();
    expect(normalise("Mon-Fri 9-5")).toBeNull();
    expect(normalise(week({}))).not.toBeNull();
  });

  it("fills in the days a partial payload left out", () => {
    const s = normalise({ days: [{ day: "SAT", worked: true }] });
    expect(s.days).toHaveLength(7);
    expect(s.days.filter((d) => d.worked).map((d) => d.day)).toEqual(["SAT"]);
  });

  it("drops a day that is not a day and ignores a repeat", () => {
    const s = normalise({
      days: [
        { day: "MON", worked: true, start: "08:00" },
        { day: "MON", worked: true, start: "23:00" },
        { day: "FUNDAY", worked: true },
      ],
    });
    expect(s.days.find((d) => d.day === "MON").start).toBe("08:00");
  });

  it("pads a sloppy time rather than discarding the day", () => {
    expect(normalise({ days: [{ day: "MON", worked: true, start: "9:5" }] })
      .days[0].start).toBe("09:05");
    // Unreadable falls back to the default, because a day with one mistyped
    // field is still mostly the answer somebody meant.
    expect(normalise({ days: [{ day: "MON", worked: true, end: "elevenish" }] })
      .days[0].end).toBe("17:00");
  });
});

describe("withDerivedWorkingHours", () => {
  it("overrides whatever the caller claimed the line says", () => {
    const out = withDerivedWorkingHours({
      work_schedule: defaultSchedule(),
      working_hours: "whenever they feel like it",
    });
    expect(out.working_hours).toBe("Mon–Fri, 09:00–17:00");
  });

  it("leaves a write that carries no schedule completely alone", () => {
    // Every record predating 13775 is in this state, and rewriting an agreed
    // term because an unrelated field was patched is not a tidy-up.
    const patch = { working_hours: "Mon–Sat, 07:00–15:00", job_title: "Magasinier" };
    expect(withDerivedWorkingHours(patch)).toEqual(patch);
  });

  it("clears the derived line when the schedule is cleared", () => {
    const out = withDerivedWorkingHours({ work_schedule: null });
    expect(out.work_schedule).toBeNull();
    expect(out.working_hours).toBeNull();
  });
});
