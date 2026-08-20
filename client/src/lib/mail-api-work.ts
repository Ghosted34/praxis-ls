/**
 * Mail API — PR-3 (binding & collaboration), PR-4 (AI) and PR-5 (workflow,
 * security, compliance).
 *
 * Split out of `mail-api.ts`, which had grown past a thousand lines and where
 * this section was the part nobody could see the shape of.
 *
 * ── THE DEFECT THIS FILE WAS EXTRACTED TO FIX ───────────────────────────────
 *
 * Every write in the old PR-3/4/5 block was written as
 *
 *     tenant(path, { method: "POST", body: JSON.stringify(payload) })
 *
 * and `api-client.ts` already does `JSON.stringify(body)` itself, so the server
 * received a JSON *string literal* rather than an object. Express's json parser
 * runs `strict: true` by default and rejects a non-object top level, so every
 * one of those calls 400'd before it reached a route. The rest of `mail-api.ts`
 * had always used `body: payload`; this section was written against a mental
 * model of `fetch` and never exercised end to end.
 *
 * `tests/mail-api-encoding.test.ts` now fails the build on a reintroduction,
 * because the symptom — a 400 with no server-side log line, on every write in
 * one feature area — reads as "the backend is broken" and sends whoever hits it
 * to the wrong half of the stack.
 *
 * ── CONVENTIONS ─────────────────────────────────────────────────────────────
 *
 * · `body:` takes the OBJECT. Never a string.
 * · Response types are declared where the UI depends on the shape. Where the
 *   server returns a passthrough row that only gets rendered as JSON, `unknown`
 *   is honest and a fabricated interface is not.
 * · Anything that spends money on a model call is a POST, including reads like
 *   the thread summary — a GET that can bill the tenant is one a prefetcher
 *   will bill them for twice.
 */
import { tenant } from "./api-client";

/* ═══ PR-3 · Binding ═══════════════════════════════════════════════════════ */

export type BindingSuggestion = {
  email_binding_suggestion_id: string;
  entity_ref: string;
  entity_label?: string | null;
  signal: string;
  matched_text?: string | null;
  confidence: number;
  status: "SUGGESTED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
};

export const listSuggestions = (threadId: string) =>
  tenant<BindingSuggestion[]>(`/mail/threads/${threadId}/suggestions`);
export const acceptSuggestion = (threadId: string, sid: string) =>
  tenant(`/mail/threads/${threadId}/suggestions/${sid}/accept`, { method: "POST", body: {} });
export const rejectSuggestion = (threadId: string, sid: string) =>
  tenant(`/mail/threads/${threadId}/suggestions/${sid}/reject`, { method: "POST", body: {} });
export const bindThread = (threadId: string, entity_ref: string) =>
  tenant(`/mail/threads/${threadId}/bind`, { method: "POST", body: { entity_ref } });
export const unbindThread = (threadId: string) =>
  tenant(`/mail/threads/${threadId}/bind`, { method: "DELETE" });
export const acceptSuggestionBatch = (ids: string[]) =>
  tenant<{ accepted: number }>("/mail/suggestions/accept-batch", { method: "POST", body: { ids } });

/* ═══ PR-3 · The dossier drawer ════════════════════════════════════════════ */

export type ContextTab =
  | "money" | "operations" | "commercial" | "documents" | "interactions" | "compliance";

export type MailContext = {
  kind: "client" | "supplier" | "dossier" | string;
  header: Record<string, unknown>;
  overview: Record<string, unknown>;
  tabs_available: ContextTab[];
};

/** The drawer's header + overview. ONE call — §3.6's 300 ms budget. */
export const mailContext = (entityRef: string) =>
  tenant<MailContext>(`/mail/context?entity_ref=${encodeURIComponent(entityRef)}`);

/**
 * One tab, lazily. §7.5 makes this a design decision rather than an
 * optimisation: "the drawer paints instantly and only the tab you open costs
 * anything."
 *
 * `not_built` is a real answer and the UI must show it as one. An empty `rows`
 * on a supplier's Commercial tab would read as "this supplier has no
 * quotations", which is a statement about the supplier rather than about us.
 */
