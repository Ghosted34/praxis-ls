"use strict";
/**
 * The assistant's form-options endpoint dispatches to `registry[ref]`, where
 * `ref` is the request's query string. On a plain object an INHERITED name —
 * `constructor`, `toString`, `__defineGetter__` — resolves to a function too,
 * so the guard is that `ref` is an own key of the executor map, checked before
 * anything is called. The catalogue lookup in front of it is not relied on:
 * here it is made to answer "yes" for every key, as a bad catalogue row would.
 */
const mockRead = jest.fn(async () => [{ id: "a1", name: "Acme" }]);

jest.mock("../../src/services/ai/orchestrator.service", () => ({}));
jest.mock("../../src/services/ai/action-registrar", () => ({
  buildExecutorMap: () => ({ list_clients: (...args) => mockRead(...args) }),
}));
jest.mock("../../src/services/ai/action-fields", () => ({
  rowsToOptions: (rows) => rows.map((r) => ({ value: r.id, label: r.name })),
}));

const service = require("../../src/modules/ai/assistant/assistant.service");

// Every key "is in the catalogue" — the guard under test must hold on its own.
const client = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
const user = { user_id: "u1" };

beforeEach(() => mockRead.mockClear());

test.each(["constructor", "toString", "hasOwnProperty", "__defineGetter__", "__proto__"])(
  "an inherited name (%s) is refused, and nothing is called",
  async (ref) => {
    await expect(service.options(client, { user, ref })).rejects.toThrow(/no executor/);
    expect(mockRead).not.toHaveBeenCalled();
  },
);

test("a registered read still runs and maps to options", async () => {
  const out = await service.options(client, { user, ref: "list_clients", limit: 10 });
  expect(out).toEqual([{ value: "a1", label: "Acme" }]);
  expect(mockRead).toHaveBeenCalledTimes(1);
});
