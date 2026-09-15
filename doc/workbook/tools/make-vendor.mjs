#!/usr/bin/env node
/**
 * Generates src/vendor.mjs — the offline asset bundle.
 *
 *   node doc/workbook/tools/make-vendor.mjs
 *
 * WHY THIS EXISTS
 * The workbook is handed to a new engineer as ONE file that they save to their
 * desktop and open in Chrome. On day one they may be on hotel wifi, on a plane,
 * or behind a corporate proxy that blocks cdnjs. A CDN <script> tag that fails
 * does not fail loudly — it fails as "the Download PDF button does nothing",
 * which the learner reads as "this workbook is broken" and we read as a support
 * ticket. So every byte the page needs is carried inside the page.
 *
 * Inputs are npm tarballs, not scraped URLs, so the versions are pinned and the
 * regeneration is reproducible. The JS pins come from the root package.json, so
 * Dependabot can see them — see `pinned()` below.
 *
 * Fonts are the VARIABLE (wght axis) cuts, latin subset only. One file per
 * family covers every weight the stylesheet asks for, which is why three fonts
 * cost ~123 KB raw instead of the ~1 MB a static-weight set would.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "src", "vendor.mjs");
const WORK = join(tmpdir(), "jbs-workbook-vendor");

/**
 * The pinned versions live in the ROOT package.json's devDependencies, not here.
 *
 * They are the only executable third party code this workbook carries, and the
 * copy that ships is the inlined one in src/vendor.mjs — a build output nobody
 * re-reads. Hardcoding the versions in this file put them somewhere Dependabot
 * cannot see and `npm audit` never visits, so a CVE in either library would have
 * gone unnoticed for as long as nobody happened to regenerate.
 *
 * Reading them from the manifest gives one source of truth: Dependabot raises a
 * bump against package.json, and `npm run check:workbook` fails until the
 * inlined copy is regenerated to match. The two cannot drift apart quietly.
 */
const ROOT_PKG = JSON.parse(
  readFileSync(resolve(HERE, "..", "..", "..", "package.json"), "utf8"),
);

function pinned(pkg) {
  const v = ROOT_PKG.devDependencies?.[pkg];
  if (!v) {
    throw new Error(
      `${pkg} is not in the root package.json devDependencies. Add it with an ` +
        `EXACT version (no caret) — see the "//workbook-vendor" note there.`,
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    throw new Error(
      `${pkg} is pinned as "${v}" in the root package.json. It must be an exact ` +
        `version: the inlined copy in src/vendor.mjs is a build output, and a ` +
        `floating range lets it drift from what is declared.`,
    );
  }
  return v;
}

const JS_LIBS = [
  { pkg: "html2canvas", version: pinned("html2canvas"), file: "dist/html2canvas.min.js" },
  { pkg: "jspdf", version: pinned("jspdf"), file: "dist/jspdf.umd.min.js" },
];

// family → { pkg, file, cssFamily, weights }
const FONTS = [
  {
    pkg: "@fontsource-variable/inter",
    file: "files/inter-latin-wght-normal.woff2",
    family: "Inter",
    range: "300 700",
  },
  {
    pkg: "@fontsource-variable/montserrat",
    file: "files/montserrat-latin-wght-normal.woff2",
    family: "Montserrat",
    range: "600 900",
  },
  {
    pkg: "@fontsource-variable/fira-code",
    file: "files/fira-code-latin-wght-normal.woff2",
    family: "Fira Code",
    range: "400 700",
  },
];

mkdirSync(WORK, { recursive: true });

/** npm pack + extract, returns the extracted package/ dir. */
function fetchPkg(pkg, version) {
  const spec = version ? `${pkg}@${version}` : pkg;
  const slug = spec.replace(/[@/]/g, "_");
  const dir = join(WORK, slug);
  if (existsSync(join(dir, "package", "package.json"))) return join(dir, "package");
  mkdirSync(dir, { recursive: true });
  const tgz = execFileSync("npm", ["pack", spec, "--silent"], { cwd: dir, encoding: "utf8" })
    .trim().split("\n").pop().trim();
  execFileSync("tar", ["xzf", tgz], { cwd: dir });
  return join(dir, "package");
}

// ------------------------------------------------------------------ scripts
let scripts = "";
for (const lib of JS_LIBS) {
  const dir = fetchPkg(lib.pkg, lib.version);
  const code = readFileSync(join(dir, lib.file), "utf8");
  // A literal </script> inside an inlined library would close the host <script>
  // element and dump the rest of the library into the DOM as text. Neither of
  // these two libraries contains one today; assert it rather than assume it,
  // because the day a new version does, the failure is a blank page.
  if (/<\/script/i.test(code)) {
    throw new Error(`${lib.pkg} contains a literal </script — escape it before inlining`);
  }
  scripts += `\n/* ${lib.pkg}@${lib.version} — vendored for offline use */\n${code}\n`;
  console.log(`  · ${lib.pkg}@${lib.version} ${(code.length / 1024).toFixed(0)} KB`);
}

// -------------------------------------------------------------------- fonts
let fontCss = "";
for (const f of FONTS) {
  const dir = fetchPkg(f.pkg);
  const b64 = readFileSync(join(dir, f.file)).toString("base64");
  fontCss +=
    `@font-face{font-family:'${f.family}';font-style:normal;font-display:block;` +
    `font-weight:${f.range};` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2');}\n`;
  console.log(`  · ${f.family} ${(b64.length / 1024).toFixed(0)} KB (base64)`);
}

// ------------------------------------------------------------------- output
const banner = `// GENERATED by tools/make-vendor.mjs — do not edit by hand.
// Rebuild:  node doc/workbook/tools/make-vendor.mjs
//
// Carries html2canvas + jsPDF + the three brand fonts inside the workbook so the
// single HTML file works with no network at all.
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `${banner}\nexport const VENDOR_JS = ${JSON.stringify(scripts)};\n\nexport const FONT_CSS = ${JSON.stringify(fontCss)};\n`,
  "utf8",
);

const kb = (Buffer.byteLength(readFileSync(OUT, "utf8"), "utf8") / 1024).toFixed(0);
console.log(`\n  ✓ ${OUT}\n    ${kb} KB\n`);