export type ContextTabData = {
  rows?: unknown[];
  not_built?: boolean;
  [k: string]: unknown;
};
export const mailContextTab = (entityRef: string, tab: ContextTab) =>
  tenant<ContextTabData>(`/mail/context/${tab}?entity_ref=${encodeURIComponent(entityRef)}`);

/* ═══ PR-3 · Action cards ══════════════════════════════════════════════════ */

/**
 * §7.3's two answers and deliberately no third.
 *
 * `ready: false` is NOT a disabled button. It is the same button plus a list of
 * what is missing and WHY each thing is missing — "the thread does not say the
 * incoterm" and "the dossier has no delivery place yet" send the operator to
 * two different places, which is why `why` comes from the card rather than
 * being generated from the field name.
 */
export type CardMissing = { field: string; label: string; why: string };
export type ActionCard = {
  card: string;
  label_en: string;
  label_fr: string;
  ready: boolean;
  target: string;
  prefill: Record<string, unknown>;
  missing: CardMissing[];
  read_only: boolean;
};
export const listCards = (threadId: string) =>
  tenant<{ thread_id: string; entity_ref?: string | null; cards: ActionCard[] }>(
    `/mail/threads/${threadId}/cards`,
  );
export const cardReadiness = (threadId: string, card: string) =>
  tenant<ActionCard>(`/mail/threads/${threadId}/cards/${card}/readiness`);

/* ═══ PR-3 · Internal notes ════════════════════════════════════════════════ */

export type ThreadNote = {
  email_thread_note_id: string;
  author_user_id: string;
  author_name?: string | null;
  body: string;
  created_at: string;
  deleted_at?: string | null;
};
export const listNotes = (threadId: string) =>
  tenant<ThreadNote[]>(`/mail/threads/${threadId}/notes`);
export const addNote = (threadId: string, body: { body: string; mentions?: string[] }) =>
  tenant<ThreadNote>(`/mail/threads/${threadId}/notes`, { method: "POST", body });

/* ═══ PR-3 · Conversion ════════════════════════════════════════════════════ */

export type ConvertTarget =
  | "lead" | "quote_request" | "enquiry" | "ticket" | "task" | "purchase_requisition";

export type Duplicate = { id: string; name?: string | null; score?: number; [k: string]: unknown };

/**
 * A PREVIEW. Q23 = B, always confirm. The record is created by the target
 * module, under its own rights, from a form a human reviewed — which is why
 * `target_module` and `target_route` come back: so the UI can grey an option
 * the caller has no rights for, rather than letting them fill a form and be
 * refused at the end.
 */
export type ConvertPreview = {
  target: ConvertTarget;
  target_module: string;
  target_route: string;
  prefill: Record<string, unknown>;
  duplicates: Duplicate[];
  primary_action: "ATTACH_EXISTING" | "CREATE_NEW";
  hint: string | null;
};
export const convertPreview = (threadId: string, target: ConvertTarget) =>
  tenant<ConvertPreview>(`/mail/threads/${threadId}/convert`, { method: "POST", body: { target } });

/** Called once the target module HAS created something, so the thread shows it. */
export const recordConverted = (threadId: string, entity_ref: string) =>
  tenant(`/mail/threads/${threadId}/converted`, { method: "POST", body: { entity_ref } });

/* ═══ PR-3 · Inbound document intake ═══════════════════════════════════════ */

/**
 * A SUGGESTION. "MUST: never file silently, at any confidence, in this
 * programme." Filing is a separate call with an actor's name on it.
 */
export type IntakeSuggestion = {
  email_attachment_classification_id: string;
  email_attachment_id: string;
  filename?: string | null;
  suggested_doc_type_code: string | null;
  suggested_entity_ref: string | null;
  entity_label?: string | null;
  confidence: number | null;
  matched_on?: string | null;
  status: "SUGGESTED" | "FILED" | "REJECTED";
};
export const listIntake = (threadId: string) =>
  tenant<IntakeSuggestion[]>(`/mail/threads/${threadId}/intake`);
