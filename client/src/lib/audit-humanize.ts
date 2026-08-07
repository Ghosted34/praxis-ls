/**
 * Turn a raw ledger row into a sentence a person would recognise.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Before this, `humanizeEvent(action) + " · " +
 * humanizeRef(entity_ref)` produced strings like
 * "Auth token refreshed · App user c2d39ee8", and every recent-activity
 * surface — Workspace, Governance, notifications — rendered the same
 * mechanical shape. It reads like a debug log, not human activity. This
 * file's job is to produce the sentence a user would actually write for
 * their own action: "You signed in", "You sent a message in Ops", "You
 * changed a role's permissions".
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Four layers, checked in order:
 *
 *   1. SPECIALS. Hand-written sentences for events where the mechanical
 *      derivation reads badly (login, message posted, God-Mode). Always
 *      preferred when the action key matches — it is one bit of data per
 *      row, so a table lookup is fastest and unambiguous.
 *
 *   2. VERB + NOUN. `<domain>.<object>.<verb>` splits into a verb from
 *      VERBS and a noun from NOUN_ARTICLE (via entity_ref if we have one),
 *      composed as "You <past-tense verb> <a/an object>".
 *
 *   3. "<FIELD>_CHANGED". `<domain>.<field>_changed` (vehicle.status_changed,
 *      entity.structure_changed, …) isn't a verb VERBS can match — the whole
 *      segment is the key, not just "changed" — so it gets its own reading:
 *      "You changed <a/an object>'s <field>".
 *
 *   4. GENERIC FALLBACK. "You did <verb> on <a/an object>", never the raw
 *      key. If nothing matches, the row still reads as English.
 *
 * Every path returns a `kind` in the same closed union, mapped to a Pill
 * `Tone` at the render site (see `kindToTone`), so the icon tint stays
 * consistent across the widget.
 */
import type { Tone } from "@/components/ui/pill";
import type { AuditFeedRow } from "@/features/dashboard/use-my-audit-feed";

export type Kind =
  | "security"
  | "message"
  | "send"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "money"
  | "export"
  | "view"
  | "generic";

/**
 * Kind → Pill tone. The tone drives the icon well's tint and, when the
 * detail modal opens, the "Sensitive" pill's colour. Keep this map explicit
 * so the widget can render a legend without divining it from CSS.
 */
export const kindToTone: Record<Kind, Tone> = {
  security: "blue",
  message: "blue",
  send: "blue",
  create: "ok",
  approve: "ok",
  update: "warn",
  export: "warn",
  delete: "bad",
  reject: "bad",
  // No dedicated 'accent' tone in the Pill union — 'orange' is the accent
  // colour in the design system. Money uses it so a payment/receipt stands
  // apart from a generic update.
  money: "orange",
  view: "mute",
  generic: "mute",
};

// ── Layer 1: specials ────────────────────────────────────────────────────
//
// Sentences written for the surface, keyed on the exact `action` string a
// service emits today. When the key matches, the sentence + kind are used
// verbatim — the verb/noun derivation below is never consulted. This is
// where we make particular events read like sentences a person wrote.
//
// The value is either a string or a function of the row's metadata (so
// `comms.message_posted` can name the channel when the emitter knows one).

type SpecialText =
  | { text: string; kind: Kind; sensitive?: boolean }
  | ((meta: Record<string, unknown> | null) => { text: string; kind: Kind; sensitive?: boolean });

