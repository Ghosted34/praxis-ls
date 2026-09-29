"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const { schemas: qTicket } = require("../operations/q_ticket/q_ticket.validator");

/*
 * WebAuthn envelopes — the same shapes the staff validator declares
 * (security/app_user/app_user.validator.js), for the same reason: SimpleWebAuthn
 * is the security boundary, and these only make sure the members it reads are
 * there and bounded.
 */
const b64url = z.string().min(1).max(16384).regex(/^[A-Za-z0-9_-]+={0,2}$/);
const credentialId = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
const challengeToken = z.string().min(20).max(4096);
const credentialEnvelope = {
  id: credentialId,
  rawId: credentialId,
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.unknown()).optional(),
  authenticatorAttachment: z.string().max(40).optional().nullable(),
};
/** "Keep me signed in" — optional everywhere a sign-in can happen, off by default. */
const trust = z.boolean().optional();

/*
 * Client-portal uploads arrive as MULTIPART (a file and its fields), so every
 * field is a string by the time this sees it: numbers, the allocation list and
 * blanks are coerced here rather than trusted as typed.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const blankToUndefined = (v) => (v === "" || v === "null" || v === null ? undefined : v);
const optText = (max) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optUuid = z.preprocess(blankToUndefined, z.string().uuid().optional());
const money = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(/\s/g, "").replace(",", ".")) : v),
  z.number().finite().positive().max(1e12),
);
const jsonField = (schema) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);
const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
/** A multipart number: "12.5" → 12.5, blank → absent, bounded. */
const optNum = (min, max) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v ?? undefined),
    z.number().finite().min(min).max(max).optional(),
  );
const optInt = (min, max) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v ?? undefined),
    z.number().int().min(min).max(max).optional(),
  );
/** A chat thread: "general", or the id of a shipment. */
// A portal person's name. Required wherever a login is created or granted: the
// team has to know WHO at a client wrote to them or sent a file, and an email
// address is not a person. 120 is the column the staff list and email greet from.
const personName = z.string().trim().min(1, "Enter their name").max(120);
const chatThread = z.preprocess(blankToUndefined, z.union([z.literal("general"), z.string().uuid()]).optional());
/**
 * What a chat message may carry besides its file (14170). The text is
 * optional — a photo, a voice note or a pin can stand alone — and bounded here
 * because the column's CHECK went (see the migration); the service refuses a
 * message with nothing in it. A pin is both coordinates or neither.
 * width/height/duration_ms are layout hints the phone measured, bounded.
 */
const chatFields = {
  thread: chatThread,
  body: z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string().max(4000)),
  milestone_instance_id: optUuid,
  width: optInt(1, 20000),
  height: optInt(1, 20000),
  duration_ms: optInt(0, 600000),
};
const pinBoth = (v) => (v.lat === undefined) === (v.lng === undefined);
const SCOPES = ["ALL", "OPERATIONS", "BILLING"];
/** A last day of access, dd/mm/yyyy on screen and ISO on the wire, kept to its end. */
const accessUntil = isoDate.transform((d) => `${d}T23:59:59.999Z`);
/** What a client can be told about (14180, portal_notify.service TOPICS). */
const NOTIFY_TOPICS = ["MESSAGES", "REQUESTS", "BILLING", "PROPOSALS", "SHIPMENTS"];

/**
 * The push services browsers actually use: Chrome, Edge and Android (FCM),
 * Firefox (Mozilla autopush), Safari and iOS (Apple), and Windows (WNS). A
 * subscription endpoint anywhere else is not one a browser minted.
 */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/i;
function isPushService(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}
const pushEndpoint = z.string().url().max(1024).refine(isPushService, "Not a browser push service");

/** geo_place.kind — the vocabulary migration 0674 allows. */
const PLACE_KINDS = [
  "SEAPORT", "AIRPORT", "TERMINAL", "RAIL_TERMINAL", "BORDER_POST",
  "WAREHOUSE", "INLAND", "CITY", "ADDRESS", "OTHER",
];
/*
 * One place a client picked in the quote sheet, in one of two shapes: a place
 * they were offered (its id — re-checked server-side, never trusted), or a
 * worldwide suggestion (the provider's id and the text that produced it,
 * NEVER a coordinate: the server re-asks the provider and stores its answer).
 * Absent or null when they typed the place instead.
 */
const placePick = z
  .union([
    z.object({ geo_place_id: z.string().uuid() }).strict(),
    z
      .object({
        provider_place_id: z.string().trim().min(1).max(300),
        query: z.string().trim().min(1).max(200),
        country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
      })
      .strict(),
  ])
  .nullable()
  .optional();

