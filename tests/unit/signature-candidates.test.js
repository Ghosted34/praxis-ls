"use strict";

/**
 * §6.3 — THE SENDER PICKS PEOPLE, NOT ADDRESSES.
 *
 * Q7 = C is forbidden outright: there is no path in this programme where a
 * signer supplies the address their own OTP is sent to, and the sender typing
 * it on their behalf is the same disclosure wearing a different hat. The
 * candidates resolver is what makes that rule livable — without it a
 * "send for signature" screen has only two options, and both are wrong:
 * make every send an unattributed override, or teach a React component that a
 * transit order's counterparty is dossier → client_master → client_contact.
 *
 * These tests hold the resolver to the three things that make it safe: it
 * returns rows we already hold with the `source_ref` the request will store, it
 * refuses to guess for a doc type it does not know, and it degrades to "no
 * counterparty" rather than throwing — a screen that cannot list candidates
 * must still offer the attributed-override path.
 */

const candidates = require("../../src/modules/vault/signature_request/signature_request.candidates");

/**
 * A tenant connection that answers by matching the statement, not by call
 * order — the resolver runs its two queries with `Promise.all`, so an
 * order-dependent stub would pass today and break on a refactor that swapped
 * them.
 */
function makeClient(answers = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM app_user/.test(sql)) return { rows: answers.users || [] };
      if (/FROM client_contact/.test(sql)) return { rows: answers.contacts || [] };
      if (/FROM transit_order/.test(sql)) return { rows: answers.party ? [answers.party] : [] };
      return { rows: [] };
    },
  };
}

const PARTY = {
  party_id: "client-1",
  party_name: "SOCIÉTÉ CAMEROUNAISE DE CIMENT",
  party_email: "contact@scc.cm",
  party_language: "fr",
};