const SPECIALS: Record<string, SpecialText> = {
  // ── auth ──────────────────────────────────────────────────────────────
  // `auth.token_refreshed` is deliberately absent — the emit was removed on
  // the server (see src/modules/security/app_user/app_user.service.js) and
  // any legacy row falls through to the generic derivation.
  "auth.login_succeeded": { text: "You signed in", kind: "security" },
  "auth.login_failed": { text: "You had a failed sign-in attempt", kind: "security" },
  "auth.logged_out": { text: "You signed out", kind: "security" },
  "app_user.logged_out": { text: "You signed out", kind: "security" },
  "auth.password_reset_requested": { text: "You requested a password reset", kind: "security" },
  "app_user.password_reset_requested": { text: "You requested a password reset", kind: "security" },
  "auth.password_reset_completed": { text: "You reset your password", kind: "security" },
  "app_user.password_reset_completed": { text: "You reset your password", kind: "security" },
  "app_user.password_set": { text: "You changed your password", kind: "security" },
  "auth.2fa_enabled": { text: "You enabled two-factor auth", kind: "security" },
  "app_user.2fa_enabled": { text: "You enabled two-factor auth", kind: "security" },
  "auth.2fa_disabled": { text: "You disabled two-factor auth", kind: "security" },
  "app_user.2fa_disabled": { text: "You disabled two-factor auth", kind: "security" },

  // ── attendance ────────────────────────────────────────────────────────
  "attendance.clocked_in": { text: "You clocked in", kind: "create" },
  "attendance.clocked_out": { text: "You clocked out", kind: "update" },
  "attendance.offsite_clock_in": { text: "You clocked in off-site", kind: "create" },

  // ── comms (messaging) ─────────────────────────────────────────────────
  "comms.message_posted": (meta) => {
    const channel = meta && typeof meta.channel_name === "string" ? meta.channel_name : null;
    return {
      text: channel ? `You sent a message in ${channel}` : "You sent a message",
      kind: "send",
    };
  },
  "comms.certified_export": { text: "You exported a conversation", kind: "export" },

  // ── RBAC / governance ─────────────────────────────────────────────────
  // permission.changed is emitted through events.UPDATED (see
  // permission.service.js:159); the humaniser matches on the concrete key.
  "permission.changed": { text: "You changed a role's permissions", kind: "security", sensitive: true },
  "permission.updated": { text: "You changed a role's permissions", kind: "security", sensitive: true },
  // iam_role.events.js maps CREATED/UPDATED/ARCHIVED all onto the single
  // security-critical key 'role.changed' (seeded in 9020_seed_rbac_events.sql)
  // — there is no 'role.created' / 'role.updated' / 'role.archived' emitted
  // anywhere in the codebase, so those three keys (the previous shape of this
  // entry) never actually matched and every role change fell through to the
  // generic fallback as "You did changed on a role".
  "role.changed": { text: "You changed a role", kind: "security", sensitive: true },
  // capability.service.js#setForUser deliberately emits 'role.changed' for the
  // Watch-the-Watcher notification but audits under this more specific key —
  // same fix as above, matched on what's actually written.
  "user.capability.changed": { text: "You changed a user's capabilities", kind: "security", sensitive: true },
  "field_visibility.changed": { text: "You changed field visibility", kind: "security", sensitive: true },
  "capability.assigned": { text: "You assigned a capability", kind: "security" },
  "capability.revoked": { text: "You revoked a capability", kind: "security" },

  // ── access reviews ────────────────────────────────────────────────────
  "access_review.created": { text: "You started an access review", kind: "security" },
  "access_review.completed": { text: "You completed an access review", kind: "security" },
  "access_review.entry.decided": { text: "You decided an access-review entry", kind: "security" },

  // ── ledger restore ────────────────────────────────────────────────────
  "audit_ledger.restored": { text: "You restored a deleted record", kind: "create" },
  "soft_delete.restored": { text: "You restored a deleted record", kind: "create" },
  "soft_delete.restore_requested": { text: "You requested a restore", kind: "update" },

  // ── HR recruitment (vacancy.service.js) ─────────────────────────────────
  // Both actions audit under the multi-word key `applicant_added` /
  // `applicant_updated`, which VERBS can't split into a verb — it fell
  // through to the generic layer as "You did applicant updated on a
  // vacancy" (VERBS has no "applicant_updated" entry, and entity_ref is
  // `vacancy:<id>`, not an applicant, so even the noun read wrong).
  "vacancy.applicant_added": { text: "You added an applicant to a vacancy", kind: "create" },
  "vacancy.applicant_updated": { text: "You updated an applicant", kind: "update" },
  // Emitted once, on the HIRED transition, when the applicant's employee
  // record is provisioned (vacancy.service.js:72). No domain prefix at all,
  // so it never had a shot at the verb table.
  "employee_provisioned": { text: "You hired an applicant", kind: "create" },

  // ── client/supplier Smart Copy conversion (party-lifecycle.service.js) ──
  // Action key is `${toKind}.converted_from_${fromKind}` — "converted_from_
  // client" isn't a verb VERBS recognises, so this read as "You did
  // converted from client on a supplier".
  "client.converted_from_supplier": { text: "You converted a supplier into a client", kind: "create" },
  "supplier.converted_from_client": { text: "You converted a client into a supplier", kind: "create" },
};

