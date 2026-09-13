/**
 * Worker job: tell the job-alert list about roles published since they last heard (13792).
 *
 * ── WHY THIS ONE SENDS MAIL WHERE `contract-lapse` EMITS AN EVENT ─────────
 *
 * `contract-lapse`'s header states the house rule and the reason for it: a job
 * emits, and the tenant's orchestration spine decides who is told and through
 * which channel, because sending from a handler hard-codes an audience.
 *
 * The audience here is the thing that makes this the exception. It is not staff
 * and it is not configurable — it is a list of strangers who typed an address
 * into a public page and asked to hear about vacancies. There is no MOD-11
 * watcher to route to, no Control Tower feed they can read, and no channel they
 * have but email. An event emitted here would reach the tenant, who is not the
 * person who asked.
 *
 * ── LIVE ONLY ─────────────────────────────────────────────────────────────
 *
 * For `contract-lapse`'s reason, and more sharply: a rehearsal vacancy mailed
 * to a real candidate is a job that does not exist, advertised to somebody who
 * will apply for it.
 *
 * ── WHY A WATERMARK PER SUBSCRIBER AND NOT A GLOBAL ONE ───────────────────
 *
 * Somebody who signs up today must not receive everything published this year,
 * and somebody who signed up in March must not miss what went out while the
 * worker was down. `GREATEST(last_notified_at, subscribed_at)` answers both
 * without a second table: the first send after a signup covers only what
 * appeared after they asked.
 *
 * ── WHY THE WATERMARK MOVES ONLY AFTER A SEND SUCCEEDS ────────────────────
 *
 * Marking first and sending after loses a digest on any transport failure, and
 * the person never learns what they missed. Marking after means a crash between
 * the send and the mark re-sends one digest, which is a duplicate email — the
 * cheaper of the two failures by a distance.
 *
 * Job data: { tenantMeta, env }.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const careersRepo = require("../../modules/hr/careers/careers.repo");
const vacancyRepo = require("../../modules/hr/vacancy/vacancy.repo");
const email = require("../../services/email.service");
const { logger } = require("../../config/logger");

/** Per tick, per tenant. A ceiling rather than a target — it exists so one
 *  tenant with a large list cannot hold the queue for every other tenant. */
const BATCH = 200;

/** Both halves of every sentence this job sends. In the file rather than in the
 *  site-copy catalogue because that catalogue is the PUBLIC WEB bundle's, and
 *  this text never reaches a browser — a tenant rewriting their careers page
 *  is not thereby rewriting their outbound mail. */
const COPY = {
  fr: {
    subject: (n) => (n === 1 ? "Une nouvelle offre d'emploi" : `${n} nouvelles offres d'emploi`),
    intro: "Voici ce qui a été publié depuis votre dernière notification :",
    closes: "Candidatures jusqu'au",
    unsubscribe: "Se désinscrire de ces alertes",
  },
  en: {
    subject: (n) => (n === 1 ? "A new job opening" : `${n} new job openings`),
    intro: "Here is what has been posted since we last wrote:",
    closes: "Applications close",
    unsubscribe: "Unsubscribe from these alerts",
  },
};

/**
 * A date a PERSON reads, so day-first — the rule in CLAUDE.md and the gate in
 * `check-date-format.js`. `en-GB` rather than the machine's locale for the
 * reason that gate exists: a container with no LANG renders month-first, and
 * "03/07" meaning the 3rd of July read as the 7th of March is a closing date
 * missed by a quarter.
 */
const dmy = (d) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(d instanceof Date ? d : new Date(d));

const escapeHtml = (s) =>
  String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * One digest.
 *
 * Every interpolated value is escaped: `title`, `department` and `location` are
 * typed by a recruiter into an admin form, and this is the one place they are
 * rendered as HTML rather than as React text. A role titled `Déclarant <b>` is
 * a formatting bug; the same field is also the obvious place to put a tag that
 * is not one.
 */
