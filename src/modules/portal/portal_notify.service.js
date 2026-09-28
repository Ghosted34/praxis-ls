/**
 * Client portal notifications (client portal redesign PR 2, migration 14180).
 *
 * WHAT THE OWNER ASKED FOR: clients told by email and on their phone when
 * something is waiting for them — the team replied, a document is needed, an
 * invoice or a proposal arrived, a shipment reached a stage — so the portal is
 * a place that calls them back, not one they have to remember to visit.
 *
 * TWO HALVES:
 *
 *   · the client's own switches: five topics × email and phone, everything on
 *     except shipment stages by email (see DEFAULTS), and the devices they
 *     allowed notifications on;
 *   · `deliver`, run by the `portal-notify-deliver` job over the rows
 *     `shared/notifications/notify-portal.js` wrote in the transaction of the
 *     change: it reads what is still true about each (a request already
 *     answered, a proposal already accepted is no longer news), decides who at
 *     the client may hear about it, and sends one push and one email per person
 *     for the whole batch.
 *
 * WHO: the people with an effective CLIENT grant at this client, who have used
 * the portal at least once — and, per topic, only those whose access shows it:
 * shipments, documents and proposals are the OPERATIONS side, invoices and
 * payments the BILLING side, the General conversation everybody (the same split
 * as the portal's own tabs).
 *
 * NEVER TWICE: each send is claimed in `portal_notify_sent` before it is made,
 * so a retried job does not repeat what already went out; a failed send gives
 * its claim back. A conversation that keeps moving emails a person at most once
 * an hour — the push is what tells them it is still going.
 *
 * NEVER FROM A SANDBOX: the job only runs on the live schema, and the email
 * service refuses a sandbox connection on its own as well (PRD §5.5).
 */
"use strict";