// God-Mode is always sensitive and always says the same thing at the
// coarsest granularity, so a prefix match (not an exact match) covers the
// whole family (godmode.purge, godmode.something_new_someone_adds_later).
function godmodeSpecial(action: string): { text: string; kind: Kind; sensitive: boolean } | null {
  if (action.startsWith("godmode.")) {
    return { text: "You ran a God-Mode action", kind: "security", sensitive: true };
  }
  return null;
}

// ── Layer 2: verb table ──────────────────────────────────────────────────
//
// The past-tense verb and a kind. Handles both bare verbs ("create") and the
// already-past forms services emit ("created", "posted") — the emit
// convention is inconsistent enough (see `grep -rn "action:" src/modules/`)
// that recognising both is easier than fixing every call site.

const VERBS: Record<string, { past: string; kind: Kind }> = {
  create:   { past: "created",  kind: "create" },
  created:  { past: "created",  kind: "create" },
  post:     { past: "posted",   kind: "create" },
  posted:   { past: "posted",   kind: "create" },
  update:   { past: "updated",  kind: "update" },
  updated:  { past: "updated",  kind: "update" },
  edit:     { past: "edited",   kind: "update" },
  edited:   { past: "edited",   kind: "update" },
  archive:  { past: "archived", kind: "delete" },
  archived: { past: "archived", kind: "delete" },
  delete:   { past: "deleted",  kind: "delete" },
  deleted:  { past: "deleted",  kind: "delete" },
  restore:  { past: "restored", kind: "create" },
  restored: { past: "restored", kind: "create" },
  approve:  { past: "approved", kind: "approve" },
  approved: { past: "approved", kind: "approve" },
  reject:   { past: "rejected", kind: "reject" },
  rejected: { past: "rejected", kind: "reject" },
  send:     { past: "sent",     kind: "send" },
  sent:     { past: "sent",     kind: "send" },
  export:   { past: "exported", kind: "export" },
  exported: { past: "exported", kind: "export" },
  grant:    { past: "granted",  kind: "security" },
  granted:  { past: "granted",  kind: "security" },
  revoke:   { past: "revoked",  kind: "security" },
  revoked:  { past: "revoked",  kind: "security" },
  view:     { past: "viewed",   kind: "view" },
  viewed:   { past: "viewed",   kind: "view" },
  login:    { past: "signed in", kind: "security" },
  logout:   { past: "signed out", kind: "security" },
  // Money-flavoured verbs — 'posted' the accounting verb is above; these are
  // the payment/receipt half.
  paid:     { past: "paid",      kind: "money" },
  received: { past: "received",  kind: "money" },
  refunded: { past: "refunded",  kind: "money" },
  // Doc/lock lifecycle
  locked:   { past: "locked",    kind: "update" },
  unlocked: { past: "unlocked",  kind: "update" },
  activated:   { past: "activated",   kind: "create" },
  deactivated: { past: "deactivated", kind: "delete" },
  signed_off:  { past: "signed off",  kind: "approve" },
  published:   { past: "published",   kind: "create" },
  triaged:     { past: "triaged",     kind: "update" },
  converted:   { past: "converted",   kind: "create" },
  // party-lifecycle.service.js (client/supplier hard-block gate) and
  // marketing_campaign.service.js (campaign_sender.verified) — generic here
  // rather than one-off SPECIALS because the noun comes straight out of
  // entity_ref/NOUN_ARTICLE ("a client", "a supplier", "a campaign sender").
  verified:    { past: "verified",    kind: "approve" },
  blocked:     { past: "blocked",     kind: "security" },
  unblocked:   { past: "unblocked",   kind: "update" },
  // Bare "changed" — 'role.changed' and 'ai.feature.changed' both end in a
  // plain "changed" segment. The far more common "<field>_changed" shape
  // (vehicle.status_changed, entity.structure_changed, …) is NOT this — see
  // the dedicated composition below, since "status_changed" as a whole is
  // not a key in this table.
  changed:     { past: "changed",     kind: "update" },
};

