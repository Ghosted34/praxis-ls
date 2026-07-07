/**
 * Repo/docs → knowledge items. Walks a set of roots, reads text files
 * (.js/.sql/.md/.json), returns { kind, ref, title, content }. Skips deps/vendor.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const ROOTS = ["src", "migrations", "scripts", "doc"];
const EXT = new Set([".js", ".sql", ".md", ".json"]);
const SKIP = new Set(["node_modules", ".git", "coverage", "dist", "build", "media", "uploads"]);
const MAX_BYTES = 200 * 1024;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(e.name))) out.push(full);
  }
}

function collect() {
  const files = [];
  for (const r of ROOTS) walk(path.join(ROOT, r), files);
  const items = [];
  for (const f of files) {
    let stat;
    try {
      stat = fs.statSync(f);
    } catch {
      continue;
    }
    if (stat.size > MAX_BYTES) continue;
    const ref = path.relative(ROOT, f).replace(/\\/g, "/");
    const kind = ref.startsWith("doc/") ? "doc" : "codebase";
    items.push({ kind, ref, title: ref, content: fs.readFileSync(f, "utf8") });
  }
  return items;
}

module.exports = { collect, ROOT, ROOTS };