const repo = require("./portal_notify.repo");
const pushService = require("../../shared/push/push.service");
const emailService = require("../../services/email.service");
const branding = require("../branding/branding.service");
const registry = require("../../services/tenant/registry.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

const MODULE = "MOD-67";
const TOPICS = ["MESSAGES", "REQUESTS", "BILLING", "PROPOSALS", "SHIPMENTS"];

/**
 * A person with no row gets these. Shipment stages are worth a tap on a phone
 * and not worth an inbox: an importer with forty files on the water would
 * otherwise get forty emails a day. Stored as what is OFF, so a topic added
 * later reaches everybody rather than nobody.
 */
const DEFAULTS = { email_off: ["SHIPMENTS"], push_off: [] };

/** A chat conversation emails the same person at most this often. */
const CHAT_EMAIL_EVERY_MIN = 60;
/** An email lists at most this many things, then "and 3 more". */
const EMAIL_LINES = 8;

const canOps = (scope) => !scope || scope === "ALL" || scope === "OPERATIONS";
const canBilling = (scope) => !scope || scope === "ALL" || scope === "BILLING";

/** May someone with this access hear about this topic (and conversation)? */
function sees(scope, topic, thread = null) {
  if (topic === "MESSAGES") return !thread || thread === "general" || canOps(scope);
  if (topic === "BILLING") return canBilling(scope);
  return canOps(scope);
}

const topicsFor = (scope) => TOPICS.filter((t) => sees(scope, t, t === "MESSAGES" ? "general" : null));

function offLists(row) {
  return {
    email_off: row && Array.isArray(row.email_off) ? row.email_off : DEFAULTS.email_off,
    push_off: row && Array.isArray(row.push_off) ? row.push_off : DEFAULTS.push_off,
  };
}

/* ── the client's own settings ─────────────────────────────────────────── */

/** The switches, for the topics this person's access shows them. */
async function settings(c, { clientId, email, scope }) {
  const row = await repo.setting(c, { clientId, email });
  const off = offLists(row);
  return {
    language: (row && row.language) || null,
    topics: topicsFor(scope).map((topic) => ({
      topic,
      email: !off.email_off.includes(topic),
      push: !off.push_off.includes(topic),
    })),
  };
}

/**
 * Save the switches. A topic this person cannot see keeps whatever it was —
 * their access may widen later, and it should come back as they left it.
 */
async function saveSettings(c, { clientId, email, scope, topics = [], language = null }) {
  const row = await repo.setting(c, { clientId, email });
  const off = offLists(row);
  const visible = new Set(topicsFor(scope));
  const chosen = new Map(topics.filter((t) => visible.has(t.topic)).map((t) => [t.topic, t]));
  const next = (list, channel) =>
    TOPICS.filter((topic) => {
      const pick = chosen.get(topic);
      return pick ? pick[channel] === false : list.includes(topic);
    });
  await repo.saveSetting(c, {
    clientId, email, language,
    emailOff: next(off.email_off, "email"),
    pushOff: next(off.push_off, "push"),
  });
  return settings(c, { clientId, email, scope });
}

/** Push readiness for this person: is it configured here, and on how many devices. */
async function devices(c, { portalUserId }) {
  const publicKey = await pushService.getPublicKey().catch(() => null);
  return {
    push: {
      configured: Boolean(publicKey),
      public_key: publicKey || null,
      devices: await repo.countDevices(c, portalUserId),
    },
  };
}

async function subscribe(c, { portalUserId, subscription, userAgent = null }) {
  const s = subscription || {};
  const keys = s.keys || {};
  if (!s.endpoint || !keys.p256dh || !keys.auth) {
    throw new AppError("INVALID_SUBSCRIPTION", "This device could not be registered for notifications", 422);
  }
  await repo.saveDevice(c, {
    portalUserId, endpoint: s.endpoint, p256dh: keys.p256dh, auth: keys.auth,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    // Which key the browser subscribed with, so a rotated key prunes it rather
    // than failing in silence (push.service, 12770).
    vapidKeyHash: await pushService.currentKeyFingerprint().catch(() => null),
  });
  return { subscribed: true, devices: await repo.countDevices(c, portalUserId) };
}

/** Learn the language the first time a device is allowed, without touching the switches. */
async function rememberLanguage(c, { clientId, email, language }) {
  if (language !== "en" && language !== "fr") return;
  const row = await repo.setting(c, { clientId, email });
  if (row && row.language) return;
  const off = offLists(row);
  await repo.rememberLanguage(c, { clientId, email, language, emailOff: off.email_off, pushOff: off.push_off });
}

async function unsubscribe(c, { portalUserId, endpoint }) {
  await repo.deleteDevice(c, { portalUserId, endpoint });
  return { unsubscribed: true, devices: await repo.countDevices(c, portalUserId) };
}

/** A real push to this person's own devices, and what happened — the Account screen's "Test". */
async function test(c, { portalUserId, lang = "en", tenantName = "" }) {
  const words = COPY[lang === "fr" ? "fr" : "en"];
  const r = await pushService.sendToPortalUser(c, {
    portal_user_id: portalUserId,
    title: tenantName || words.portal,
    body: words.testBody,
    url: "/portal/account",
    tag: "portal-test",
  });
  return { sent: r.sent || 0, failed: r.failed || 0, devices: r.total || 0, reason: r.reason || null };
}

/* ── the words ─────────────────────────────────────────────────────────── */

const NNBSP = "\u202f";

/**
 * Everything a client reads, in their language. French punctuation takes a
 * narrow no-break space before `:` `;` `!` `?`, which is why the colon is a
 * function of the language and never typed inline.
 */
const COPY = {
  en: {
    colon: ": ",
    portal: "Client portal",
    kind: { IMAGE: "Photo", FILE: "File", VOICE: "Voice note", LOCATION: "Location", TEXT: "Message" },
    and: (n) => `and ${n} more`,
    messages: {
      subject: (n, t) => (n === 1 ? `${t} sent you a message` : `${t} sent you ${n} messages`),
      pushMany: (n) => `${n} new messages`,
      about: (ref) => `About shipment ${ref}`,
      cta: "Reply",
    },
    requests: {
      subject: (n, t) => (n === 1 ? `${t} is waiting for something from you` : `${t} is waiting for ${n} things from you`),
      push: (n) => (n === 1 ? "Please send" : `Please send ${n} things`),
      again: "Please send again",
      question: "Question",
      by: (d) => `by ${d}`,
      cta: "Open my documents",
    },
    billing: {
      subject: (n, t) => (n === 1 ? `${t}: a billing update` : `${t}: ${n} billing updates`),
      pushMany: (n) => `${n} billing updates`,
      invoice: (doc, amount, due) => `New invoice ${doc}, ${amount}${due ? `, due ${due}` : ""}`,
      documents: (doc, n) => `Invoice ${doc}: ${n === 1 ? "1 supporting document" : `${n} supporting documents`} to download`,
      paid: (amount) => `Your payment of ${amount} is confirmed. Thank you.`,
      unpaid: (amount) => `We could not confirm your payment of ${amount}`,
      cta: "Open billing",
    },
    proposals: {
      subject: (n, t) => (n === 1 ? `${t} sent you a proposal` : `${t} sent you ${n} proposals`),
      line: (doc, title) => `Proposal ${doc || ""}${title ? `: ${title}` : ""}`.replace(/\s+:/, ":"),
      pushMany: (n) => `${n} new proposals`,
      cta: "Review",
    },
    shipments: {
      subject: (n, t) => (n === 1 ? `${t}: your shipment moved` : `${t}: ${n} shipment updates`),
      pushMany: (n) => `${n} shipment updates`,
      cta: "Track",
    },
    footer: (t) => `You receive this because you have access to the ${t} client portal.`,
    manage: "Choose what you are told about",
    testBody: "Notifications are on for this device.",
  },
  fr: {
    colon: `${NNBSP}: `,
    portal: "Portail client",
    kind: { IMAGE: "Photo", FILE: "Fichier", VOICE: "Message vocal", LOCATION: "Position", TEXT: "Message" },
    and: (n) => `et ${n} de plus`,
    messages: {
      subject: (n, t) => (n === 1 ? `${t} vous a écrit` : `${t} vous a envoyé ${n} messages`),
      pushMany: (n) => `${n} nouveaux messages`,
      about: (ref) => `Expédition ${ref}`,
      cta: "Répondre",
    },
    requests: {
      subject: (n, t) => (n === 1 ? `${t} attend un élément de votre part` : `${t} attend ${n} éléments de votre part`),
      push: (n) => (n === 1 ? "À envoyer" : `${n} éléments à envoyer`),
      again: "À renvoyer",
      question: "Question",
      by: (d) => `avant le ${d}`,
      cta: "Ouvrir mes documents",
    },
    billing: {
      subject: (n, t) => (n === 1 ? `${t}${NNBSP}: facturation` : `${t}${NNBSP}: ${n} mises à jour de facturation`),
      pushMany: (n) => `${n} mises à jour de facturation`,
      invoice: (doc, amount, due) => `Nouvelle facture ${doc}, ${amount}${due ? `, échéance le ${due}` : ""}`,
      documents: (doc, n) => `Facture ${doc}${NNBSP}: ${n === 1 ? "1 justificatif" : `${n} justificatifs`} à télécharger`,
      paid: (amount) => `Votre paiement de ${amount} est confirmé. Merci.`,
      unpaid: (amount) => `Nous n’avons pas pu confirmer votre paiement de ${amount}`,
      cta: "Ouvrir la facturation",
    },
    proposals: {
      subject: (n, t) => (n === 1 ? `${t} vous a envoyé une proposition` : `${t} vous a envoyé ${n} propositions`),
      line: (doc, title) => `Proposition ${doc || ""}${title ? `${NNBSP}: ${title}` : ""}`.replace(/\s+(\u202f:)/, "$1"),
      pushMany: (n) => `${n} nouvelles propositions`,
      cta: "Voir",
    },
    shipments: {
      subject: (n, t) => (n === 1 ? `${t}${NNBSP}: votre expédition avance` : `${t}${NNBSP}: ${n} étapes franchies`),
      pushMany: (n) => `${n} étapes franchies`,
      cta: "Suivre",
    },
    footer: (t) => `Vous recevez ce message car vous avez accès au portail client ${t}.`,
    manage: "Choisir mes notifications",
    testBody: "Les notifications sont activées sur cet appareil.",
  },
};

/** "2026-10-30" → "30/10/2026": a date a person reads is day-first (CLAUDE.md). */
function dmy(value) {
  if (!value) return null;
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** 1250000, "XAF" → "1 250 000 XAF" (fr) / "1,250,000 XAF" (en). */
function money(n, currency, lang) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(currency || "");
  const text = new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 2 }).format(v);
  return `${text} ${currency || ""}`.trim();
}

