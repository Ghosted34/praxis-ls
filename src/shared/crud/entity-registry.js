/**
 * entity -> { table, pk, activeColumn } lookup, needed by soft-delete
 * restore (audit_ledger.service.js): `soft_delete.entity_ref` is
 * "<entity>:<pk-value>" where <entity> is the string each module's
 * makeService({ entity: "..." }) call chose — and that string does NOT
 * reliably match the SQL table (e.g. iam_role.service.js uses
 * entity:"iam_role" but the table is `role`; corporate_entity.service.js
 * uses entity:"entity" for table `corporate_entity`). Restoring a record
 * needs the real table, so this walks every module's *.service.js and
 * reads the __entityMeta that makeService() attaches (shared/crud/
 * resource.js), building the map from the actual code rather than
 * guessing from the entity string. Built once, cached — module-loader's
 * own discover() already proves this directory walk is cheap and safe.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { logger } = require("../../config/logger");

const MODULES_DIR = path.resolve(__dirname, "../../modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;

let cache = null;

function findServiceFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  let out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
    const sub = path.join(dir, e.name);
    const serviceFile = path.join(sub, `${e.name}.service.js`);
    if (fs.existsSync(serviceFile)) out.push(serviceFile);
    out = out.concat(findServiceFiles(sub)); // nested <group>/<module> layout
  }
  return out;
}

function build() {
  const registry = {};
  for (const file of findServiceFiles(MODULES_DIR)) {
    let mod;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      mod = require(file);
    } catch (err) {
      logger.warn({ file, err: err.message }, "entity-registry: skipped module (load error)");
      continue;
    }
    if (mod && mod.__entityMeta && mod.__entityMeta.entity) {
      registry[mod.__entityMeta.entity] = mod.__entityMeta;
    }
  }
  return registry;
}

function getEntityMeta(entity) {
  if (!cache) cache = build();
  return cache[entity] || null;
}

/** Test/ops escape hatch — force a rebuild (e.g. after adding a module in
 *  the same process, which normal boot never needs to do). */
function reset() {
  cache = null;
}

module.exports = { getEntityMeta, reset };
