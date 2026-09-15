"use strict";
/**
 * entity_ref → the screen that shows it. One map, because BOTH sides need the
 * same answer and they need it at different moments.
 *
 * ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
 *
 * A notification row carries `entity_ref` ("email_thread:39cb…") and nothing
 * else that points anywhere. The bell rendered each row as a button whose only
 * handler was `markRead`, so clicking a notification marked it read and left
 * the user exactly where they were — and on an already-read row the handler was
 * guarded off entirely, making it an inert button. The full inbox was the same:
 * a `DataList` with no `onRowClick`, on a component that has supported one all
 * along. Both surfaces knew WHAT happened and refused to say WHERE.
 *
 * The `url` that `notify()` has always accepted only ever reached web-push, was
 * never stored on the row, and five producers in the whole backend passed one —
 * so the in-app list could not have used it even if it wanted to.
 *
 * ── WHY THE MAP IS HERE AND NOT IN EITHER SIDE ─────────────────────────────
 *
 * The server needs it when the notification is WRITTEN, to stamp `link_url` on
 * the row and to aim the push. The client needs it when a row is DRAWN, because
 * every notification written before that column existed has a null `link_url`
 * and a perfectly good `entity_ref`. Two copies of a route table is two copies
 * that drift, and a drifted route does not throw — it matches `path="*"` and
 * redirects to the dashboard, which is indistinguishable from the dead click
 * this exists to fix.
 *
 * That is not hypothetical. Both hand-written deep links in the tree were
 * already wrong when this was added: `/costing/costings/<id>` (the route is
 * `costing/costing/:costingId`) and `/settings/notifications` (the route is
 * `/notifications`). Neither 404s. Both silently land on the Control Tower.
 * `entity-route.test.js` now checks every path here against the real router.
 */

/**
 * Types with a detail route of their own — the id is addressable, so the link
 * opens the record itself. Keys are the `entity_ref` prefix; values take the id.
 *
 * Verified against client/src/app/app.tsx by entity-route.test.js. A path added
 * here that the router does not serve fails that test rather than production.
 */
const DETAIL = {
  lead: (id) => `/sales/leads/${id}`,
  quote_request: (id) => `/sales/quote-requests/${id}`,
  dossier: (id) => `/operations/files/${id}`,
  transit_order: (id) => `/operations/transit-orders/${id}`,
  delivery_note: (id) => `/operations/delivery-notes/${id}`,
  costing: (id) => `/costing/costing/${id}`,
  cash_request: (id) => `/costing/cash-requests/${id}`,
  corporate_entity: (id) => `/master/corporate-entities/${id}`,
  treasury_account: (id) => `/master/treasury-accounts/${id}`,
  insight_article: (id) => `/settings/website/articles/${id}`,
  // Not a path segment: the inbox reads `?thread=` as its initial selection
  // (features/comms/inbox/index.tsx) and strips it afterwards, so a refresh
  // does not reopen it. This is the shape mail-notify has always sent.
  email_thread: (id) => `/comms/mail?thread=${encodeURIComponent(id)}`,
  // Same shape: the Support & Feedback list (features/support/support-page.tsx)
  // reads `?ticket=` as its initial selection. The ticket row has no path of
  // its own — the thread is a modal on the list, like the mail inbox.
  support_ticket: (id) => `/support?ticket=${encodeURIComponent(id)}`,
};

/**
 * Types with no addressable detail route. The link goes to the list that holds
 * the record.
 *
 * A section landing is worth having rather than withholding: "Payroll posted"
 * opening Payroll is one click from the run, where the dead click was an
 * unbounded hunt. But it is deliberately a SECOND tier — `linkFor` reports
 * which kind it returned so the UI can say "Open Payroll" rather than implying
 * it is about to show the exact record.
 *
 * Section keys are the ones in client/src/app/layout/areas.ts. A key that is
 * not a real section of that area is the `/settings/notifications` bug again,
 * so the test checks these too.
 */