// ── Nouns from entity_ref ────────────────────────────────────────────────
//
// The article ("a"/"an") is bundled with the noun so grammar is one lookup:
// splitting on the first vowel produces "a apple" bugs the first time
// someone adds an entity called `attendance`. Enumerated on purpose — an
// unknown entity_ref type falls through to the generic phrasing below.

const NOUN_ARTICLE: Record<string, string> = {
  final_invoice: "an invoice",
  proforma: "a proforma",
  invoice: "an invoice",
  sales_order: "an order",
  purchase_order: "a purchase order",
  purchase_request: "a purchase request",
  role: "a role",
  permission: "a permission",
  app_user: "a user",
  user: "a user",
  dossier: "an operation file",
  vehicle: "a vehicle",
  driver: "a driver",
  journal_entry: "a journal entry",
  payment: "a payment",
  receipt: "a receipt",
  client: "a client",
  lead: "a lead",
  quote: "a quotation",
  quotation: "a quotation",
  proposal: "a proposal",
  opportunity: "an opportunity",
  meeting: "a meeting",
  campaign: "a campaign",
  success_story: "a success story",
  contact_enquiry: "an enquiry",
  partnership_request: "a partnership request",
  supplier: "a supplier",
  supplier_invoice: "a supplier invoice",
  employee: "an employee",
  attendance: "an attendance record",
  work_site: "a work site",
  costing: "a costing",
  credit_note: "a credit note",
  soft_delete: "a soft-deleted record",
  access_review: "an access review",
  access_review_entry: "a review entry",
  setting: "a setting",
  numbering: "a numbering scheme",
  entity: "a corporate entity",
  vacancy: "a vacancy",
  capability: "a capability",
  work_order: "a work order",
  hr_contract: "an HR contract",
  training: "a training",
  incident: "an incident",
  equipment: "a piece of equipment",
  inventory: "an inventory record",
  fleet_dispatch: "a dispatch",
  ai_feature: "an AI feature",
  ai_vendor: "an AI vendor",
  ai_grant: "an AI grant",
  ai_budget: "an AI budget",
  comms_message: "a message",
  comms_group: "a channel",
  channel: "a channel",
  campaign_sender: "a campaign sender",
  fx: "an exchange rate",
  account: "an account",
  treasury_account: "a treasury account",
  payment_gateway: "a payment gateway",
  tax_code: "a tax code",
  tax_jurisdiction: "a tax jurisdiction",
  expense_rate: "an expense rate",
};

/**
 * Extract the entity type from `entity_ref` (e.g. "sales_order:UUID" → "sales_order").
 * Returns null when the ref is empty or has no ":" separator (e.g. an opaque
 * string ref) — the generic phrasing takes over from there.
 */
function refType(entityRef: string | null | undefined): string | null {
  if (!entityRef) return null;
  const i = entityRef.indexOf(":");
  if (i === -1) return null;
  const t = entityRef.slice(0, i).toLowerCase();
  return t || null;
}

/** Look up "a foo" for an entity_ref type. */
function nounFromRef(entityRef: string | null | undefined): string | null {
  const t = refType(entityRef);
  return t ? NOUN_ARTICLE[t] || null : null;
}

/**
 * Fallback noun when neither NOUN_ARTICLE nor entity_ref covers it: derive
 * from the middle segment of the action key. "sales.opportunity.stage_moved"
 * → "opportunity" (via ARTICLE_FOR + spacing).
 */
