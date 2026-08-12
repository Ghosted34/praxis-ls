/**
 * The entity form's seeding — specifically its date controls.
 *
 * WHAT BROKE. `valuesFrom` seeded every control with `String(raw)`, which is
 * right for the other thirty columns and wrong for the two bound to
 * `<input type="date">`. A date arriving as a timestamp — what the API sent
 * before `shared/db/pg-date-types`, and what a cached response still can — left
 * the control BLANK while the form state kept the timestamp, so re-opening an
 * entity showed no incorporation date for one that was saved and Save posted the
 * unrenderable value back for the API to reject.
 *
 * `entityFormBody` is asserted alongside it because the two are a pair: seeding
 * is only correct if what it produces survives the trip back out.
 */
import { describe, it, expect, afterEach } from "vitest";
import type * as api from "@/lib/masterdata-api";
import { valuesFrom, entityFormBody, EMPTY_VALUES } from "./entity-form-fields";

const row = (over: Record<string, unknown>) =>
  ({ entity_id: "e1", code: "SLAS", legal_name: "Smart Logistics & Services Ltd", ...over }) as unknown as api.Entity;

afterEach(() => {
  process.env.TZ = "UTC";
});

describe("valuesFrom · dates", () => {
  it("seeds a plain calendar date unchanged", () => {
    expect(valuesFrom(row({ incorporation_date: "2021-09-21" })).incorporation_date).toBe("2021-09-21");
  });

  it("seeds a legacy timestamp response as the day a date input can render", () => {
    // Was `"2021-09-21T00:00:00.000Z"`, which the control refuses to display.
    expect(valuesFrom(row({ incorporation_date: "2021-09-21T00:00:00.000Z" })).incorporation_date).toBe("2021-09-21");
  });

  it("does not move the day for a reader west of UTC", () => {
    process.env.TZ = "America/New_York";
    expect(valuesFrom(row({ dissolution_date: "2026-08-14" })).dissolution_date).toBe("2026-08-14");
  });

  it("leaves an unset date empty rather than rendering 'null'", () => {
    const v = valuesFrom(row({ incorporation_date: null, dissolution_date: undefined }));
    expect(v.incorporation_date).toBe("");
    expect(v.dissolution_date).toBe("");
  });

  it("still stringifies every non-date column", () => {
    const v = valuesFrom(row({ legal_form: "SARL", share_capital: 10_000_000, vat_registered: true }));
    expect(v.legal_form).toBe("SARL");
    expect(v.share_capital).toBe("10000000");
    expect(v.vat_registered).toBe("true");
  });

  it("covers every key the form declares, so no control is left uncontrolled", () => {
    const v = valuesFrom(row({}));
    for (const k of Object.keys(EMPTY_VALUES)) expect(typeof v[k]).toBe("string");
  });
});

describe("entityFormBody · dates round-trip", () => {
  it("sends back exactly what was seeded, so an untouched form is a no-op", () => {
    const seeded = valuesFrom(row({ incorporation_date: "2021-09-21T00:00:00.000Z", dissolution_date: null }));
    const body = entityFormBody(seeded);
    // `YYYY-MM-DD` is what the shared `isoDate` schema accepts; the timestamp it
    // replaced is what produced "Use the format YYYY-MM-DD." on save.
    expect(body.incorporation_date).toBe("2021-09-21");
    // Explicit null, not omitted: on a PATCH an omitted key keeps the old value,
    // so a cleared date has to be sent as a clearing.
    expect(body.dissolution_date).toBeNull();
  });
});
