/**
 * Worker job: fetch the page behind a link a colleague pasted, and store the card.
 *
 * Job data: `{ tenantMeta, env, urls?: string[] }`.
 *
 * WITH `urls`, it does exactly those. WITHOUT, it drains what is due — the rows
 * the send path created but never fetched (a deploy with no Redis, a message
 * posted by a producer that had no tenant context to queue with) and the rows a
 * reader marked stale. Both modes exist because the second is the one that makes
 * the feature self-healing: a queue lost to a Redis restart is not a thread whose
 * cards stay missing forever, it is a thread that catches up on the next sweep.
 *
 * ── WHY THE WORK IS HERE AND NOT IN THE REQUEST ────────────────────────────
 *
 * Because the alternative is a chat screen whose speed depends on how responsive
 * Maersk's website is at the moment you open a thread. `previewsFor` on the read
 * path answers from the cache in one indexed query and returns; this handler is
 * allowed to take six seconds per URL, retry, and fail in private. The reader's
 * only experience of a slow third party is a card that arrives a moment later than
 * it could have, which is the cheapest failure available here.
 *
 * ── WHY ONE JOB CAN CARRY SEVERAL URLS ─────────────────────────────────────
 *
 * A message with four links is one event worth of work, and the queue's unit is
 * the message, not the URL. Four jobs would be four Redis round trips, four
 * tenant-pool acquisitions and four chances to be interleaved against the same
 * reader's patience. Sequential inside the job is fine and wanted: the concurrency
 * that matters is across JOBS (`concurrency: 2` in workers.js), so two tenants'
 * backlogs never queue behind one tenant's slow host.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const links = require("../../modules/smartcomm/smartcomm.links.service");
const { logger } = require("../../config/logger");

const MAX_PER_RUN = 25;

module.exports = async function commsLinkUnfurl(job) {
  const { tenantMeta, env = "live", urls = [] } = job.data || {};
  if (!tenantMeta) throw new Error("comms-link-unfurl needs tenantMeta");
  if (links.enabled() === false) {
    logger.debug("comms-link-unfurl: COMMS_LINK_PREVIEWS is off, nothing to do");
    return { skipped: "disabled" };
  }

  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const list = Array.isArray(urls) ? urls.filter(Boolean).slice(0, MAX_PER_RUN) : [];
    if (list.length) return links.processUrls(c, list);
    const result = await links.refreshDue(c, MAX_PER_RUN);
    return { ...result, drained: true };
  });
};