describe("who may be asked to sign", () => {
  test("the counterparty's contacts come back with the ref the request stores", async () => {
    const client = makeClient({
      party: PARTY,
      contacts: [
        { contact_id: "c-1", name: "Aïssatou Njoya", title: "Procurement Manager", email: "a.njoya@scc.cm", language: "fr", is_primary: true },
        { contact_id: "c-2", name: "Paul Fotso", title: null, email: "p.fotso@scc.cm", language: null, is_primary: false },
      ],
    });
    const out = await candidates.list(client, { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });

    expect(out.counterparty.party_name).toBe(PARTY.party_name);
    const [first, second] = out.counterparty.signatories;
    // `source_ref` is what attributes the address on the certificate. A
    // candidate without one would be indistinguishable from a typed address.
    expect(first).toMatchObject({
      source: "ON_FILE",
      source_ref: "client_contact:c-1",
      full_name: "Aïssatou Njoya",
      party_role: "Procurement Manager",
      email: "a.njoya@scc.cm",
      language: "fr",
      is_primary: true,
    });
    // A contact with no language of their own inherits the party's, which is
    // the language their signing email and the document will be in.
    expect(second.language).toBe("fr");
  });

  test("the client's own address is offered when no contact already carries it", async () => {
    // A great many client_master rows have an email and no contacts at all.
    // Without this the only way to send to them is an override on every send,
    // which empties the one-override cap of meaning.
    const client = makeClient({ party: PARTY, contacts: [] });
    const out = await candidates.list(client, { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });
    expect(out.counterparty.signatories).toHaveLength(1);
    expect(out.counterparty.signatories[0]).toMatchObject({
      source: "ON_FILE",
      source_ref: "client_master:client-1",
      email: "contact@scc.cm",
      is_primary: true,
    });
  });

  test("it is not offered twice when a contact already holds the same address", async () => {
    const client = makeClient({
      party: PARTY,
      contacts: [{ contact_id: "c-1", name: "Reception", title: null, email: "CONTACT@scc.cm", language: null, is_primary: true }],
    });
    const out = await candidates.list(client, { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });
    // Case-insensitively: an address is the same address whatever its casing,
    // and two rows for one mailbox is two links for one person.
    expect(out.counterparty.signatories).toHaveLength(1);
    expect(out.counterparty.signatories[0].source_ref).toBe("client_contact:c-1");
  });

  test("a contact with no address is dropped, not offered disabled", async () => {
    // This list answers "who can receive a signing link". A row that cannot is
    // not an answer — and showing it greyed out invites an operator to override
    // the address of somebody we already hold, which is the exact move §6.3
    // exists to prevent. The SQL does the filtering; this pins that it does.
    const client = makeClient({ party: PARTY, contacts: [] });
    await candidates.list(client, { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });
    const contactQuery = client.seen.find((q) => /FROM client_contact/.test(q.sql));
    expect(contactQuery.sql).toMatch(/email IS NOT NULL/);
    expect(contactQuery.sql).toMatch(/is_active/);
  });

  test("internal signatories are our own users, unfiltered by role", async () => {
    // Who inside the company may attest is an RBAC question, enforced when the
    // signature is taken (MOD-64 approve). Shortening the list here would make
    // that failure silent instead of explicit.
    const client = makeClient({
      party: PARTY,
      users: [{ user_id: "u-1", full_name: "Jean Mbarga", job_title: "Commercial Director", email: "j.mbarga@smartls.cm" }],
    });
    const out = await candidates.list(client, { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });
    expect(out.internal).toEqual([{
      source: "ON_FILE",
      source_ref: "app_user:u-1",
      full_name: "Jean Mbarga",
      party_role: "Commercial Director",
      email: "j.mbarga@smartls.cm",
      language: null,
      is_primary: false,
    }]);
  });

  test("an unknown doc type returns internal signatories and no guess", async () => {
    // A cash request has no counterparty. Returning null is the honest answer;
    // inventing one would put a stranger's address in front of the sender.
    const client = makeClient({ party: PARTY, users: [] });
    const out = await candidates.list(client, { docType: "CASH_REQUEST", entityRef: "cash_request:cr-1" });
    expect(out.counterparty).toBeNull();
    expect(out.internal).toEqual([]);
  });

  test("the doc-type map cannot be walked into Object.prototype", async () => {
    // `docType` reaches here from a query string. The identical shape in
    // canonical.js — a plain object indexed by that string — resolved
    // ["constructor"] to a truthy, CALLABLE Object and sailed past a
    // `if (!sql) return` guard (CodeQL js/unvalidated-dynamic-method-call).
    expect(candidates.COUNTERPARTY_SQL).toBeInstanceOf(Map);
    expect(candidates.COUNTERPARTY_SQL.get("constructor")).toBeUndefined();
    const out = await candidates.list(makeClient({}), { docType: "constructor", entityRef: "x:1" });
    expect(out.counterparty).toBeNull();
  });

  test("a database failure loses the list, never the send", async () => {
    // Best-effort by design: a screen that cannot list candidates must still
    // offer the attributed-override path, which beats refusing to send at all.
    const broken = { query: async () => { throw new Error("relation does not exist"); } };
    const out = await candidates.list(broken, { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });
    expect(out).toEqual({ counterparty: null, internal: [], can_override: true, max_overrides: 1 });
  });

  test("the record id is taken from the ref, and a malformed ref resolves nothing", async () => {
    expect(candidates.recordIdOf("transit_order:abc-123")).toBe("abc-123");
    expect(candidates.recordIdOf("transit_order")).toBeNull();
    expect(candidates.recordIdOf("")).toBeNull();
    expect(candidates.recordIdOf(null)).toBeNull();
    const out = await candidates.list(makeClient({ party: PARTY }), { docType: "TRANSIT_ORDER", entityRef: "transit_order" });
    expect(out.counterparty).toBeNull();
  });

  test("the cap is stated, not left to be discovered as a 422", async () => {
    const out = await candidates.list(makeClient({}), { docType: "TRANSIT_ORDER", entityRef: "transit_order:to-1" });
    expect(out.max_overrides).toBe(1);
    expect(out.can_override).toBe(true);
  });
});
