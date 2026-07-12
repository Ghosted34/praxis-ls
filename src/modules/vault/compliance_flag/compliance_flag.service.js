/**
 * Compliance Checker (MOD-65). Runs the rule scans (repo) and raises
 * compliance_flag rows for offenders — idempotently: each run clears the prior
 * *unresolved* flags for a rule and re-raises current violations, so resolving
 * the underlying data clears the flag on the next run. Read: list open flags +
 * a severity summary. All SQL is in the repo; the rule catalogue is pure.
 */
"use strict";

const repo = require("./compliance_flag.repo");
const events = require("./compliance_flag.events");
const { ruleKeys, severityOf, describeOf, summarize } = require("./compliance_flag.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

/** Run the checker (all rules or a subset). Returns { summary, flags }. */
async function run(client, { rules = null, actor = {} } = {}) {
  const keys = Array.isArray(rules) && rules.length ? rules.filter((k) => ruleKeys().includes(k)) : ruleKeys();
  const raised = [];
  await client.query("BEGIN");
  try {
    for (const ruleKey of keys) {
      // eslint-disable-next-line no-await-in-loop
      await repo.clearOpenByRule(client, ruleKey);
      // eslint-disable-next-line no-await-in-loop
      const offenders = await repo.scan(client, ruleKey);
      for (const o of offenders) {
        // eslint-disable-next-line no-await-in-loop
        const flag = await repo.insertFlag(client, { rule_key: ruleKey, entity_ref: o.entity_ref, severity: severityOf(ruleKey), message: o.message });
        raised.push(flag);
      }
    }
    if (raised.some((f) => f.severity === "RED")) {
      await emitEvent(client, { eventTypeKey: events.RAISED, moduleKey: events.MODULE, entityRef: "compliance:run", actorUserId: actor.user_id || null, priority: "HIGH" });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.RAISED, moduleKey: events.MODULE, entityRef: "compliance:run", after: summarize(raised) });
    await client.query("COMMIT");
    return { checked: keys, summary: summarize(raised), flags: raised };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const catalogue = () => ruleKeys().map((k) => ({ rule_key: k, severity: severityOf(k), describe: describeOf(k) }));
const list = (client, q) => repo.listFlags(client, { severity: q.severity, includeResolved: q.include_resolved === "true" || q.include_resolved === true });

async function resolve(client, { id, actor = {} }) {
  const row = await repo.resolveFlag(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Open flag not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: events.RESOLVED, moduleKey: events.MODULE, entityRef: "compliance_flag:" + id, after: row });
  return row;
}

module.exports = { run, catalogue, list, resolve };
