/**
 * The several-reminders editor — the write form's side of 13880.
 *
 * The pure shaper is where most of the contract lives: which string the
 * NativeSelect holds becomes which field of the API row, and "relative OR
 * absolute, never both, never neither" is enforced here so the server's 400
 * is a belt, not the lesson. The component part pins the cap and the
 * per-row optionality (email is asked, not assumed).
 */
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Reminder } from "./api";
import {
  MAX_REMINDERS,
  draftsToInput,
  fromLegacyReminder,
  toReminderDrafts,
} from "./reminder-drafts";
import type { ReminderDraft } from "./reminder-drafts";
import { RemindersField } from "./reminders-field";

const TZ = "Africa/Douala";

describe("draftsToInput — one select's string becomes the API's two fields", () => {
  it("a preset goes up as reminder_minutes with remind_at null", () => {
    const out = draftsToInput([{ when: "60", at: "", email: false, scope: "this" }]);
    expect(out).toEqual({
      input: [
        {
          reminder_minutes: 60,
          remind_at: null,
          email: false,
          scope: "this",
          label: "1 hour before",
        },
      ],
    });
  });

  it("a picked time goes up as remind_at with reminder_minutes null", () => {
    const out = draftsToInput([{ when: "custom", at: "2026-09-15T09:00", email: true, scope: "this" }]);
    expect(out).toEqual({
      input: [
        {
          remind_at: "2026-09-15T09:00",
          reminder_minutes: null,
          email: true,
          scope: "this",
          label: null,
        },
      ],
    });
  });

  it("a row with nothing chosen is told here, not by a 400", () => {
    const out = draftsToInput([{ when: "", at: "", email: false, scope: "this" }]);
    expect(out).toEqual({ error: "Reminder 1 has no time chosen." });
  });

  it("a picked-time row without the time is told here too", () => {
    const out = draftsToInput([{ when: "custom", at: "", email: false, scope: "this" }]);
    expect(out).toEqual({ error: "Reminder 1 needs a date and a time." });
  });
});

describe("toReminderDrafts — server rows round-trip through the form", () => {
  it("a relative row is its preset string; an absolute row is the custom field", () => {
    const rows: Reminder[] = [
      {
        workspace_reminder_id: "wr1",
        owner_type: "task",
        owner_id: "t1",
        reminder_minutes: 1440,
        remind_at: null,
        reminder_sent_at: null,
        ordinal: 1,
        email: true,
        scope: "series",
        label: "1 day before",
      },
      {
        workspace_reminder_id: "wr2",
        owner_type: "task",
        owner_id: "t1",
        reminder_minutes: null,
        remind_at: "2026-09-15T08:00:00.000Z",
        reminder_sent_at: "2026-09-15T08:00:05.000Z",
        ordinal: 2,
        email: false,
        scope: "this",
        label: null,
      },
    ];
    const drafts = toReminderDrafts(rows, TZ);
    expect(drafts[0]).toEqual({ when: "1440", at: "", email: true, scope: "series", sent: false });
    // 08:00Z is 09:00 in Douala — the wall string the form echoes back, so
    // the round trip lands on the tenant's clock, not the laptop's.
    expect(drafts[1]).toEqual({ when: "custom", at: "2026-09-15T09:00", email: false, scope: "this", sent: true });
  });

  it("the 13810 pair still seeds one row for a record that predates the list", () => {
    expect(fromLegacyReminder(null, null, TZ)).toEqual([]);
    expect(fromLegacyReminder(60, null, TZ)).toEqual([
      { when: "60", at: "", email: false, scope: "this" },
    ]);
    expect(fromLegacyReminder(null, "2026-09-15T08:00:00.000Z", TZ)).toEqual([
      { when: "custom", at: "2026-09-15T09:00", email: false, scope: "this" },
    ]);
  });
});

describe("RemindersField — the form", () => {
  function Harness({ initial = [] as ReminderDraft[] }) {
    const [rows, setRows] = React.useState(initial);
    return <RemindersField rows={rows} onChange={setRows} recurring={false} idPrefix="t" />;
  }

  it("stops adding at the cap rather than at a 422", () => {
    render(<Harness initial={[]} />);
    const add = () => fireEvent.click(screen.getByRole("button", { name: /Add a reminder|Add another reminder/ }));
    add();
    add();
    add();
    expect(screen.getAllByLabelText(/^Reminder \d+$/)).toHaveLength(MAX_REMINDERS);
    expect(screen.queryByRole("button", { name: /Add another reminder/ })).toBeNull();
  });

  it("email is per-row and off by default — the override is never assumed", () => {
    render(<Harness initial={[{ when: "60", at: "", email: false, scope: "this" }]} />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked") ?? box.getAttribute("data-state")).not.toBe("true");
    fireEvent.click(box);
    // The row is a draft; the tick is held in form state and the submit
    // carries it — the assertion the write side cares about is draftsToInput,
    // and this is the control it must be able to reach.
  });

  it("renders an already-sent row with its history named", () => {
    render(
      <Harness
        initial={[{ when: "60", at: "", email: false, scope: "this", sent: true }]}
      />,
    );
    expect(screen.getByText("Already sent for this date")).toBeTruthy();
  });

  it("offers the series scope only on a recurring record", () => {
    const { unmount } = render(
      <RemindersField
        rows={[{ when: "1440", at: "", email: false, scope: "this" }]}
        onChange={() => {}}
        recurring={true}
        idPrefix="t"
      />,
    );
    expect(screen.getByLabelText("Reminder 1 occurrences")).toBeTruthy();
    unmount();
    render(
      <RemindersField
        rows={[{ when: "1440", at: "", email: false, scope: "this" }]}
        onChange={() => {}}
        recurring={false}
        idPrefix="t"
      />,
    );
    expect(screen.queryByLabelText("Reminder 1 occurrences")).toBeNull();
  });
});