export const fileIntake = (
  id: string,
  body: { doc_type_code?: string; entity_ref?: string } = {},
) => tenant(`/mail/intake/${id}/file`, { method: "POST", body });
export const rejectIntake = (id: string) =>
  tenant(`/mail/intake/${id}/reject`, { method: "POST", body: {} });

export type ChaseList = {
  language?: string;
  nothing_outstanding?: boolean;
  missing: { doc_type_code: string; name_en?: string; name_fr?: string; is_mandatory?: boolean }[];
};
export const chaseList = (clientId: string) =>
  tenant<ChaseList>(`/mail/intake/chase/${clientId}`);

/* ═══ PR-4 · AI ════════════════════════════════════════════════════════════ */

export type AssistTone =
  | "formal" | "friendly" | "concise" | "persuasive" | "apologetic"
  | "payment" | "escalation" | "technical" | "followup" | "notice";
export type AssistAction = "grammar" | "shorten" | "expand" | "to_fr" | "to_en";

/** What the composer's sources strip renders. Each fact names where it came from. */
export type AssistFact = { source: string; module_key: string; text: string };
export type AssistSource = { key: string; label: string; module_key: string; count: number };
export type AssistWithheld = { key: string; label: string; reason: string };

/**
 * `fence` is the mechanical check that every reference, amount, date and
 * percentage in the draft appears in the facts. `needs_review` is its verdict
 * in one boolean.
 *
 * A fenced draft is STILL RETURNED, with `violations` naming the unsupported
 * values. A blank composer teaches people to stop using the feature; a marked
 * one teaches them what the assistant does not know.
 */
export type FenceVerdict = { ok: boolean; violations: string[] };

export type AssistDraft = {
  draft_text: string;
  language: "en" | "fr";
  facts?: AssistFact[];
  sources?: AssistSource[];
  withheld?: AssistWithheld[];
  fence?: FenceVerdict;
  protected_terms_restored?: string[];
  needs_review?: boolean;
  confidence?: number;
  provider?: string | null;
  prompt?: string;
  tone?: string | null;
  action?: string | null;
  /** Present only when there was nothing to ground the draft in. */
  note?: string;
};

export const assistCompose = (body: {
  tone?: AssistTone;
  action?: AssistAction;
  thread_id?: string;
  draft?: string;
  language?: "en" | "fr";
  mode?: string;
}) => tenant<AssistDraft>("/mail/assist/compose", { method: "POST", body });

export const assistDraft = (body: {
  thread_id: string;
  tone?: AssistTone;
  language?: "en" | "fr";
  instruction?: string;
}) => tenant<AssistDraft>("/mail/assist/draft", { method: "POST", body });

export const assistRewrite = (body: {
  text: string;
  action: AssistAction;
  thread_id?: string;
  language?: "en" | "fr";
}) => tenant<AssistDraft>("/mail/assist/rewrite", { method: "POST", body });

export type AssistTranslation = AssistDraft & { protected_terms?: string[] };
export const assistTranslate = (body: {
  text: string;
  to: "en" | "fr";
  thread_id?: string;
}) => tenant<AssistTranslation>("/mail/assist/translate", { method: "POST", body });

/**
 * POST, not GET — a cache miss GENERATES, which spends money and writes
 * `email_thread_summary`.
 *
 * `not_needed` is the answer for a thread under five messages: we decline to
 * spend a model call on something the operator can read faster than we can
 * summarise it, and we say so rather than returning an empty summary.
 */
export type ThreadSummary = {
  email_thread_id: string;
  summary: string | null;
  language: "en" | "fr";
  cached: boolean;
  message_count: number;
  stale_by?: number;
  not_needed?: boolean;
  note?: string;
  generated_at?: string;
  needs_review?: boolean;
};
export const assistSummary = (body: {
  thread_id: string;
  language?: "en" | "fr";
  force?: boolean;
}) => tenant<ThreadSummary>("/mail/assist/summary", { method: "POST", body });

