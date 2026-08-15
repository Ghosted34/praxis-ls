"use strict";
/**
 * A DRAFT must not leak into anything that enumerates operations files.
 *
 * WHY THIS IS A BUILD GATE AND NOT A CODE-REVIEW ITEM
 *
 * The creation wizard opens a DRAFT dossier so that documents can be attached
 * before the file is finished — uploads need a real `dossier_id`, and the
 * alternative (legacy's) is that nobody uploads anything at creation. The cost
 * is that a half-typed form is now a row in `dossier`, and forty-three queries
 * across nineteen files read that table: lists, the Control Tower, dashboards,
 * KPI counts, the client portal, milestone SLA sweeps, AI knowledge cards.
 *
 * Auditing those once would have worked on the day it was done and rotted on
 * the first query written afterwards — and the failure is silent. Nobody
 * notices a board report counting four phantom files; they notice it a quarter
 * later and cannot explain it.
 *
 * So the exclusion is a VIEW (`dossier_visible`, migration 0671) and this test
 * inverts the burden: reading the BASE table is the thing that has to be
 * justified, one entry at a time, with a reason. A new enumerating query that
 * forgets fails here, at the moment it is written, with the fix in the message.
 *
 * WHAT COUNTS AS A LEGITIMATE BASE-TABLE READ
 *
 * Fetching a KNOWN dossier_id. You cannot reach a draft you were not given the
 * id of, and the wizard has to be able to read and write its own. Everything
 * else — anything that could return a row the caller did not already name — is
 * an enumeration, and belongs on the view.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

/**
 * Base-table reads that are correct, and why.
 *
 * Every one of these fetches a row whose id the caller already holds. Adding an
 * entry is a deliberate act: if you cannot write the reason, the query probably
 * belongs on the view.
 */
const ALLOW_BASE_TABLE = {
  "modules/operations/operations_file/operations_file.service.js":
    "Owns the draft lifecycle. `sweepDrafts` enumerates drafts ON PURPOSE — it " +
    "is the one query in the codebase whose job is to find them — and the " +
    "delete is scoped to status = 'DRAFT'. The view would return nothing.",
  "modules/operations/dossier_container/dossier_container.service.js":
    "By dossier_id. The wizard edits its own draft's containers before promotion.",
  "modules/operations/shipment_details/shipment_details.repo.js":
    "dossierFor(dossierId) — the projection the wizard reads its own draft through.",
  "modules/operations/itinerary/itinerary.service.js":
    "By dossier_id, to read the service type's itinerary template when validating " +
    "an edit. The wizard adds a last-mile leg to its own DRAFT before promotion, " +
    "so the view would return nothing and the required-leg rule would silently " +
    "not apply to exactly the files being created.",
  "modules/finance/final_invoice/final_invoice.repo.js":
    "Decorates an invoice with its file's ref, by the invoice's own dossier_id.",
  "modules/finance/final_invoice/final_invoice.service.js":
    "Resolves a costing's dossier by costing_id. A costing implies a promoted file.",
  "modules/documents/template/template.service.js":
    "Recipient lookup from a delivery note / transit order id. Neither exists on a draft.",
  "orchestration/handlers/fuel-log-created-dossier-cost.js":
    "By dossier_id, from the event payload.",
  "orchestration/handlers/dossier-created-instantiate-milestones.js":
    "By dossier_id. Runs AT promotion, which is the moment milestones are generated.",
};

/** Every .js under src/, so a new module cannot be added outside the scan. */
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(p);
  }
  return out;
}

/**
 * `FROM dossier` / `JOIN dossier` — but NOT dossier_visible, dossier_container,
 * dossier_id or any other identifier that merely starts with the same eleven
 * letters. The negative lookahead is the whole trick.
 *
 * Built fresh on every call, never shared. A `/g` regex carries `lastIndex`
 * between `.test()` calls, so a single shared instance answers false for every
 * other file it is asked about — which in a test that scans a tree means half
 * the offenders go unreported and the suite passes.
 */
const baseRead = () => /\b(FROM|JOIN)\s+dossier\b(?!_)/gi;

describe("DRAFT files are invisible to everything that enumerates", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const hits = (fs.readFileSync(file, "utf8").match(baseRead()) || []).length;
    if (hits && !ALLOW_BASE_TABLE[rel]) offenders.push({ rel, hits });
  }

  it("no module reads `dossier` directly without a documented reason", () => {
    const msg =
      "These read the dossier BASE table, which includes DRAFT rows:\n\n" +
      offenders.map((o) => `  ${o.rel}  (${o.hits} occurrence(s))`).join("\n") +
      "\n\nA draft is half-finished wizard state, not a file. If the query " +
      "enumerates — a list, a count, a dashboard, the portal — read from " +
      "`dossier_visible` instead. If it fetches a KNOWN dossier_id and must " +
      "see drafts, add it to ALLOW_BASE_TABLE in this test with the reason.";
    expect(offenders.length ? msg : "").toBe("");
  });

  it("every allow-list entry still points at a file that reads the base table", () => {
    // A stale exemption is how an allow-list stops meaning anything: the entry
    // outlives the query, and the next person reads it as permission.
    const stale = Object.keys(ALLOW_BASE_TABLE).filter((rel) => {
      const p = path.join(SRC, rel);
      if (!fs.existsSync(p)) return true;
      return !baseRead().test(fs.readFileSync(p, "utf8"));
    });
    expect(stale).toEqual([]);
  });

  it("the view exists and excludes exactly the draft state", () => {
    const sql = fs.readFileSync(
      path.join(ROOT, "migrations", "tenant", "0671_dossier_draft.sql"),
      "utf8",
    );
    expect(sql).toMatch(/CREATE OR REPLACE VIEW dossier_visible AS/);
    expect(sql).toMatch(/SELECT \* FROM dossier WHERE status <> 'DRAFT'/);
    // `SELECT *`, not a column list: the view has to gain a column the moment
    // `dossier` does, or the next migration silently breaks every reader.
    expect(sql).not.toMatch(
      /CREATE OR REPLACE VIEW dossier_visible AS\s*SELECT\s+[a-z_]+,/,
    );
  });

  it("a draft cannot hold a real ref, and a real file cannot hold a placeholder", () => {
    const sql = fs.readFileSync(
      path.join(ROOT, "migrations", "tenant", "0671_dossier_draft.sql"),
      "utf8",
    );
    // Sequential refs are reconciled by humans; burning one per abandoned draft
    // would leave gaps somebody has to explain.
    expect(sql).toMatch(/chk_dossier_draft_ref/);
    expect(sql).toMatch(/status = 'DRAFT' AND ref LIKE 'DRAFT-%'/);
    expect(sql).toMatch(/status <> 'DRAFT' AND ref NOT LIKE 'DRAFT-%'/);
  });
});