const clip = (s, n = 140) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const escapeHtml = (s) =>
  String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/* ── what each topic says ──────────────────────────────────────────────── */

/**
 * The rows of one batch, resolved against what is true NOW. Returns
 * `{ ids, lines(lang) }` — or, for MESSAGES, the ids to check per person.
 */
async function resolve(c, { clientId, topic, rows }) {
  const idsOf = (prefixes) =>
    rows
      .filter((r) => prefixes.some((p) => r.item_ref.startsWith(`${p}:`)))
      .map((r) => r.item_ref.slice(r.item_ref.indexOf(":") + 1));

  if (topic === "MESSAGES") return { messageIds: idsOf(["client_message"]) };

  if (topic === "REQUESTS") {
    const found = await repo.requests(c, { clientId, ids: idsOf(["client_request"]) });
    return {
      count: found.length,
      lines: (lang) => {
        const w = COPY[lang].requests;
        return found.map((r) => {
          const name = (lang === "fr" ? r.doc_type_fr : r.doc_type_en) || r.doc_type_en || r.title || w.question;
          const bits = [r.status === "REJECTED" ? `${w.again}${COPY[lang].colon}${name}` : name];
          if (r.dossier_ref) bits.push(r.dossier_ref);
          if (r.status !== "REJECTED" && r.due_on) bits.push(w.by(dmy(r.due_on)));
          if (r.status === "REJECTED" && r.review_note) bits.push(clip(r.review_note, 160));
          return bits.join(" · ");
        });
      },
      push: (lang, lines) => {
        const w = COPY[lang].requests;
        return found.length === 1
          ? found[0].status === "REJECTED" ? lines[0] : `${w.push(1)}${COPY[lang].colon}${lines[0]}`
          : w.push(found.length);
      },
      path: () => "/portal/documents",
    };
  }

  if (topic === "BILLING") {
    const invoiceIds = [...new Set(idsOf(["invoice", "final_invoice"]))];
    const [invoices, proofs] = await Promise.all([
      invoiceIds.length ? repo.invoices(c, { clientId, ids: invoiceIds }) : [],
      repo.proofs(c, { clientId, ids: idsOf(["payment_proof"]) }),
    ]);
    const byId = new Map(invoices.map((i) => [i.invoice_id, i]));
    const byProof = new Map(proofs.map((p) => [p.payment_proof_id, p]));
    // In the order they happened; one line per thing, however many events it had.
    const entries = [];
    const seen = new Set();
    for (const r of rows) {
      const id = r.item_ref.slice(r.item_ref.indexOf(":") + 1);
      const key = `${r.event_key}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.event_key === "invoice.posted" && byId.has(id)) entries.push({ kind: "invoice", row: byId.get(id) });
      else if (r.event_key === "invoice_bundle.published" && byId.has(id) && byId.get(id).documents > 0) {
        entries.push({ kind: "documents", row: byId.get(id) });
      } else if (r.event_key.startsWith("payment_proof.") && byProof.has(id)) {
        entries.push({ kind: byProof.get(id).status === "CONFIRMED" ? "paid" : "unpaid", row: byProof.get(id) });
      }
    }
    const invoiceOnly = entries.filter((e) => e.kind === "invoice" || e.kind === "documents");
    const onlyInvoice = invoiceOnly.length === entries.length && new Set(invoiceOnly.map((e) => e.row.invoice_id)).size === 1;
    return {
      count: entries.length,
      lines: (lang) => {
        const w = COPY[lang].billing;
        return entries.map(({ kind, row }) => {
          if (kind === "invoice") return w.invoice(row.doc_number, money(row.total_ttc, row.currency, lang), dmy(row.payment_due_on));
          if (kind === "documents") return w.documents(row.doc_number, row.documents);
          if (kind === "paid") return w.paid(money(row.amount, row.currency, lang));
          const why = row.review_note ? `${COPY[lang].colon}${clip(row.review_note, 160)}` : "";
          return `${w.unpaid(money(row.amount, row.currency, lang))}${why}`;
        });
      },
      push: (lang, lines) => (entries.length === 1 ? lines[0] : COPY[lang].billing.pushMany(entries.length)),
      path: () =>
        onlyInvoice && entries.length ? `/portal/billing?invoice=${entries[0].row.invoice_id}` : "/portal/billing",
    };
  }

  if (topic === "PROPOSALS") {
    const found = await repo.proposals(c, { clientId, ids: idsOf(["proposal"]) });
    return {
      count: found.length,
      lines: (lang) => found.map((p) => COPY[lang].proposals.line(p.doc_number, p.title)),
      push: (lang, lines) => (found.length === 1 ? lines[0] : COPY[lang].proposals.pushMany(found.length)),
      path: () => (found.length === 1 ? `/portal/quotes?proposal=${found[0].proposal_id}` : "/portal/quotes?tab=proposals"),
    };
  }

  // SHIPMENTS
  const found = await repo.stages(c, { clientId, ids: idsOf(["milestone_instance"]) });
  const files = new Set(found.map((s) => s.dossier_id));
  return {
    count: found.length,
    lines: (lang) => found.map((s) => `${s.dossier_ref} — ${(lang === "en" && s.label_en) || s.label}`),
    push: (lang, lines) => (found.length === 1 ? lines[0] : COPY[lang].shipments.pushMany(found.length)),
    path: () => (files.size === 1 ? `/portal/shipments/${[...files][0]}` : "/portal/shipments"),
  };
}

/** One team reply as a line: "Awa: the truck left" — or what was sent, when it has no words. */
function replyLine(m, lang) {
  const w = COPY[lang];
  const kind = m.attachment_kind || (m.has_location ? "LOCATION" : "TEXT");
  const what = clip(m.body) || w.kind[kind] || w.kind.TEXT;
  return m.author ? `${m.author}${w.colon}${what}` : what;
}

/* ── the email ─────────────────────────────────────────────────────────── */

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/**
 * The tenant's name, colour and logo, and the origin a link must point at —
 * the tenant's own public host when it has one, so a link does not open in
 * the staff app installed on the workspace host (registry.publicSurfaceOrigin).
 */
async function context(c, tenant) {
  let brand = {};
  try {
    brand = (await branding.getBranding(c)) || {};
  } catch (err) {
    logger.warn({ err }, "[portal-notify] branding unreadable — sending with the defaults");
  }
  let origin = null;
  try {
    origin = await registry.publicSurfaceOrigin(tenant.tenant_id);
    if (!origin) {
      const ws = await registry.workspaceOrigin(tenant.tenant_id);
      origin = ws && ws.origin;
    }
  } catch (err) {
    logger.warn({ err }, "[portal-notify] host lookup failed — links use the conventional workspace host");
  }
  if (!origin) origin = `https://${tenant.slug}.${config.APP_BASE_DOMAIN}`;
  const logo = brand.logoUrl ? (String(brand.logoUrl).startsWith("/") ? `${origin}${brand.logoUrl}` : String(brand.logoUrl)) : null;
  return {
    name: brand.name || tenant.slug,
    primary: HEX.test(String(brand.primary || "")) ? brand.primary : "#1f2937",
    onPrimary: HEX.test(String(brand.primaryForeground || "")) ? brand.primaryForeground : "#ffffff",
    logo: logo && /^https:\/\//.test(logo) ? logo : null,
    origin,
  };
}

function emailHtml({ ctx, lang, heading, about, lines, more, cta, link }) {
  const w = COPY[lang];
  const items = lines
    .map((l) => `<li style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#1f2d3a">${escapeHtml(l)}</li>`)
    .join("");
  const brandRow = ctx.logo
    ? `<img src="${escapeHtml(ctx.logo)}" alt="${escapeHtml(ctx.name)}" height="28" style="display:block;height:28px;max-width:180px;border:0">`
    : `<p style="margin:0;font-size:15px;font-weight:700;color:${ctx.primary}">${escapeHtml(ctx.name)}</p>`;
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f3f6fb;font-family:Roboto,'Noto Sans',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e3e9f2">
    <div style="height:4px;background:${ctx.primary}"></div>
    <div style="padding:26px 30px 28px">
      ${brandRow}
      <h1 style="margin:22px 0 6px;font-size:20px;line-height:1.3;color:#0b2030">${escapeHtml(heading)}</h1>
      ${about ? `<p style="margin:0 0 14px;font-size:13px;color:#6b8193">${escapeHtml(about)}</p>` : ""}
      <ul style="margin:14px 0 0;padding:0 0 0 18px">${items}</ul>
      ${more ? `<p style="margin:0 0 0 18px;font-size:13px;color:#6b8193">${escapeHtml(more)}</p>` : ""}
      <p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${ctx.primary};color:${ctx.onPrimary};text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(cta)}</a></p>
    </div>
    <div style="padding:14px 30px 18px;border-top:1px solid #eef2f7">
      <p style="margin:0;font-size:12px;line-height:1.5;color:#84a0b0">${escapeHtml(w.footer(ctx.name))}
        <a href="${escapeHtml(`${ctx.origin}/portal/account`)}" style="color:#6b8193">${escapeHtml(w.manage)}</a></p>
    </div>
  </div></body></html>`;
}

function emailText({ ctx, lang, heading, about, lines, more, cta, link }) {
  const w = COPY[lang];
  return [
    heading,
    about || null,
    "",
    ...lines.map((l) => `• ${l}`),
    more || null,
    "",
    `${cta}${w.colon}${link}`,
    "",
    `${w.footer(ctx.name)} ${w.manage}${w.colon}${ctx.origin}/portal/account`,
  ].filter((l) => l !== null).join("\n");
}

/* ── delivery ──────────────────────────────────────────────────────────── */

function isOff(person, channel, topic) {
  const off = offLists(person);
  return (channel === "email" ? off.email_off : off.push_off).includes(topic);
}

const languageOf = (person, profile) => {
  const l = person.language || (profile && profile.preferred_language);
  return l === "fr" ? "fr" : "en";
};

/**
 * One person's message for a batch, or null when there is nothing for them.
 * MESSAGES are per person — only the replies they have not read; everything
 * else is the same batch for everybody who may see it.
 */
async function messageFor(c, { person, topic, thread, batch, lang, ctx, clientId }) {
  const w = COPY[lang];
  if (topic === "MESSAGES") {
    const unread = batch.messageIds.length
      ? await repo.unreadReplies(c, {
          clientId, thread, portalUserId: person.portal_user_id, since: person.granted_at, ids: batch.messageIds,
        })
      : [];
    if (!unread.length) return null;
    const ref = unread[unread.length - 1].dossier_ref || null;
    const lines = unread.map((m) => replyLine(m, lang));
    const last = lines[lines.length - 1];
    return {
      heading: w.messages.subject(unread.length, ctx.name),
      about: ref ? w.messages.about(ref) : null,
      lines: lines.slice(-EMAIL_LINES),
      more: lines.length > EMAIL_LINES ? w.and(lines.length - EMAIL_LINES) : null,
      cta: w.messages.cta,
      path: `/portal?chat=${thread || "general"}`,
      pushTitle: ref ? `${ctx.name} · ${ref}` : ctx.name,
      pushBody: unread.length === 1 ? last : `${w.messages.pushMany(unread.length)} — ${last}`,
      urgency: "high",
    };
  }
  if (!batch.count) return null;
  const all = batch.lines(lang);
  const key = topic.toLowerCase();
  return {
    heading: w[key].subject(all.length, ctx.name),
    about: null,
    lines: all.slice(0, EMAIL_LINES),
    more: all.length > EMAIL_LINES ? w.and(all.length - EMAIL_LINES) : null,
    cta: w[key].cta,
    path: batch.path(),
    pushTitle: ctx.name,
    pushBody: batch.push(lang, all),
    urgency: "normal",
  };
}

/**
 * Send what is waiting for one client, topic (and conversation), on the
 * channels of this stage. Throws after trying everybody when a send failed,
 * so the job is retried; what did go out is claimed and is not repeated.
 */
async function deliver(c, { tenant, clientId, topic, thread = null, stage }) {
  if (!TOPICS.includes(topic)) throw new Error(`portal-notify: unknown topic ${topic}`);
  const channels = stage === "both" ? ["push", "email"] : [stage];
  const out = { pushed: 0, emailed: 0, people: 0, failed: 0, stale: [] };
  let failure = null;

  const everybody = await repo.audience(c, { clientId });
  const people = everybody.filter((p) => sees(p.scope, topic, thread));
  out.people = people.length;
  const profile = await repo.clientProfile(c, clientId);
  let ctx = null;

  for (const channel of channels) {
    const rows = await repo.waiting(c, { clientId, topic, thread, channel });
    if (!rows.length) continue;
    const lastId = rows[rows.length - 1].outbox_id;
    const batch = await resolve(c, { clientId, topic, rows });
    if (people.length) ctx = ctx || (await context(c, tenant));

    for (const person of people) {
      if (isOff(person, channel, topic)) continue;
      if (channel === "push" && !Number(person.devices)) continue;
      const lang = languageOf(person, profile);
      const msg = await messageFor(c, { person, topic, thread, batch, lang, ctx, clientId });
      if (!msg) continue;
      const scopeKey = `${channel}:${topic}:${thread || "-"}`;
      if (channel === "email" && topic === "MESSAGES" &&
          (await repo.recentlyTold(c, { email: person.email, channel: "EMAIL", topic, keyPrefix: `${scopeKey}:`, minutes: CHAT_EMAIL_EVERY_MIN }))) {
        continue;
      }
      const claimed = await repo.claim(c, { clientId, email: person.email, channel: channel.toUpperCase(), topic, key: `${scopeKey}:${lastId}` });
      if (!claimed) continue;
      const link = `${ctx.origin}${msg.path}`;
      try {
        if (channel === "push") {
          const r = await pushService.sendToPortalUser(c, {
            portal_user_id: person.portal_user_id,
            title: msg.pushTitle,
            body: msg.pushBody,
            url: msg.path,
            // One notification per conversation or topic on the phone: the
            // newest replaces the last and still alerts.
            tag: `${topic.toLowerCase()}:${thread || "all"}`,
            renotify: true,
            urgency: msg.urgency,
          });
          if (r.failed && !r.sent) throw new Error(`push failed on ${r.failed} device(s)`);
          out.pushed += r.sent ? 1 : 0;
        } else {
          const words = { ctx, lang, heading: msg.heading, about: msg.about, lines: msg.lines, more: msg.more, cta: msg.cta, link };
          await emailService.send(c, {
            to: person.email,
            subject: msg.heading,
            html: emailHtml(words),
            text: emailText(words),
            purpose: "NOTIFICATIONS",
            moduleKey: MODULE,
            sendPoint: "portal.notify",
            language: lang,
            signature: "none",
          });
          out.emailed += 1;
        }
      } catch (err) {
        failure = failure || err;
        out.failed += 1;
        await repo.release(c, claimed).catch((e) => logger.warn({ err: e }, "[portal-notify] claim not released"));
        logger.warn({ err, clientId, topic, channel }, "[portal-notify] a send failed; the job will retry it");
      }
    }
    if (!failure) await repo.markDone(c, { ids: rows.map((r) => r.outbox_id), channel });
  }

  try {
    await repo.sweep(c);
    out.stale = await repo.staleGroups(c);
  } catch (err) {
    logger.warn({ err }, "[portal-notify] housekeeping failed; nothing was lost");
  }
  if (failure) throw failure;
  return out;
}

/* ── the team's view ───────────────────────────────────────────────────── */

/**
 * Who at a client can be reached, and how — for staff (and the AI) asking
 * "will they see this?". Emails and switches only; never an endpoint.
 */
async function staffReach(c, { clientId }) {
  const people = await repo.audience(c, { clientId });
  return people.map((p) => {
    const off = offLists(p);
    const topics = topicsFor(p.scope);
    return {
      email: p.email,
      full_name: p.full_name || null,
      access_scope: p.scope,
      devices: Number(p.devices) || 0,
      email_topics: topics.filter((t) => !off.email_off.includes(t)),
      push_topics: topics.filter((t) => !off.push_off.includes(t)),
    };
  });
}

module.exports = {
  settings, saveSettings, devices, subscribe, unsubscribe, rememberLanguage, test,
  deliver, staffReach,
  sees, topicsFor, TOPICS, DEFAULTS, COPY,
};