export const assistVoice = (body: {
  transcript: string;
  thread_id?: string;
  tone?: AssistTone;
  language?: "en" | "fr";
}) => tenant<AssistDraft>("/mail/assist/voice", { method: "POST", body });

/**
 * ADVISORY. The authoritative run is inside the send path — see `presend.js`.
 * This exists so the composer can show the bar before the user presses send,
 * not so the client can decide whether the rule applies.
 */
export type GuardrailNote = { code: string; message: string };
export type GuardrailResult = { warnings: GuardrailNote[]; blocks: GuardrailNote[] };
export const assistGuardrails = (body: {
  html?: string;
  text?: string;
  subject?: string;
  to?: string[];
  attachments?: { filename?: string }[];
  htmlBytes?: number;
  ctx?: Record<string, unknown>;
}) => tenant<GuardrailResult>("/mail/assist/guardrails", { method: "POST", body });

/** §8.9 — search by meaning. Every hit is re-filtered through §9.5 server-side. */
export type SemanticHit = {
  email_thread_id: string;
  subject?: string | null;
  entity_ref?: string | null;
  last_message_at?: string | null;
  similarity: number;
};
export const assistSearch = (body: { query: string; limit?: number }) =>
  tenant<{ query: string; hits: SemanticHit[]; searched: number; withheld: number }>(
    "/mail/assist/search", { method: "POST", body },
  );

/* ═══ PR-4 · Attachment extraction ═════════════════════════════════════════ */

export type ExtractionKind =
  | "SUPPLIER_INVOICE" | "RECEIPT" | "CLIENT_PO" | "PROOF_OF_PAYMENT" | "CHEQUE" | "UNKNOWN";

/**
 * A STAGING row. Extraction never writes a business record — `matches` carries
 * the candidate records the fields point at, so the reviewer confirms a link
 * rather than searching for one, and a match at 0.99 needs the same click as
 * one at 0.41.
 */
export type Extraction = {
  attachment_extraction_id: string;
  email_attachment_id: string;
  filename?: string | null;
  doc_kind: ExtractionKind;
  fields: Record<string, unknown>;
  matches: { kind: string; id: string; label?: string; on?: string }[];
  confidence: number | null;
  status: "EXTRACTED" | "REVIEWED" | "DISMISSED" | "FAILED";
  created_at?: string;
};
export const extractAttachment = (attachmentId: string, force = false) =>
  tenant<Extraction>(`/mail/assist/ocr/${attachmentId}`, { method: "POST", body: { force } });
export const listPendingExtractions = (limit = 50) =>
  tenant<Extraction[]>(`/mail/assist/ocr/pending?limit=${limit}`);
export const listMessageExtractions = (messageId: string) =>
  tenant<Extraction[]>(`/mail/messages/${messageId}/extractions`);
export const reviewExtraction = (id: string, fields?: Record<string, unknown>) =>
  tenant<Extraction>(`/mail/assist/extractions/${id}/review`, {
    method: "POST", body: { fields: fields ?? null },
  });
export const dismissExtraction = (id: string) =>
  tenant<Extraction>(`/mail/assist/extractions/${id}/dismiss`, { method: "POST", body: {} });

/* ═══ PR-5 · Triage and the shared inbox ═══════════════════════════════════ */

export type WorkStatus = "OPEN" | "PENDING" | "RESOLVED";

export const claimThread = (threadId: string) =>
  tenant(`/mail/threads/${threadId}/claim`, { method: "POST", body: {} });
export const assignThread = (threadId: string, userId: string) =>
  tenant(`/mail/threads/${threadId}/assign`, { method: "POST", body: { user_id: userId } });
export const setWorkStatus = (threadId: string, status: WorkStatus) =>
  tenant(`/mail/threads/${threadId}/status`, { method: "POST", body: { status } });

