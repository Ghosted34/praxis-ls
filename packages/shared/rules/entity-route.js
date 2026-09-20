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
 * `notification-link.test.ts` now checks every path here against the real router.
 */

/**
 * Types with a detail route of their own — the id is addressable, so the link
 * opens the record itself. Keys are the `entity_ref` prefix.
 *
 * Verified against client/src/app/app.tsx by `notification-link.test.ts`, which
 * asserts every path emitted here is a route the router serves. A path added
 * here that the router does not serve fails that test rather than production.
 *
 * The values are DATA rather than builder functions.
 *
 * Both directions come out of this one shape. `build()` turns a ref into a path
 * for the notification writer; `parseUrl()` turns a path back into a ref for
 * anything that has to READ one — a link pasted into chat, or a `link_url` a
 * row already carries. Written as functions the first time, this table could
 * only answer the forward question, and the reverse direction would have needed
 * a second table of hand-written regexes beside it. Two copies of a route table
 * is two copies that drift — the exact failure this file exists to prevent — so
 * the pattern is declared once and both directions derive from it.
 *
 * Two shapes, because the router has two shapes:
 *   `prefix`  the id is the next path segment (`/sales/leads/<id>`)
 *   `path` + `query`  the record is query state on a list screen, because the
 *                     record opens in a panel ON that list
 *
 * The `prefix` form does NOT encode the id, exactly as the builders it replaced
 * did not: these ids are uuids generated here, and encoding a uuid changes
 * nothing while encoding a hand-written ref would change the URL a reader has
 * bookmarked. The `query` form does encode, as it always did.
 */
const DETAIL = {
  lead: { prefix: "/sales/leads/" },
  quote_request: { prefix: "/sales/quote-requests/" },
  dossier: { prefix: "/operations/files/" },
  transit_order: { prefix: "/operations/transit-orders/" },
  delivery_note: { prefix: "/operations/delivery-notes/" },
  costing: { prefix: "/costing/costing/" },
  cash_request: { prefix: "/costing/cash-requests/" },
  corporate_entity: { prefix: "/master/corporate-entities/" },
  treasury_account: { prefix: "/master/treasury-accounts/" },
  insight_article: { prefix: "/settings/website/articles/" },
  // Not a path segment: the inbox reads `?thread=` as its initial selection
  // (features/comms/inbox/index.tsx) and strips it afterwards, so a refresh
  // does not reopen it. This is the shape mail-notify has always sent.
  email_thread: { path: "/comms/mail", query: "thread" },
  // Same shape: the Support & Feedback list (features/support/support-page.tsx)
  // reads `?ticket=` as its initial selection. The ticket row has no path of
  // its own — the thread is a modal on the list, like the mail inbox.
  support_ticket: { path: "/support", query: "ticket" },
  // My Workspace. The section is the canonical path; the record remains query
  // state because the task/event opens in a panel ON that section. The client
  // still accepts the legacy `?tab=` form through its compatibility adapter so
  // notifications written before this route change remain useful.
  task: { path: "/workspace/tasks", query: "task" },
  calendar_event: { path: "/workspace/calendar", query: "event" },
};

/** The one place a detail URL is assembled. */
function build(spec, id) {
  if (spec.query) return `${spec.path}?${spec.query}=${encodeURIComponent(id)}`;
  return `${spec.prefix}${id}`;
}

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

/**
 * The same table, indexed by what the URL starts with — for the reverse
 * direction.
 *
 * Built once at module load rather than scanned per call, because `parseUrl` runs
 * for every URL in every message body that renders, and a linear scan over
 * fourteen prefixes on each one is work the shape of the data does not require.
 * `prefix` routes are matched on the leading segment because the id follows it;
 * `query` routes are matched on their exact list path.
 */
const PATH_LOOKUPS = [...DETAIL_BY_TYPE.entries()].map(([type, spec]) => ({
  type,
  spec,
  // Longest first, so `/costing/costings` can never be mistaken for
  // `/costing/costing` if a future prefix is a prefix of another one.
  match: spec.query ? spec.path : spec.prefix,
})).sort((a, b) => b.match.length - a.match.length);

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
  // The `spec &&` guard is not ceremony: `type` is the first half of a string
  // from the database, and `DETAIL_BY_TYPE.get("constructor")` is undefined
  // precisely BECAUSE these are Maps. The check keeps the shape assumption
  // (`spec.prefix`, `spec.query`) honest for anything that reaches it.
  const spec = DETAIL_BY_TYPE.get(type);
  // A detail route without an id cannot be built. Fall through to the section
  // when the type also has one, rather than returning nothing.
  if (spec && id) {
    return { url: build(spec, id), precision: "record" };
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

/**
 * The reverse: a path or an absolute URL back to the record it addresses.
 *
 * Returns `{ type, id, precision: "record" }` for a path this table built, and
 * null for anything else — including a section landing, deliberately. A section
 * path (`/hr/payroll`) maps to dozens of records, so reporting a type for it
 * would be inventing an entity that was never in the URL; the caller treats a
 * null here as "an in-app page we can name but not resolve", which is the truth.
 *
 * Accepts a bare path (`/workspace/tasks?task=…`), a root-relative URL, or a
 * full URL on any host — the host is the caller's business (`linkDetect` decides
 * whether it is ours), and the same 80 characters mean the same record whichever
 * of the three it arrived as.
 */
function parseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let path = raw;
  let query = "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    path = url.pathname;
    query = url.search;
  } else {
    const split = path.indexOf("?");
    if (split !== -1) {
      query = path.slice(split);
      path = path.slice(0, split);
    }
  }
  if (!path.startsWith("/")) return null;
  // A trailing slash is the same page to the router and must be the same answer
  // here, or `/operations/files/<id>/` silently stops being a link to a file.
  // A backward walk, not `/\/+$/`: the anchored `+` class is re-tried at every
  // start position, so a path made of slashes and one stray character is quadratic
  // work — and this function is handed whatever a message contained. Same rule,
  // one pass, and `/` itself still answers `/` (a route is not its own trailing
  // slash, but the root has nothing to trim).
  let normalised = path;
  if (normalised.length > 1) {
    let end = normalised.length;
    while (end > 1 && normalised[end - 1] === "/") end -= 1;
    normalised = normalised.slice(0, end);
  }
  const search = new URLSearchParams(query);
  for (const entry of PATH_LOOKUPS) {
    const { spec, type, match } = entry;
    if (spec.query) {
      if (normalised !== match) continue;
      const id = search.get(spec.query);
      if (id) return { type, id, precision: "record" };
      continue;
    }
    if (!normalised.startsWith(match)) continue;
    const id = decodeURIComponent(normalised.slice(match.length));
    // Only a single remaining segment addresses a record: `/operations/files/x/notes`
    // is a sub-resource of the file, not the file, and claiming it as the file
    // would send a chat click somewhere the sender never meant.
    if (id && !id.includes("/")) return { type, id, precision: "record" };
  }
  return null;
}

/** Every path this module can emit — what the router test asserts against. */
function allRoutes() {
  return [
    ...[...DETAIL_BY_TYPE.values()].map((spec) => build(spec, "ID")),
    ...SECTION_BY_TYPE.values(),
  ];
}

module.exports = { linkFor, urlFor, parseRef, parseUrl, allRoutes, DETAIL, SECTION };