const schemas = {
  login: z.object({ email: z.string().email(), password: z.string().min(1), trust_device: trust }),
  refresh: z.object({ refresh_token: z.string().min(20).max(200) }),
  logout: z.object({ refresh_token: z.string().min(20).max(200).optional() }),
  codeRequest: z.object({ email: z.string().trim().email() }),
  codeVerify: z.object({ email: z.string().trim().email(), code: z.string().trim().regex(/^\d{6}$/), trust_device: trust }),
  passkeyLoginOptions: z.object({
    email: z.string().trim().email().optional().nullable(),
    credential_ids: z.array(credentialId).max(10).optional(),
  }),
  passkeyLoginVerify: z.object({
    assertion: z.object({
      ...credentialEnvelope,
      response: z.object({
        clientDataJSON: b64url,
        authenticatorData: b64url,
        signature: b64url,
        userHandle: z.string().max(1024).optional().nullable(),
      }).passthrough(),
    }).passthrough(),
    challengeToken,
    trust_device: trust,
  }),
  passkeyRegisterVerify: z.object({
    attestation: z.object({
      ...credentialEnvelope,
      response: z.object({
        clientDataJSON: b64url,
        attestationObject: b64url,
        transports: z.array(z.string().max(40)).max(10).optional(),
      }).passthrough(),
    }).passthrough(),
    challengeToken,
    label: z.string().max(80).optional().nullable(),
  }),
  create: z.object({ email: z.string().email(), password: z.string().min(8), full_name: personName }),
  password: z.object({ password: z.string().min(8) }),
  status: z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }),
  // Invite takes no password: staff must not choose an external party's
  // credentials. It doubles as Resend, so `full_name` may be left out for a
  // login that already exists — the service refuses to CREATE one without it
  // (NAME_REQUIRED): the grant is keyed by email, but the people who read a
  // client's messages need to know who is writing.
  invite: z.object({ email: z.string().email(), full_name: personName.optional() }),
  forgot: z.object({ email: z.string().email() }),
  accept: z.object({ token: z.string().min(1), password: z.string().min(8), trust_device: trust }),
  // Q tickets raised from the portal. Reuses the module's own shapes so the
  // internal and external surfaces validate identically — with one exception
  // enforced in the service, not here: a client can never post an internal note,
  // whatever the body says.
  raiseTicket: qTicket.raise,
  replyTicket: qTicket.reply,
  // Self-service quoting from the portal (PRD §11.1). client_id is never
  // accepted from the body — the grant decides the client.
  portalQuote: z.object({
    service_category: z.string().min(1).max(80),
    service_type: z.string().optional(),
    // 200, not 120: a picked address arrives as the provider's formatted line
    // ("12 Rue de la Joie, Bonabéri, Douala, Littoral, Cameroon"), and cutting
    // it would store a place the client did not choose.
    origin_location: z.string().trim().min(1).max(200),
    destination_location: z.string().trim().min(1).max(200),
    // The doors either side of the main leg (14220). Optional: a port-to-port
    // request names neither.
    collection_location: optText(200),
    delivery_location: optText(200),
    origin_place: placePick,
    destination_place: placePick,
    collection_place: placePick,
    delivery_place: placePick,
    estimated_weight: z.number().nonnegative().optional(),
    cargo_description: z.string().max(2000).optional(),
    incoterm: z.string().max(40).optional(),
  }),
  // The quote sheet's place search. A GET, so every value is a string and
  // `kind` is a string or an array depending on how many were sent.
  places: z
    .object({
      q: z.string().trim().max(120).optional(),
      kind: z
        .union([z.enum(PLACE_KINDS), z.array(z.enum(PLACE_KINDS)).max(PLACE_KINDS.length)])
        .optional()
        .transform((k) => (k === undefined ? [] : Array.isArray(k) ? k : [k])),
      country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
      provider: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    })
    .strict(),
  // ── Client portal redesign (14150) ──
  // A file for a request: the file is the whole body.
  requestUpload: z.object({}),
  // A bodyless action (remove a colleague): nothing the caller sends is read.
  empty: z.object({}),
  // The person's own name, from their portal profile.
  profile: z.object({ full_name: personName }).strict(),
  requestAnswer: z.object({ text: z.string().trim().min(1).max(4000) }),
  shareDocument: z.object({ doc_type_code: optText(60), dossier_id: optUuid, note: optText(1000) }),
  paymentProof: z.object({
    amount: money,
    currency: z.preprocess(blankToUndefined, z.string().trim().regex(/^[A-Za-z]{3}$/).optional()),
    method: z.enum(["BANK", "MOBILE_MONEY", "CASH", "CHEQUE"]),
    provider: optText(60),
    paid_on: isoDate,
    reference: optText(120),
    note: optText(1000),
    dossier_id: optUuid,
    allocations: jsonField(z.array(z.object({ invoice_id: z.string().uuid(), amount: money })).max(50)).optional(),
  }),
  teamInvite: z.object({
    email: z.string().trim().email(),
    full_name: personName,
    access_scope: z.enum(SCOPES).optional(),
    is_client_admin: flag.optional(),
  }),
  teamUpdate: z.object({ access_scope: z.enum(SCOPES).optional(), is_client_admin: flag.optional() }),
  // Staff side of the same (MOD-29 requests, MOD-52 payment claims).
  staffCreateRequest: z.object({
    client_id: z.string().uuid(),
    dossier_id: z.string().uuid().optional().nullable(),
    kind: z.enum(["DOCUMENT", "INFO"]),
    doc_type_code: z.string().trim().max(60).optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
    note: z.string().trim().max(2000).optional().nullable(),
    due_on: isoDate.optional().nullable(),
  }),
  staffReviewRequest: z.object({
    decision: z.enum(["ACCEPT", "REJECT", "CANCEL"]),
    note: z.string().trim().max(1000).optional().nullable(),
  }),
  staffConfirmProof: z.object({ treasury_account_id: z.string().uuid().optional().nullable() }),
  // A client's portal, managed from the Client 360 (MOD-29). `expires_at` is
  // the LAST DAY they may sign in, so it is stored as the end of that day.
  staffPersonAdd: z.object({
    email: z.string().trim().email().max(254),
    full_name: personName,
    access_scope: z.enum(SCOPES).optional(),
    is_client_admin: z.boolean().optional().nullable(),
    expires_at: accessUntil.optional().nullable(),
    send_invite: z.boolean().optional(),
  }).strict(),
  staffPersonUpdate: z.object({
    full_name: personName.optional(),
    access_scope: z.enum(SCOPES).optional(),
    is_client_admin: z.boolean().optional(),
    expires_at: accessUntil.nullable().optional(),
  }).strict(),
  // Settings for every client (the Clients screen's ⚙).
  inviteDefaults: z.object({ access_scope: z.enum(SCOPES), first_is_admin: z.boolean() }).strict(),
  onboardingStepCreate: z.object({
    label_en: z.string().trim().min(2).max(160),
    label_fr: z.string().trim().max(160).optional().nullable(),
  }).strict(),
  onboardingStepUpdate: z.object({
    label_en: z.string().trim().min(1).max(160).optional(),
    label_fr: z.string().trim().min(1).max(160).optional(),
    is_active: z.boolean().optional(),
  }).strict().refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" }),
  onboardingStepMove: z.object({ direction: z.enum(["up", "down"]) }).strict(),
  // An invoice's supporting documents, shared with the client (14160). The
  // service refuses any id that is not on the invoice's own file.
  staffPublishBundle: z.object({ doc_ids: z.array(z.string().uuid()).max(200) }),
  staffRejectProof: z.object({ note: z.string().trim().min(1).max(1000) }),
  // A portal message — the body is the only thing the caller supplies.
  message: z.object({ body: z.string().trim().min(1).max(4000), dossier_id: z.string().uuid().optional() }),
  // Staff reply — client_id comes from the caller (staff route).
  staffMessage: z.object({ client_id: z.string().uuid(), body: z.string().trim().min(1).max(4000), dossier_id: z.string().uuid().optional() }),
  // The chat (14170). Multipart when a file rides along, so every field may
  // arrive as a string.
  chatSend: z
    .object({
      ...chatFields,
      lat: optNum(-90, 90),
      lng: optNum(-180, 180),
      location_label: optText(200),
    })
    .refine(pinBoth, { message: "A location needs both latitude and longitude", path: ["lat"] }),
  chatRead: z.object({ thread: chatThread, at: z.string().datetime({ offset: true }).optional() }),
  // The team's side: the same fields, a location included — the ERP's reply
  // tools can share where someone is (client portal PR 3).
  staffChatSend: z
    .object({
      client_id: z.string().uuid(),
      ...chatFields,
      lat: optNum(-90, 90),
      lng: optNum(-180, 180),
      location_label: optText(200),
    })
    .refine(pinBoth, { message: "A location needs both latitude and longitude", path: ["lat"] }),
  staffChatRead: z.object({ client_id: z.string().uuid(), thread: chatThread }),
  // A proposal in the portal. Declining takes a reason from the signing
  // programme's DECLINE list; free text is appended to a reason, never instead
  // of one (signature_public.validator.js, the same rule).
  proposalDecline: z
    .object({ reason_code: z.string().min(1).max(64), note: z.string().trim().max(400).optional() })
    .strict(),
  // Signing — the public signing page's shape exactly, and like it STRICT with
  // no email field: the address a code goes to is the one on file, never one
  // the signer supplies (guide §6.3). The name and role are the signer's own
  // DECLARED identity; the mark is capped at 200 KB (§6.6).
  proposalSignComplete: z
    .object({
      code: z.string().regex(/^[0-9]{6}$/, "A signing code is six digits"),
      preset_code: z.enum(["STAMP", "DRAWN"]),
      full_name: z.string().trim().min(1).max(200).optional(),
      party_role: z.string().trim().max(120).optional(),
      mark_image_b64: z.string().max(200_000).regex(/^data:image\/(png|jpeg);base64,/).optional(),
    })
    .strict(),
  // "Describe it in your own words" — the quote wizard's fill.
  quoteFill: z.object({ text: z.string().trim().min(3).max(2000) }),
  // Notifications (14180): five topics with two switches each, and the
  // language the emails are written in. Strict — nothing else is a setting.
  notifySettings: z
    .object({
      topics: z
        .array(z.object({ topic: z.enum(NOTIFY_TOPICS), email: z.boolean(), push: z.boolean() }).strict())
        .max(NOTIFY_TOPICS.length),
      language: z.enum(["en", "fr"]).optional(),
    })
    .strict(),
  // A browser's PushSubscription as `subscription.toJSON()` gives it. The
  // endpoint must belong to a real push service: the worker POSTs to it, and a
  // portal login is a stranger's — an arbitrary URL here would let one make
  // this server call any address it can reach.
  pushSubscribe: z.object({
    subscription: z.object({
      endpoint: pushEndpoint,
      keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
      expirationTime: z.number().nullable().optional(),
    }),
    language: z.enum(["en", "fr"]).optional(),
  }),
  pushUnsubscribe: z.object({ endpoint: z.string().url().max(1024) }).strict(),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
