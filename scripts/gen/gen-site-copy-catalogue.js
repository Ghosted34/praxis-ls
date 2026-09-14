#!/usr/bin/env node
/**
 * Generate the SITE COPY CATALOGUE — every word on the tenant website that a
 * tenant is allowed to rewrite, derived from the dictionary that ships it.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `public-web/src/lib/i18n-dict.ts` holds ~465 strings under `site.*`, and
 * every one of them is a sentence a visitor reads on a white-label site: a
 * hero, a section heading, an empty state, a form label, a legal footer line.
 * They were real, visible, and written into a frontend bundle where no tenant
 * could reach them — "Success stories / Operations we have run, in our own
 * words" is the tenant's claim about the tenant's business, printed in words
 * we chose for them.
 *
 * `site_content` already carries the right model for fixing that: the
 * dictionary is the DEFAULT, a published block is the OVERRIDE. What was
 * missing is the LIST — an enumeration of what can be overridden, so an editor
 * can show a tenant the sentence they are about to change, in both languages,
 * beside the one we shipped.
 *
 * That list cannot be hand-maintained. A string added to the dictionary during
 * a feature would simply not appear in the editor, which is the exact failure
 * this closes, one string at a time. So it is DERIVED from the dictionary and
 * gated in CI: add a `site.*` string without regenerating and `build-test`
 * goes red, the same contract `generate-api-docs.js --check` holds for
 * `doc/API_REFERENCE.md`.
 *
 * ── WHAT "WHERE IT APPEARS" IS, AND WHY IT IS COMPUTED ────────────────────
 *
 * A tenant looking for "Success stories" is not looking for
 * `site.portfolioPage.titleMain` — they are looking for *the Our-work page*.
 * So each section records the PAGES it is read on, resolved by following the
 * `@/` import graph out of every route component in `app/router.tsx` and
 * collecting the `site.<section>` keys each one can reach. A shared band such
 * as the footer therefore reports every page that mounts it, and a section
 * that stops being used anywhere reports nothing — both facts read off the
 * code rather than off a comment.
 *
 * Usage:  node scripts/gen/gen-site-copy-catalogue.js [--check]
 *   --check  exit 1 if the committed catalogue differs from what the
 *            dictionary implies, without writing.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const WEB_SRC = path.join(ROOT, "public-web", "src");
const DICT = path.join(WEB_SRC, "lib", "i18n-dict.ts");

/**
 * Dictionaries that live in a FEATURE rather than in `i18n-dict.ts` (13792).
 *
 * `i18n-dict.ts` is in the entry graph, so every string in it is downloaded by
 * every visitor to every page. A subtree only one route can ever render does
 * not belong there — `check-bundle.mjs` names that split as the lever to reach
 * for before raising the first-paint budget, and `site.careers.*` (~80 keys,
 * read by three modules all inside the careers chunk) was the first to take it.
 *
 * They are read here for one reason: being outside `i18n-dict.ts` must NOT
 * quietly remove a sentence from this catalogue. A key that is not in the
 * catalogue cannot be overridden by a tenant, and on a white-label product the
 * careers page's empty state — which is what a stranger reads when the company
 * is not hiring — is the last thing that should be un-rewritable.
 *
 * Each entry states where its object literals hang in the `site.*` tree, since
 * a feature file exports the subtree itself rather than a whole `{ site: … }`.
 * Same rules as the main dictionary: no imports, no type annotations, nothing
 * but object literals and `as const` (see `readObjectLiterals`).
 */
const FEATURE_DICTS = [
  {
    file: path.join(WEB_SRC, "features", "careers", "careers-copy.ts"),
    /** Where `en` / `fr` from that file sit under `site.` */
    mount: "careers",
  },
];
const ROUTER = path.join(WEB_SRC, "app", "router.tsx");
const OUT = path.join(ROOT, "packages", "shared", "data", "site-copy.generated.js");

/* ── the dictionary ───────────────────────────────────────────────────────
 *
 * Evaluated rather than parsed. `i18n-dict.ts` is two object literals and the
 * only TypeScript in it is the trailing `as const` on each — there are no type
 * annotations, no imports and no expressions, which is a property this reader
 * ASSERTS below rather than assumes. A regex-based parser over 1,900 lines of
 * nested bilingual copy, much of it containing braces, quotes and apostrophes,
 * would be wrong in ways nobody would notice until a French quotation mark
 * ended up as a key.
 */