function digest({ rows, locale, baseUrl, token }) {
  const t = COPY[locale] || COPY.fr;
  const items = rows.map((v) => {
    const facts = [v.department, v.location].filter(Boolean).map(escapeHtml).join(" · ");
    const closes = v.closes_on ? `<br><small>${t.closes} ${dmy(v.closes_on)}</small>` : "";
    const href = `${baseUrl}/careers/${encodeURIComponent(v.public_token)}`;
    return `<li style="margin:0 0 12px"><a href="${href}">${escapeHtml(v.title)}</a>`
      + (facts ? `<br><small>${facts}</small>` : "") + closes + "</li>";
  });
  const unsubHref = `${baseUrl}/careers/alerts/unsubscribe/${encodeURIComponent(token)}`;
  const html = `<p>${t.intro}</p><ul style="padding-left:18px">${items.join("")}</ul>`
    + `<p style="margin-top:24px"><small><a href="${unsubHref}">${t.unsubscribe}</a></small></p>`;
  const text = [
    t.intro,
    "",
    ...rows.map((v) => `- ${v.title}${v.closes_on ? ` (${t.closes} ${dmy(v.closes_on)})` : ""}\n  ${baseUrl}/careers/${encodeURIComponent(v.public_token)}`),
    "",
    `${t.unsubscribe}: ${unsubHref}`,
  ].join("\n");
  return { subject: t.subject(rows.length), html, text };
}

module.exports = async function careersAlerts(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (env !== "live") return { skipped: "not live" };

  return registry.withTenantConnection(tenantMeta, env, async (client) => {
    const settings = await careersRepo.getSettings(client);
    // Turned off between the tick being scheduled and it running, or never on.
    // Checked here and not only at the scheduler, because a queued job outlives
    // the decision that queued it.
    if (!settings || !settings.alerts_enabled) return { skipped: "alerts off" };

    const subscribers = await careersRepo.listPendingAlerts(client, { limit: BATCH });
    if (!subscribers.length) return { subscribers: 0, sent: 0 };

    const published = await vacancyRepo.publishedList(client);
    if (!published.length) return { subscribers: subscribers.length, sent: 0 };

    const baseUrl = String(tenantMeta.public_base_url || "").replace(/\/+$/, "");
    // Without one, every link in the mail is relative and therefore broken. A
    // digest of dead links is worse than no digest: it spends the one piece of
    // attention the recipient was going to give it.
    if (!baseUrl) {
      logger.warn({ tenant: tenantMeta.db_name }, "[careers] no public base url — alerts not sent");
      return { skipped: "no base url" };
    }

    const sentIds = [];
    const at = new Date();
    for (const sub of subscribers) {
      const since = sub.since ? new Date(sub.since) : null;
      const fresh = published.filter(
        (v) => v.published_at && (!since || new Date(v.published_at) > since),
      );
      if (!fresh.length) continue;
      const { subject, html, text } = digest({
        rows: fresh,
        locale: sub.locale === "en" ? "en" : "fr",
        baseUrl,
        token: sub.unsubscribe_token,
      });
      try {
        await email.send(client, {
          to: sub.email,
          subject,
          html,
          text,
          purpose: "NOTIFICATIONS",
          moduleKey: "MOD-11",
          entityRef: `careers_alert:${sub.careers_alert_id}`,
          tenantSlug: tenantMeta.slug || null,
          language: sub.locale === "en" ? "en" : "fr",
        });
        sentIds.push(sub.careers_alert_id);
      } catch (err) {
        // One bad address must not cost the rest of the list their digest, and
        // the watermark stays put so the next tick tries them again.
        logger.warn({ err, alertId: sub.careers_alert_id }, "[careers] alert send failed");
      }
    }

    await careersRepo.markAlertsNotified(client, sentIds, at);
    logger.debug(
      { tenant: tenantMeta.db_name, subscribers: subscribers.length, sent: sentIds.length },
      "[careers] alert digest run",
    );
    return { subscribers: subscribers.length, sent: sentIds.length };
  });
};