function ARTICLE_FOR(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * The main entry point. Given a ledger row, return the sentence to render
 * and the kind for the tint.
 *
 * The returned `sensitive` mirrors any special that flagged sensitivity — but
 * the caller should OR it with `row.is_sensitive` (the server's own flag) so
 * the badge appears whenever EITHER side wants it to. That way a per-row
 * server override (a break-glass grant, say) still shows even if the humaniser
 * doesn't know the specific action key.
 */
export function humanize(row: AuditFeedRow): { text: string; kind: Kind; sensitive: boolean } {
  const action = String(row.action || "").trim();

  // 1. Godmode.* always wins — the action family is defined by prefix.
  const gm = godmodeSpecial(action);
  if (gm) return gm;

  // 2. Exact-match special.
  const special = SPECIALS[action];
  if (special) {
    const resolved = typeof special === "function" ? special(row.metadata || null) : special;
    return { text: resolved.text, kind: resolved.kind, sensitive: resolved.sensitive === true };
  }

  // 3. Verb + noun.
  const parts = action.split(".").filter(Boolean);
  const lastSeg = parts[parts.length - 1] || "";
  const midSeg = parts.length >= 2 ? parts[parts.length - 2] : null;

  const verb = VERBS[lastSeg.toLowerCase()];
  const noun = nounFromRef(row.entity_ref) || (midSeg ? NOUN_ARTICLE[midSeg.toLowerCase()] : null);

  if (verb && noun) {
    return { text: `You ${verb.past} ${noun}`, kind: verb.kind, sensitive: false };
  }
  if (verb) {
    // No object we can name — either no entity_ref and no mid segment, or a
    // ref we don't have a friendly noun for. Read the mid segment as a noun
    // fallback ("You created a lead" for `sales.lead.created` even without
    // `lead` in NOUN_ARTICLE, via ARTICLE_FOR spacing).
    const fallbackNoun = midSeg
      ? `${ARTICLE_FOR(midSeg)} ${midSeg.replace(/_/g, " ")}`
      : null;
    return {
      text: fallbackNoun ? `You ${verb.past} ${fallbackNoun}` : `You ${verb.past} something`,
      kind: verb.kind,
      sensitive: false,
    };
  }

  // 3b. "<field>_changed" — e.g. "vehicle.status_changed",
  // "entity.structure_changed", "party.bank_account_changed",
  // "inventory.state_changed". VERBS is an exact-match lookup on the whole
  // last segment, so it can't split this shape into a verb at all (grep
  // `_changed"` across src/modules/*.events.js — a dozen-plus call sites use
  // it). Rather than let every one of those fall to the generic "You did
  // status changed on a vehicle", pull the field name back out and read it
  // as "You changed <noun>'s <field>".
  const changedMatch = /^(.+)_changed$/.exec(lastSeg.toLowerCase());
  if (changedMatch) {
    const field = changedMatch[1].replace(/_/g, " ");
    const changedNoun =
      nounFromRef(row.entity_ref) ||
      (midSeg ? NOUN_ARTICLE[midSeg.toLowerCase()] : null) ||
      (midSeg ? `${ARTICLE_FOR(midSeg)} ${midSeg.replace(/_/g, " ")}` : null);
    return {
      text: changedNoun ? `You changed ${changedNoun}'s ${field}` : `You changed the ${field}`,
      kind: "update",
      sensitive: false,
    };
  }

  // 4. Generic fallback — "You did <verb> on <a/an object>".
  const readableVerb = (lastSeg || "did something").replace(/_/g, " ");
  const readableNoun =
    nounFromRef(row.entity_ref) ||
    (midSeg ? `${ARTICLE_FOR(midSeg)} ${midSeg.replace(/_/g, " ")}` : null);
  return {
    text: readableNoun ? `You did ${readableVerb} on ${readableNoun}` : `You did ${readableVerb}`,
    kind: "generic",
    sensitive: false,
  };
}
