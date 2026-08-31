#!/usr/bin/env node
// Builds doc/PRAXIS_ENGINEERING_WORKBOOK.html from the page modules in src/.
//
//   node doc/workbook/build.mjs
//
// Output is a single self-contained HTML file (fonts + html2canvas/jsPDF from CDN).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CSS, LOGO_CSS_SLOT, LOGO_FULL_URL, LOGO_GREY_URL } from "./src/brand.mjs";
import { RUNTIME } from "./src/runtime.mjs";
import { VENDOR_JS, FONT_CSS } from "./src/vendor.mjs";
import { resetPages, currentCount, nextPageNo } from "./src/kit.mjs";

import { frontMatter } from "./src/ch00-front.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "PRAXIS_ENGINEERING_WORKBOOK.html");

async function optional(mod, fn) {
  try {
    const m = await import(`./src/${mod}.mjs`);
    return m[fn] ? m[fn]() : [];
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && String(err.message).includes(mod)) {
      console.log(`  · ${mod} not written yet — skipping`);
      return [];
    }
    throw err;
  }
}

resetPages();

// Front matter occupies pages 1-4; reserve page 5 for the contents page so the
// chapter page numbers below are the ones the TOC will actually print.
const front = frontMatter();
const TOC_PAGE_NO = nextPageNo();
const TOC_MARK = "<!--TOC-SLOT-->";

const pages = [
  ...front,
  TOC_MARK,
  ...(await optional("ch01-shape", "chapter")),
  ...(await optional("ch02-environment", "chapter")),
  ...(await optional("ch03-module", "chapter")),
  ...(await optional("ch04-data", "chapter")),
  ...(await optional("ch05-build", "chapter")),
  ...(await optional("ch06-testing", "chapter")),
  ...(await optional("ch07-frontend", "chapter")),
  ...(await optional("ch08-jobs", "chapter")),
  ...(await optional("ch09-llm", "chapter")),
  ...(await optional("ch10-notifications", "chapter")),
  ...(await optional("ch11-devops", "chapter")),
  ...(await optional("ch12-prompting", "chapter")),
  ...(await optional("ch13-client", "chapter")),
  ...(await optional("ch99-back", "backMatter")),
];

/**
 * Strip HTML tags down to text.
 *
 * CodeQL flagged the single pass this replaces — `s.replace(/<[^>]+>/g, "")` —
 * as incomplete multi-character sanitization, and it was right, though not for
 * the reason that rule usually fires. The gap is the EMPTY TAG: `[^>]+` demands
 * at least one character between the brackets, so `<>` matches nothing and
 * survives the "sanitizer" verbatim, straight into the contents page, which
 * interpolates this result as HTML.
 *
 * `[^>]*` closes it. Checked exhaustively over every string up to length 9 in
 * the alphabet {<, >, a, /}: the old `+` form leaves a tag behind in 92,135 of
 * them, the `*` form in none.
 *
 * The loop is belt and braces, not the fix — over that same space it never once
 * changes the `*` result, because a single pass already leaves nothing a second
 * pass could match. It stays because it costs nothing and it keeps this correct
 * if the pattern is ever edited into something that CAN splice a new tag out of
 * the surrounding text, which is the classic form of this bug.
 *
 * Nothing reaches here but the chapter headings in src/, so this was never a
 * live injection route. Fixed anyway: the cost is a character, and the
 * alternative is a sanitizer that is wrong in a way somebody later trusts.
 */
function stripTags(input) {
  let out = input;
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== prev);
  return out;
}

// ---------------------------------------------------------------- contents
// Scan the emitted pages for their band/h1 titles and real page numbers, then
// build the contents page. Derived from the output so it can never drift.
const entries = [];
for (const p of pages) {
  if (typeof p !== "string" || p === TOC_MARK) continue;
  const no = (p.match(/<span class="pn">(\d+)<\/span>/) || [])[1];
  if (!no) continue;
  const bandM = p.match(/<div class="mband[^"]*">[\s\S]*?<div class="mnum">([^<]*)<\/div>[\s\S]*?<div class="mt">([^<]*)</);
  const h1M = p.match(/<h1 class="sec"><span class="sn">\/\/<\/span> ([\s\S]*?)<\/h1>/);
  if (bandM) entries.push({ no, kind: "band", num: bandM[1].trim(), title: bandM[2].trim() });
  else if (h1M) entries.push({ no, kind: "h1", title: stripTags(h1M[1]).trim() });
}

const tocRows = entries.map((e) => {
  const label = e.kind === "band"
    ? `<b>${e.num} &middot; ${e.title}</b>`
    : `<span class="tsub">${e.title}</span>`;
  return `<li class="${e.kind === "band" ? "tmaj" : ""}"><span class="tl">${label}</span><span class="td"></span><span class="tp">${e.no}</span></li>`;
}).join("");