const SECTION = {
  // Finance
  invoice: "/finance/invoices",
  final_invoice: "/finance/invoices",
  proforma: "/finance/proformas",
  payment: "/finance/receivables",
  credit_note: "/finance/credit-notes",
  journal_entry: "/finance/journals",
  accounting_period: "/finance/journals",
  tax_declaration: "/finance/tax",
  asset: "/finance/assets",
  // Sales & CRM
  opportunity: "/sales/opportunities",
  proposal: "/sales/proposals",
  contact_enquiry: "/sales/enquiries",
  partnership_request: "/sales/partnerships",
  campaign: "/sales/campaigns",
  // Procurement
  purchase_request: "/procurement/purchase-requests",
  purchase_order: "/procurement/purchase-orders",
  goods_received: "/procurement/goods-received",
  supplier_invoice: "/procurement/supplier-invoices",
  // People & HR
  employee: "/hr/employees",
  payroll: "/hr/payroll",
  payroll_run: "/hr/payroll",
  advance: "/hr/advances",
  vacancy: "/hr/vacancies",
  hr_contract: "/hr/contracts",
  leave_allowance: "/hr/leave",
  leave_request: "/hr/leave",
  // Fleet
  vehicle: "/fleet/vehicles",
  driver: "/fleet/drivers",
  incident: "/fleet/incidents",
  work_order: "/fleet/work-orders",
  // Vault & compliance
  compliance_flag: "/vault/compliance-flags",
  document_vault: "/vault/documents",
  document_signature: "/vault/signatures",
  // Master data
  client: "/master/clients",
  supplier: "/master/suppliers",
  service_type: "/master/service-types",
  // Security & access — the Watch-the-Watcher audience lands on the screen the
  // change was made on, which is the whole point of being told about it.
  app_user: "/security/users",
  role: "/security/roles",
  permission: "/security/permissions",
  field_visibility: "/security/field-visibility",
  user_capability: "/security/capabilities",
  session: "/security/sessions",
  // Governance — routed at the top level, not under /governance (see areas.ts).
  workflow: "/workflows",
  workflow_step: "/workflows",
  approval_task: "/approvals",
  // Comms
  email_connection: "/comms/setup",
};

/**
 * Lookup tables, as Maps.
 *
 * ── WHY NOT JUST INDEX THE OBJECT LITERALS ─────────────────────────────────
 *
 * `DETAIL[type]` walks the prototype chain, and `type` is the first half of an
 * `entity_ref` — a string from the database, not a key anyone checked. Three
 * real results, found by CodeQL on the commit that introduced them:
 *
 *   constructor:x → DETAIL.constructor is Object, so `detail(id)` called
 *                   Object("x") and returned "x" as the URL
 *   toString:x    → returned the string "[object Undefined]" as the URL
 *   valueOf:y     → THREW a TypeError
 *
 * The last one is the one that matters: `linkFor` runs while a notification row
 * renders, so a single stored ref beginning `valueOf:` takes down the bell and
 * the inbox with it — a crash, in the component whose whole job is to be
 * clicked. Turning a dead click into a broken screen is not a trade worth
 * making.
 *
 * `Object.entries` reads own enumerable properties only, so nothing inherited
 * ever enters these Maps, and `Map.get` has no prototype to walk in the first
 * place. The literals above stay as the readable source and the exported shape;
 * these are what the lookups actually use.
 */
const DETAIL_BY_TYPE = new Map(Object.entries(DETAIL));
const SECTION_BY_TYPE = new Map(Object.entries(SECTION));

/** Split "email_thread:39cb…" into its two halves. A ref with no colon is a
 *  type on its own (a few producers emit one); a ref with extra colons keeps
 *  them in the id, since only the FIRST separates type from id. */
function parseRef(entityRef) {
  const s = String(entityRef || "").trim();
  if (!s) return null;
  const i = s.indexOf(":");
  if (i === -1) return { type: s, id: "" };
  const type = s.slice(0, i);
  const id = s.slice(i + 1);
  return type ? { type, id } : null;
}

/**
 * Where a notification about `entityRef` should take the reader.
 *
 * Returns `{ url, precision }` or null. `precision` is "record" when the link
 * opens the thing itself and "section" when it opens the list that holds it —
 * the caller decides how to word the affordance, and the difference matters:
 * promising a record and delivering a list is a smaller version of the same
 * broken promise this module exists to end.
 *
 * Null for a ref that maps nowhere (a `domain:` deliverability alert), for a
 * detail type whose id is missing, and for no ref at all — a God Mode PIN has
 * no entity and no page, and inventing `/notifications` for it would send the
 * reader back to the list they clicked from.
 */
function linkFor(entityRef) {
  const parsed = parseRef(entityRef);
  if (!parsed) return null;
  const { type, id } = parsed;
  // The `typeof` checks are not ceremony around the Maps: they are what makes
  // the dispatch below safe to read as well as safe to run, and they cost one
  // comparison on a path that runs once per rendered row.
  const detail = DETAIL_BY_TYPE.get(type);
  // A detail route without an id cannot be built. Fall through to the section
  // when the type also has one, rather than returning nothing.
  if (typeof detail === "function" && id) {
    return { url: detail(id), precision: "record" };
  }
  const section = SECTION_BY_TYPE.get(type);
  if (typeof section === "string" && section) {
    return { url: section, precision: "section" };
  }
  return null;
}

/** Just the path, for callers that do not care how precise it is. */
function urlFor(entityRef) {
  const hit = linkFor(entityRef);
  return hit ? hit.url : null;
}

/** Every path this module can emit — what the router test asserts against. */
function allRoutes() {
  return [
    ...[...DETAIL_BY_TYPE.values()].map((build) => build("ID")),
    ...SECTION_BY_TYPE.values(),
  ];
}

module.exports = { linkFor, urlFor, parseRef, allRoutes, DETAIL, SECTION };