/** The same, for a GET's query string — parsed into `req.validatedQuery`. */
const mwQuery = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};

module.exports = {
  login: mw("login"), create: mw("create"), password: mw("password"), status: mw("status"),
  invite: mw("invite"), forgot: mw("forgot"), accept: mw("accept"),
  refresh: mw("refresh"), logout: mw("logout"), codeRequest: mw("codeRequest"), codeVerify: mw("codeVerify"),
  passkeyLoginOptions: mw("passkeyLoginOptions"), passkeyLoginVerify: mw("passkeyLoginVerify"),
  passkeyRegisterVerify: mw("passkeyRegisterVerify"),
  raiseTicket: mw("raiseTicket"), replyTicket: mw("replyTicket"),
  portalQuote: mw("portalQuote"), message: mw("message"), staffMessage: mw("staffMessage"),
  requestUpload: mw("requestUpload"), empty: mw("empty"), requestAnswer: mw("requestAnswer"), shareDocument: mw("shareDocument"),
  paymentProof: mw("paymentProof"), teamInvite: mw("teamInvite"), teamUpdate: mw("teamUpdate"),
  staffCreateRequest: mw("staffCreateRequest"), staffReviewRequest: mw("staffReviewRequest"),
  staffConfirmProof: mw("staffConfirmProof"), staffRejectProof: mw("staffRejectProof"),
  staffPublishBundle: mw("staffPublishBundle"),
  staffPersonAdd: mw("staffPersonAdd"), staffPersonUpdate: mw("staffPersonUpdate"), profile: mw("profile"),
  inviteDefaults: mw("inviteDefaults"), onboardingStepCreate: mw("onboardingStepCreate"),
  onboardingStepUpdate: mw("onboardingStepUpdate"), onboardingStepMove: mw("onboardingStepMove"),
  chatSend: mw("chatSend"), chatRead: mw("chatRead"), staffChatSend: mw("staffChatSend"), staffChatRead: mw("staffChatRead"),
  proposalDecline: mw("proposalDecline"), proposalSignComplete: mw("proposalSignComplete"), quoteFill: mw("quoteFill"),
  notifySettings: mw("notifySettings"), pushSubscribe: mw("pushSubscribe"), pushUnsubscribe: mw("pushUnsubscribe"),
  places: mwQuery("places"),
  isPushService,
  schemas,
};