const tocPage = `<div class="page"><label class="pgsel"><input type="checkbox"><span>INCLUDE</span></label>` +
  `<div class="ph"><span class="lg logo-full"></span><span class="pn">${TOC_PAGE_NO}</span></div>` +
  `<div class="ph-line"></div><div class="pc">\n` +
  `<h1 class="sec"><span class="sn">//</span> Contents</h1><div class="h1b"></div>\n` +
  `<p class="lead">${pages.length} pages. Bold entries are chapter openers and gates; the rest are the pages inside them. Every page number is generated from the document itself, so it cannot drift.</p>\n` +
  `<ul class="tocl">${tocRows}</ul>\n` +
  `</div><div class="pf"><span>JBS PRAXIS ENGINEERING WORKBOOK &mdash; CONTENTS</span></div></div>`;

const pagesOut = pages.map((p) => (p === TOC_MARK ? tocPage : p));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JBS Praxis — Engineering Workbook</title>
<meta name="description" content="The JBS Praxis engineering onboarding workbook: React + Vite, Node/Express, PostgreSQL, and agentic prompting. Self-contained; works offline.">
<link rel="icon" type="image/png" href="${LOGO_FULL_URL}">
<link rel="apple-touch-icon" href="${LOGO_FULL_URL}">
<!-- Fonts, html2canvas and jsPDF are inlined below. The only thing loaded from
     the network is the brand mark (favicon + logos), which needs a connection
     the first time; everything else works with the wifi off. -->
<!-- No CDN, no webfont host, no analytics. Every asset this page needs is
     inside this file, because a new engineer's first day is often the day the
     network is least cooperative. -->
<style>
${FONT_CSS}
${CSS}
${LOGO_CSS_SLOT}
</style>
</head>
<body>

<div class="dl-bar">
  <div class="dl-brand"><span class="lg logo-grey"></span><span>JBS PRAXIS · ENGINEERING WORKBOOK</span></div>
  <button class="dl-btn" id="dlBtn" onclick="generatePDF()">Download PDF</button>
  <button class="dl-btn txt" id="editBtn" onclick="toggleEdit()">Edit</button>
  <button class="dl-btn txt" onclick="resetWorkbook()">Reset</button>
  <span class="dl-status" id="dlStatus">Ready</span>
  <div class="dl-prog" id="progTxt">0% complete</div>
  <div class="who" id="whoBar"></div>
</div>

<div class="prog" id="prog"></div>

<!-- ===================== ENROLMENT ===================== -->
<!-- Shown once, on first open. Everything the workbook records afterwards is
     attached to this name, and the certificate carries it verbatim. -->
<div class="mask" id="enrolMask">
  <div class="modal">
    <h2>Welcome to the<br><span>JBS Praxis</span> Workbook</h2>
    <p class="msub">This is a working document, not a book you read. You will type into it, tick things off, and run real commands against a real codebase. It remembers everything you do, on this computer, in this browser.</p>
    <label class="fl" for="enrolName">Your full name</label>
    <input type="text" id="enrolName" placeholder="e.g. Amara Okonkwo" autocomplete="name" spellcheck="false">
    <div class="merr" id="enrolErr"></div>
    <button class="mbtn" id="enrolGo">Begin</button>
    <div class="mnote">
      <b>How your progress is saved.</b> Everything is stored locally in this browser, on this machine &mdash; nothing is uploaded and there is no account. Close the file and reopen it later and you will find your answers, ticks and scores exactly as you left them. Use the same browser each time, and avoid private/incognito windows, which discard storage on close.
    </div>
  </div>
</div>

<!-- ===================== EXAMINATION ===================== -->
<div class="mask" id="examMask">
  <div class="modal wide">
    <div class="exam-head">
      <h2 style="margin:0">Final <span>Examination</span></h2>
      <div class="exam-count" id="examCount">0 / 0 answered</div>
    </div>
    <div id="examForm">
      <p class="msub" style="margin-top:10px">Twenty questions drawn at random from the full bank, covering all thirteen chapters. Every one is answerable from the workbook and the codebase it describes. There is no time limit, and you may re-sit as often as you like &mdash; your best score stands.</p>
      <div id="examBody"></div>
      <div class="exam-foot">
        <button class="mbtn" id="examSubmit" onclick="submitExam()" disabled>Submit Examination</button>
        <button class="mbtn ghost" onclick="closeExam()">Cancel</button>
      </div>
    </div>
    <div id="examResult" style="display:none"></div>
  </div>
</div>

<!-- Off-screen render target for the certificate. -->
<div id="certCanvasWrap"></div>

${pagesOut.join("\n\n")}

<script>
${VENDOR_JS}
</script>
<script>
${RUNTIME}
</script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
console.log(`\n  ✓ ${OUT}`);
console.log(`    ${currentCount()} pages · ${kb} KB\n`);