/**
 * A SOFT lock. It expires, and taking one never steals a live one — two people
 * typing into the same shared mailbox is the problem, and a lock nobody can
 * release is a worse one.
 */
export type ThreadLock = {
  email_thread_id: string;
  locked_by?: string | null;
  locked_by_name?: string | null;
  expires_at?: string | null;
  taken: boolean;
};
export const takeThreadLock = (threadId: string) =>
  tenant<ThreadLock>(`/mail/threads/${threadId}/lock`, { method: "POST", body: {} });
export const releaseThreadLock = (threadId: string) =>
  tenant<ThreadLock>(`/mail/threads/${threadId}/lock`, { method: "DELETE" });

/* ═══ PR-5 · SLA and the business calendar ═════════════════════════════════ */

export type SlaPolicy = {
  mail_sla_policy_id: string;
  name: string;
  applies_to?: string | null;
  first_response_minutes?: number | null;
  resolution_minutes?: number | null;
  is_active: boolean;
};
export const listSlaPolicies = () => tenant<SlaPolicy[]>("/mail/sla-policies");
export const createSlaPolicy = (body: Record<string, unknown>) =>
  tenant<SlaPolicy>("/mail/sla-policies", { method: "POST", body });
export const updateSlaPolicy = (id: string, body: Record<string, unknown>) =>
  tenant<SlaPolicy>(`/mail/sla-policies/${id}`, { method: "PATCH", body });

export type BusinessCalendar = {
  business_hours?: Record<string, unknown> | null;
  holidays?: { on_date: string; label?: string | null }[];
  timezone?: string | null;
};
export const getBusinessCalendar = () => tenant<BusinessCalendar>("/mail/business-hours");
export const putBusinessHours = (body: Record<string, unknown>) =>
  tenant<BusinessCalendar>("/mail/business-hours", { method: "PUT", body });
export const putHolidays = (holidays: { on_date: string; label?: string }[]) =>
  tenant<BusinessCalendar>("/mail/holidays", { method: "PUT", body: { holidays } });

/* ═══ PR-5 · Follow-ups ════════════════════════════════════════════════════ */

export type Followup = {
  email_followup_id: string;
  email_thread_id: string;
  due_at: string;
  note?: string | null;
  trigger?: string | null;
  status: string;
};
export const snoozeThread = (threadId: string, dueAt: string, note?: string) =>
  tenant<Followup>(`/mail/threads/${threadId}/snooze`, { method: "POST", body: { due_at: dueAt, note } });
export const createFollowup = (threadId: string, body: Record<string, unknown>) =>
  tenant<Followup>(`/mail/threads/${threadId}/followup`, { method: "POST", body });
export const listFollowups = () => tenant<Followup[]>("/mail/followups");
export const cancelFollowup = (id: string) =>
  tenant<Followup>(`/mail/followup/${id}`, { method: "DELETE" });

/* ═══ PR-5 · Secure links ══════════════════════════════════════════════════ */

/**
 * `token` comes back EXACTLY ONCE and is never recoverable — only its SHA-256
 * is stored. "Resend the link" mints a new one, and the UI has to be built
 * knowing that, or someone will add a "copy link again" button that cannot work.
 */
export type SecureLink = {
  secure_link_id: string;
  token?: string;
  url?: string;
  label?: string | null;
  target_kind: "VAULT_DOC" | "GENERATED_PDF";
  expires_at: string;
  revoked_at?: string | null;
  view_count?: number;
};
export const createSecureLink = (body: {
  target_kind: "VAULT_DOC" | "GENERATED_PDF";
  target_ref: string;
  entity_ref?: string;
  label?: string;
  days?: number;
}) => tenant<SecureLink>("/mail/secure-links", { method: "POST", body });
export const listSecureLinks = () => tenant<SecureLink[]>("/mail/secure-links");
export const secureLinkViews = (id: string) =>
  tenant<{ viewed_at: string; user_agent?: string | null }[]>(`/mail/secure-links/${id}/views`);
