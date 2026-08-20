"use strict";

/**
 * §3.2 — the extra-charge simulator's screen contract: prefill from the file
 * (nobody retypes what the system knows) and the Rate Configuration that
 * actually persists (the legacy's saveAdminSettings() ended in
 * alert("Saved locally!") and mutated a JS object — a reload restored 615).
 */
const service = require("../../src/modules/commercial/extra_charge_simulation/extra_charge_simulation.service");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("prefill — the file fills the form", () => {
  function fakeClient({ dossier = true, boxes = [] } = {}) {
    const queries = [];
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/FROM dossier d/.test(sql)) {
          return dossier
            ? {
                rows: [
                  {
                    dossier_id: UUID(1),
                    ref: "SLAS-2026-0009",
                    ata: "2026-08-01",
                    eta: "2026-07-30",
                    vessel_flight: "MSC AURORA",
                    bl_mawb: "MEDU1234567",
                    shipping_line: "MSC",
                  },
                ],
              }
            : { rows: [] };
        }
        if (/FROM dossier_container_line/.test(sql)) return { rows: boxes };
        return { rows: [] };
      },
    };
  }

  it("builds the container text the parser reads, plus ATA and the line", async () => {
    const out = await service.prefill(
      fakeClient({
        boxes: [
          { code: "40HC", qty: 2 },
          { code: "20GP", qty: 1 },
        ],
      }),
      UUID(1),
    );
    expect(out.containers).toBe("2x40HC, 1x20GP");
    expect(out.ata).toBe("2026-08-01");
    expect(out.shipping_line).toBe("MSC");
    // The parser must actually read what prefill writes. ("GP" normalises to
    // the engine's dry-container code DC — same box, the rate tables key on DC.)
    const parsed = service.parseContainers(out.containers);
    expect(parsed).toEqual([
      { q: 2, s: 40, t: "HC" },
      { q: 1, s: 20, t: "DC" },
    ]);
  });

  it("a file with no boxes prefills null, not an empty crash", async () => {
    const out = await service.prefill(fakeClient({ boxes: [] }), UUID(1));
    expect(out.containers).toBeNull();
  });

  it("404s an unknown dossier", async () => {
    await expect(
      service.prefill(fakeClient({ dossier: false }), UUID(9)),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("saveRates — persisted, unlike legacy", () => {
  function fakeClient() {
    const queries = [];
    return {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/INSERT INTO setting/.test(sql))
          return {
            rows: [
              {
                section: params[0],
                key: params[1],
                value: JSON.parse(params[2]),
              },
            ],
          };
        if (/SELECT value FROM setting/.test(sql))
          return { rows: [{ value: { demurrage: { 20: [1, 2] } } }] };
        return { rows: [] };
      },
    };
  }

  it("writes the tariff to settings commercial.extra_charge_rates", async () => {
    const c = fakeClient();
    const out = await service.saveRates(c, {
      rates: { yardTrigger: 10, demurrage: { 20: [1, 2] } },
      actor: { user_id: UUID(3) },
    });
    const put = c.queries.find((q) => /INSERT INTO setting/.test(q.sql));
    expect(put).toBeDefined();
    expect(put.params[0]).toBe("commercial");
    expect(put.params[1]).toBe("extra_charge_rates");
    expect(out.rates).toBeDefined();
    expect(out.source).toBe("settings");
  });

  it("refuses FX in the tariff — conversion belongs to the currency module", async () => {
    await expect(
      service.saveRates(fakeClient(), { rates: { fx: { USD: 615 } } }),
    ).rejects.toMatchObject({ code: "FX_NOT_HERE" });
  });

  it("refuses a missing tariff", async () => {
    await expect(
      service.saveRates(fakeClient(), { rates: null }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("the returned vat_rate comes from settings finance.vat, not a literal", async () => {
    // getRule reads the same SELECT — the fake returns a stored value object
    // without rate_percent, so the declared fallback applies; the point pinned
    // here is that the code ASKS settings rather than embedding 0.1925.
    const c = fakeClient();
    const out = await service.rates(c);
    expect(
      c.queries.some(
        (q) =>
          /SELECT value FROM setting/.test(q.sql) &&
          q.params[0] === "finance" &&
          q.params[1] === "vat",
      ),
    ).toBe(true);
    expect(typeof out.vat_rate).toBe("number");
  });
});