/** Evaluate one dictionary module and hand back whatever it exported. Shared by
 *  the main dictionary and the feature ones, so the "no imports" rule and the
 *  eval are stated once rather than drifting between two readers. */
function readObjectLiterals(file) {
  const src = fs.readFileSync(file, "utf8");
  // If a dictionary ever grows an import or a type annotation, the eval below
  // stops being safe to reason about. Fail loudly here rather than silently
  // emitting a catalogue built from a half-evaluated file.
  if (/^\s*import\s/m.test(src)) {
    throw new Error(
      `${path.basename(file)} has grown an import — this generator evaluates it as a ` +
        "plain object literal and can no longer do so. Teach it to strip the import, or " +
        "move the dictionary data out of the module that needs one.",
    );
  }
  const body = src.replace(/\bas const\b/g, "").replace(/export const /g, "module.exports.");
  const module = { exports: {} };
  // The input is a repo file, not user data, and the alternative is a
  // bespoke TS parser.
  new Function("module", "exports", body)(module, module.exports);
  return module.exports;
}

function readDictionary() {
  const { en, fr } = readObjectLiterals(DICT);
  if (!en || !fr || !en.site || !fr.site) {
    throw new Error("i18n-dict.ts did not evaluate to { en.site, fr.site }");
  }
  // Feature dictionaries are merged back in at their mount point, so the
  // catalogue this generator emits is keyed exactly as the RUNTIME tree is —
  // `site.careers.empty` whichever file the string happens to be written in.
  // Anything else would make a key's overridability depend on a bundling
  // decision, which is not a thing a tenant can see or reason about.
  for (const { file, mount } of FEATURE_DICTS) {
    const feature = readObjectLiterals(file);
    if (!feature.en || !feature.fr) {
      throw new Error(`${path.basename(file)} did not evaluate to { en, fr }`);
    }
    if (en.site[mount] || fr.site[mount]) {
      // Two sources for one subtree means one of them silently loses, and which
      // one would depend on the order of this loop.
      throw new Error(
        `site.${mount} is declared in BOTH i18n-dict.ts and ${path.basename(file)} — ` +
          "it must live in exactly one of them.",
      );
    }
    en.site[mount] = feature.en;
    fr.site[mount] = feature.fr;
  }
  return { en, fr };
}

/** Every leaf string under an object, as dotted paths. Arrays contribute a
 *  numeric segment — `site.how.steps.0.title` — so a list item is addressable
 *  without the catalogue having to model lists as a separate kind of thing. */