export const revokeSecureLink = (id: string) =>
  tenant<SecureLink>(`/mail/secure-links/${id}/revoke`, { method: "POST", body: {} });

/* ═══ PR-5 · Visibility, sharing, break-glass ══════════════════════════════ */

export type Visibility = "PRIVATE" | "TEAM" | "COMPANY";

export const setVisibility = (threadId: string, visibility: Visibility) =>
  tenant(`/mail/threads/${threadId}/visibility`, { method: "PATCH", body: { visibility } });

export type ThreadShare = { user_id: string; user_name?: string | null; shared_at?: string };
export const listShares = (threadId: string) =>
  tenant<ThreadShare[]>(`/mail/threads/${threadId}/shares`);
export const shareThread = (threadId: string, userId: string) =>
  tenant<ThreadShare>(`/mail/threads/${threadId}/share`, { method: "POST", body: { user_id: userId } });
export const unshareThread = (threadId: string, userId: string) =>
  tenant(`/mail/threads/${threadId}/share/${userId}`, { method: "DELETE" });

/** CEO only, and it writes a reason to the immutable ledger. */
export const breakglass = (threadId: string, reason: string) =>
  tenant(`/mail/threads/${threadId}/breakglass`, { method: "POST", body: { reason } });

/* ═══ PR-5 · Anti-spoof and deliverability ═════════════════════════════════ */

export type AuthVerdict = "VERIFIED" | "UNVERIFIED" | "SUSPICIOUS" | "LIKELY_IMPERSONATION";

export type VerifiedDomain = {
  party_verified_domain_id: string;
  party_kind: "CLIENT" | "SUPPLIER";
  party_id: string;
  party_name?: string | null;
  domain: string;
  source: "ADMIN_VERIFIED" | "OBSERVED";
  message_count?: number;
};
export const listVerifiedDomains = (q: { party_kind?: string; party_id?: string } = {}) => {
  const p = new URLSearchParams();
  if (q.party_kind) p.set("party_kind", q.party_kind);
  if (q.party_id) p.set("party_id", q.party_id);
  const s = p.toString();
  return tenant<VerifiedDomain[]>(`/mail/verified-domains${s ? `?${s}` : ""}`);
};
/** Only ever creates an ADMIN_VERIFIED row — an OBSERVED one confers nothing. */
export const verifyDomain = (body: { party_kind: "CLIENT" | "SUPPLIER"; party_id: string; domain: string }) =>
  tenant<VerifiedDomain>("/mail/verified-domains", { method: "POST", body });
export const unverifyDomain = (id: string) =>
  tenant(`/mail/verified-domains/${id}`, { method: "DELETE" });

export type Bounce = {
  email_bounce_id: string;
  address: string;
  bounce_type: "HARD" | "SOFT" | "COMPLAINT";
  status?: string | null;
  last_bounced_at?: string | null;
  bounce_count?: number;
  diagnostic?: string | null;
};
export const listBounces = () => tenant<Bounce[]>("/mail/bounces");
/** Asked BEFORE a send, so a hard-bounced address is caught in the composer. */
export const checkAddresses = (addresses: string[]) =>
  tenant<Record<string, { status: string; bounce_type?: string; last_bounced_at?: string }>>(
    "/mail/bounces/check", { method: "POST", body: { addresses } },
  );

/* ═══ PR-5 · The archive ═══════════════════════════════════════════════════ */

/**
 * Walks the hash chain and reports the first break, if any.
 *
 * `ok: false` names the message where the chain diverges. It does NOT mean
 * someone tampered with the mailbox — the likeliest cause is a message archived
 * concurrently — but it does mean the archive can no longer be relied on as
 * evidence from that row forward, which is a thing a compliance officer needs
 * said plainly rather than implied by a red dot.
 */
export type ArchiveVerdict = {
  ok: boolean;
  checked: number;
  broken_at?: string | null;
  message?: string | null;
};
export const verifyArchive = () => tenant<ArchiveVerdict>("/mail/archive/verify");
