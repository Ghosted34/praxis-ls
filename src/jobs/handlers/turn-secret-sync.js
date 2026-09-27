/**
 * Keep coturn's set of valid secrets in step with the vault.
 *
 * Two jobs in one handler because they are the same write:
 *
 *   "sync"  publish the secrets that should be valid now. Idempotent, and the
 *           repair for anything that left the two out of step — a Redis that
 *           was down during a rotation, a relay whose keyspace was flushed,
 *           an operator who set the first secret before coturn was running.
 *
 *   "prune" drop a retired secret whose overlap has closed. Without this the
 *           old secret stays in coturn's set and keeps verifying credentials,
 *           which is the one thing rotation exists to stop — a rotation that
 *           never finishes is not a rotation.
 *
 * Both are no-ops unless the deployment opted into TURN_SECRET_SOURCE=vault,
 * so a deployment on `.env` runs this and does nothing.
 */
"use strict";

const secrets = require("../../modules/smartcomm/smartcomm.turn.secret.service");

module.exports = async function turnSecretSync(job) {
  if (job.name === "prune") {
    const pruned = await secrets.prune();
    // Whether or not anything expired, re-publishing costs one SMEMBERS and
    // repairs a set that drifted for any other reason.
    const synced = await secrets.syncRelay();
    return { ...pruned, ...synced };
  }
  return secrets.syncRelay();
};