function leaves(node, prefix, out = new Map()) {
  if (typeof node === "string") {
    out.set(prefix, node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => leaves(v, `${prefix}.${i}`, out));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/* ── section names a human recognises ─────────────────────────────────────
 *
 * The one hand-written table here, and deliberately small: it maps the
 * dictionary's own top-level grouping to the words a tenant would use. A
 * section missing from it is not an error — it falls back to its own name,
 * de-camel-cased — because a new section appearing in the editor under an
 * ugly label is strictly better than it not appearing at all.
 */
const SECTION_LABELS = {
  chrome: "Site chrome",
  nav: "Header navigation",
  footer: "Footer",
  // No page prefixes here: the `pages` list beside each section is computed
  // from the import graph and is the authority on where a section is read.
  // Half of these turned out to be shared — the footer reuses the hero's calls
  // to action, the how-it-works steps and the service names — so a label
  // saying "Home" would contradict the list printed next to it.
  hero: "Hero and shared calls to action",
  how: "How it works",
  proof: "Proof and lanes",
  portalBand: "Client portal band",
  preview: "Shipment preview",
  corridor: "Corridor set piece",
  announce: "Announcements band",
  services: "Services — band and cards",
  servicesPage: "Services page",
  about: "About page",
  esg: "About — ESG pillars",
  portfolioPage: "Our work (case notes)",
  insights: "Insights",
  careers: "Careers",
  contact: "Contact",
  quote: "Quote request",
  track: "Tracking widget",
  trackPage: "Tracking page",
  proposals: "Proposals",
  notFound: "Page not found",
  crash: "Error screen",
};

/** `titleMain` → "Title main"; `sub` → "Sub". The label a tenant reads beside
 *  the field, when the field has no better name than its own. */
function humanise(segment) {
  const spaced = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The label for one key: the path below its section, humanised. A numeric
 *  segment becomes a 1-based item number, because "Item 0" is a programmer's
 *  count and this string is read by somebody selling freight. */
function labelFor(key) {
  const parts = key.split(".").slice(2);
  return parts
    .map((p) => (/^\d+$/.test(p) ? `Item ${Number(p) + 1}` : humanise(p)))
    .join(" · ");
}

/* ── where a section is read ──────────────────────────────────────────────── */

const PAGE_NAMES = {
  marketing: "Home",
  about: "About",
  services: "Services",
  portfolio: "Our work",
  insights: "Insights",
  careers: "Careers",
  contact: "Contact",
  tracking: "Track",
  quote: "Quote",
  proposals: "Proposals",
  "not-found": "Page not found",
  portal: "Client portal",
};

const SOURCE_EXTS = [".tsx", ".ts"];

/**
 * Resolve a specifier to a file under `public-web/src`, or null.
 *
 * BOTH `@/…` and `./…` are followed. Relative ones are not a detail: the
 * header and the footer reach the tree through `page-shell.tsx`'s
 * `import { SiteHeader } from "./site-header"`, so an alias-only walk reports
 * that the navigation and the footer appear on no page at all — which is the
 * kind of confidently wrong answer this catalogue exists to stop printing.
 */
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of SOURCE_EXTS) {
    if (fs.existsSync(base + ext)) return base + ext;
    const indexed = path.join(base, "index" + ext);
    if (fs.existsSync(indexed)) return indexed;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/** Every `site.<section>` name a file mentions, plus every in-tree file it
 *  pulls in — the two facts the walk below needs from one read. */
function scanFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const sections = new Set();
  for (const m of src.matchAll(/["'`]site\.([A-Za-z0-9_]+)[.\]"'`]/g)) sections.add(m[1]);
  const imports = new Set();
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const resolved = resolveSpecifier(m[1], file);
    if (resolved) imports.add(resolved);
  }
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    const resolved = resolveSpecifier(m[1], file);
    if (resolved) imports.add(resolved);
  }
  return { sections, imports };
}

/** Sections reachable from one route component, following `@/` imports. The
 *  dictionary module itself is excluded — it mentions every section by
 *  definition, and including it would attribute all 465 strings to all pages. */
function sectionsReachableFrom(entry) {
  const dict = path.join(WEB_SRC, "lib", "i18n-dict.ts");
  const seen = new Set();
  const found = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || file === dict) continue;
    seen.add(file);
    const { sections, imports } = scanFile(file);
    for (const s of sections) found.add(s);
    for (const i of imports) if (!seen.has(i)) queue.push(i);
  }
  return found;
}

/**
 * `{section → [page names]}`, from the route components `router.tsx` mounts.
 *
 * Both forms are read: the lazy `import("@/features/…")` every route uses, and
 * the ONE static `import { NotFoundPage } from "@/features/…"` at the top —
 * the 404 is not code-split because it is the fallback that renders when a
 * chunk cannot load, and a catalogue that only understood `React.lazy` would
 * report that its copy appears nowhere.
 *
 * Anything the app SHELL reaches without going through a route — the error
 * boundary's crash screen, chrome mounted above the router — is attributed to
 * `EVERY_PAGE` rather than to no page, which is the difference between "this
 * text is everywhere" and "this text is dead".
 */
const EVERY_PAGE = "Every page";
const SHELL_FILES = ["@/app/error-boundary", "@/app/router", "@/main"];

function sectionPages() {
  const src = fs.readFileSync(ROUTER, "utf8");
  const out = new Map();
  const seenPage = new Set();
  const specs = [
    ...[...src.matchAll(/import\(\s*["']@\/features\/([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/from\s+["']@\/features\/([^"']+)["']/g)].map((m) => m[1]),
  ];
  for (const rel of specs) {
    const file = resolveSpecifier(`@/features/${rel}`, ROUTER);
    if (!file) continue;
    const page = PAGE_NAMES[rel.split("/")[0]] || humanise(rel.split("/")[0]);
    const key = `${page}::${file}`;
    if (seenPage.has(key)) continue;
    seenPage.add(key);
    for (const section of sectionsReachableFrom(file)) {
      if (!out.has(section)) out.set(section, []);
      if (!out.get(section).includes(page)) out.get(section).push(page);
    }
  }
  // The shell pass runs second and only fills gaps: a section a route already
  // claims is that route's, not "everywhere".
  for (const spec of SHELL_FILES) {
    const file = resolveSpecifier(spec, ROUTER);
    if (!file) continue;
    for (const section of sectionsReachableFrom(file)) {
      if (!out.has(section)) out.set(section, [EVERY_PAGE]);
    }
  }
  return out;
}

/* ── render ──────────────────────────────────────────────────────────────── */

function build() {
  const { en, fr } = readDictionary();
  const enLeaves = leaves(en.site, "site");
  const frLeaves = leaves(fr.site, "site");
  const pages = sectionPages();

  const entries = [];
  const sections = new Map();
  for (const [key, enText] of enLeaves) {
    const section = key.split(".")[1];
    if (!sections.has(section)) {
      sections.set(section, {
        key: section,
        label: SECTION_LABELS[section] || humanise(section),
        pages: pages.get(section) || [],
      });
    }
    entries.push([key, section, labelFor(key), enText, frLeaves.get(key) ?? ""]);
  }
  // Sorted by key, not by dictionary order: the dictionary is grouped for the
  // people who write code and this file is compared byte-for-byte in CI, so a
  // stable order is what keeps a reordered dictionary from reading as a diff.
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const sectionList = [...sections.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  return { entries, sections: sectionList };
}

function render({ entries, sections }) {
  const lines = [];
  lines.push('"use strict";');
  lines.push("/**");
  lines.push(" * GENERATED FILE — do not hand-edit.");
  lines.push(" * The site copy catalogue: every `site.*` string a tenant may override.");
  lines.push(` * ${entries.length} keys in ${sections.length} sections.`);
  lines.push(" * Source: public-web/src/lib/i18n-dict.ts");
  lines.push(" * Regenerate with: node scripts/gen/gen-site-copy-catalogue.js");
  lines.push(" *");
  lines.push(" * SITE_COPY_ENTRIES rows are [key, section, label, en, fr].");
  lines.push(" */");
  lines.push("");
  lines.push("exports.SITE_COPY_SECTIONS = " + JSON.stringify(sections) + ";");
  lines.push("");
  lines.push("exports.SITE_COPY_ENTRIES = [");
  for (const e of entries) lines.push("  " + JSON.stringify(e) + ",");
  lines.push("];");
  lines.push("");
  lines.push("const KEYS = new Set(exports.SITE_COPY_ENTRIES.map((e) => e[0]));");
  lines.push("");
  lines.push("/** Whether a dotted key is one this catalogue covers. The write path");
  lines.push(" *  refuses anything else, so a typo is a 422 at save time rather than an");
  lines.push(" *  override that silently never renders. */");
  lines.push("exports.isSiteCopyKey = (key) => KEYS.has(key);");
  lines.push("");
  lines.push("/** Every key, for a caller that needs the list rather than the test. */");
  lines.push("exports.siteCopyKeys = () => [...KEYS];");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const next = render(build());
  // Read and handle "not there" as an outcome, rather than asking first and
  // reading second. `existsSync` then `readFileSync` is two trips to the
  // filesystem with a gap in between, and the gap is real here: `--check` runs
  // in CI beside jobs that write into this tree, and the answer to "does it
  // exist" can stop being true before the read happens. One call cannot
  // disagree with itself.
  let current = null;
  try {
    current = fs.readFileSync(OUT, "utf8");
  } catch (err) {
    // A missing file is the ordinary first-run state and means "stale"; any
    // other error (a directory, a permission problem) is a real fault and must
    // not be silently reported as a catalogue that needs regenerating.
    if (err.code !== "ENOENT") throw err;
  }
  if (check) {
    if (current === next) {
      console.log("site copy catalogue: up to date");
      return;
    }
    console.error(
      "site copy catalogue is stale — a `site.*` string changed without regenerating.\n" +
        "  Run: node scripts/gen/gen-site-copy-catalogue.js",
    );
    process.exit(1);
  }
  fs.writeFileSync(OUT, next);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

main();
