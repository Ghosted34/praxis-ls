#!/usr/bin/env node
/**
 * The asset gate — guide §5.6, and the enforcement half of §1.3.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * §1.3 permits generated imagery in two forms and draws one line through it:
 *
 *   "A photoreal generated asset may never be captioned, captioned-adjacent, or
 *    positioned such that a reasonable visitor concludes it is a photograph of
 *    the tenant's own operations."
 *
 * That is a rule about what a person will infer, and rules about inference are
 * the ones that erode. Nobody sets out to put a generated face on a leadership
 * card; what happens is that six months from now a card needs a portrait, the
 * only image to hand is generated, the slot accepts it, and the reasoning that
 * made it forbidden is in a document nobody has open. This is that reasoning,
 * in a form that fails a build.
 *
 * ── WHY IT ALSO CHECKS BYTES AND ALT TEXT ──────────────────────────────────
 *
 * Because they are the other two ways an asset register goes wrong quietly. A
 * spec with no byte cap is how a 4 MB hero lands on a metered connection; a
 * non-decorative asset with no bilingual `alt` is how the French page ends up
 * with an English description, which is N10 and `check:i18n`'s whole subject.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It does not open any images: there are none in this repository and there must
 * not be (§4.1, O-7). Tenant media rides `storage.service` and is served from
 * `/media`. This gate reads the DECLARATION and holds it to the rules.
 *
 *   node scripts/check-assets.mjs   (npm run check:assets)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const manifestPath = path.join(root, "src", "assets", "manifest.ts");

const failures = [];
const fail = (what, why) => failures.push({ what, why });

if (!existsSync(manifestPath)) {
  console.error("✗ src/assets/manifest.ts is missing — §4.2 requires the register.");
  process.exit(1);
}

const src = readFileSync(manifestPath, "utf8");

/**
 * Parsed by regex rather than imported.
 *
 * The manifest is TypeScript with template-literal types in it, so importing it
 * would mean a compile step inside a gate that is supposed to run in 40 ms
 * beside the other checks. The shape is fixed and flat — §4.2 defines it — and
 * a spec this parser cannot read is reported as unparseable rather than skipped
 * silently, which is the only failure mode that would matter.
 */
const EVIDENCE = (() => {
  const block = src.match(/EVIDENCE_SLOTS[^=]*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    fail("EVIDENCE_SLOTS", "not found — the §1.3 slot list is what this gate enforces");
    return [];
  }
  return [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
})();

/* An EMPTY register (`= [];`) is a legitimate state and must not fail.
 *
 * The first version of this pattern required a newline before the closing
 * bracket, so `= [];` did not match and the gate reported the register
 * "not found" on the very tree it shipped with. That is the failure mode
 * F-12 describes from the other direction — a gate that is wrong about the
 * ordinary case is a gate people learn to ignore — and it is why this was
 * proved against a violating register AND an empty one before being wired in.
 */
const ASSETS_BLOCK = src.match(/ASSETS:\s*readonly AssetSpec\[\]\s*=\s*\[([\s\S]*?)\];/);
if (!ASSETS_BLOCK) {
  fail("ASSETS", "not found, or not in the `ASSETS: readonly AssetSpec[] = [ … ];` form §4.2 specifies");
}

/** One `{ … }` object per spec, at the top level of the array. */
function specs(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (body[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) out.push(body.slice(start, i + 1));
    }
  }
  return out;
}

const field = (text, name) => {
  const m = text.match(new RegExp(`\\b${name}\\s*:\\s*("[^"]*"|[^,\\n}]+)`));
  return m ? m[1].trim().replace(/^"|"$/g, "") : null;
};

const entries = ASSETS_BLOCK ? specs(ASSETS_BLOCK[1]) : [];

for (const text of entries) {
  const key = field(text, "key");
  const slot = field(text, "slot");
  const provenance = field(text, "provenance");
  const name = key || "(a spec with no key)";

  if (!key) fail(name, "no `key` — the storage key is how the asset is found at all");
  if (!slot) fail(name, "no `slot`");
  if (!provenance) fail(name, "no `provenance` — §1.3 makes it a required field on upload");

  // ── §1.3: the placement rule ──
  if (provenance === "generated" && slot && EVIDENCE.includes(slot)) {
    fail(
      name,
      `provenance "generated" in slot "${slot}". §1.3: a photoreal generated asset may ` +
        `never be positioned such that a reasonable visitor concludes it is a photograph ` +
        `of the tenant's own operations. Atmosphere slots accept any provenance; this one ` +
        `sits beside a factual claim.`,
    );
  }

  // ── the byte cap ──
  const maxBytes = Number((field(text, "maxBytes") || "").replace(/_/g, ""));
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    fail(name, "no usable `maxBytes` — a spec with no cap is how a 4 MB hero reaches a metered connection");
  } else if (maxBytes > 600_000) {
    fail(name, `maxBytes ${maxBytes} is over the 600 kB per-asset ceiling`);
  }

  const minWidth = Number(field(text, "minWidth"));
  if (!Number.isFinite(minWidth) || minWidth <= 0) {
    fail(name, "no usable `minWidth`");
  }

  const aspect = field(text, "aspect");
  if (!aspect || !/^\d+:\d+$/.test(aspect)) {
    fail(name, `aspect ${aspect ?? "(absent)"} is not the \`w:h\` form §4.2 specifies`);
  }

  // ── bilingual alt, unless explicitly decorative ──
  const altNull = /\balt\s*:\s*null\b/.test(text);
  if (!altNull) {
    const hasFr = /\balt\s*:\s*\{[^}]*\bfr\s*:\s*"[^"]+"/.test(text);
    const hasEn = /\balt\s*:\s*\{[^}]*\ben\s*:\s*"[^"]+"/.test(text);
    if (!hasFr || !hasEn) {
      fail(
        name,
        "alt must carry BOTH fr and en (N10), or be exactly `null` to declare the asset " +
          "decorative. A half-translated alt is an English description on the French page.",
      );
    }
  }
}

/* ── the per-sequence budgets (§5.6) ──────────────────────────────────────
 *
 * A frame sequence caps at 180 kB gzip total and 24 frames; video atmosphere
 * caps at 150 kB. Neither exists in the tree yet, so what is checked is that
 * the numbers have not been raised — the register is where they would be, and
 * a budget nobody states is a budget nobody keeps.
 */
const SEQUENCE_MAX_FRAMES = 24;
const sequences = [...src.matchAll(/frames\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
for (const frames of sequences) {
  if (frames > SEQUENCE_MAX_FRAMES) {
    fail("frame sequence", `${frames} frames is over the §5.6 cap of ${SEQUENCE_MAX_FRAMES}`);
  }
}

if (failures.length) {
  console.error(`✗ check:assets — ${failures.length} problem(s) in the asset register:\n`);
  for (const f of failures) console.error(`  ${f.what}\n    ${f.why}\n`);
  process.exit(1);
}

console.log(
  `✓ check:assets — ${entries.length} spec(s); provenance/slot rule (§1.3) holds, ` +
    `byte caps and bilingual alt present.`,
);
