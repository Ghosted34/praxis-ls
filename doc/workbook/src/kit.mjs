// Page builders — the Bible's page chrome, expressed as functions.

export const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let pageNo = 0;
export const resetPages = () => { pageNo = 0; };
export const nextPageNo = () => String(++pageNo).padStart(2, "0");
export const currentCount = () => pageNo;

const sel = `<label class="pgsel"><input type="checkbox"><span>INCLUDE</span></label>`;

/** A standard content page with header, rule, body and footer. */
export function page(cls, footer, body) {
  const n = nextPageNo();
  return `<div class="page ${cls}">${sel}<div class="ph"><span class="lg logo-full"></span>` +
    `<span class="pn">${n}</span></div><div class="ph-line"></div><div class="pc">\n${body}\n</div>` +
    `<div class="pf"><span>${footer}</span></div></div>`;
}

/** The dark cover. */
export function cover({ tag, kicker, title, titleAccent, sub, meta, powered }) {
  nextPageNo();
  return `<div class="page dark">${sel}<div class="cover-content">
  <div><div class="cover-tag">${tag}</div>
    <div class="cover-title"><h2>${kicker}</h2><h1>${title}
<span>${titleAccent}</span></h1></div>
    <div class="cover-sub">${sub}</div></div>
  <div class="cover-bottom">
    <div class="cover-meta">${meta}</div>
    <div style="text-align:right;"><span class="lg logo-grey" style="height:36px;width:28px;opacity:.85;"></span><div class="cover-powered">${powered}</div></div>
  </div></div></div>`;
}

export const band = (num, title, meta, cls = "") =>
  `<div class="mband ${cls}"><div class="mnum">${num}</div><div><div class="mt">${title}</div>` +
  `<div class="mm">${meta}</div></div></div>`;

export const h2 = (t, em) => `<div class="h2m">${t}${em ? ` <em>${em}</em>` : ""}</div>`;
export const h1 = (t) => `<h1 class="sec"><span class="sn">//</span> ${t}</h1><div class="h1b"></div>`;
export const lead = (t) => `<p class="lead">${t}</p>`;
export const callout = (t, k = "") => `<div class="callout ${k}">${t}</div>`;
export const val = (t) => `<div class="val">${t}</div>`;
export const bl = (xs) => `<ul class="bl">${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;
export const req = (xs) => `<ul class="req">${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;
export const dod = (xs) => `<div class="dod">${xs.map((x) => `<span>${x}</span>`).join("")}</div>`;
export const chips = (xs) => `<div class="chips">${xs.map((x) => `<span class="chip">${x}</span>`).join("")}</div>`;

export const lete = (xs) =>
  `<ul class="lete">${xs.map(([m, t]) => `<li><span class="lm">${m}</span>${t}</li>`).join("")}</ul>`;

export const rgroup = (ref, head, items, em) =>
  `<div class="rgroup"><div class="rh"><span>${ref}</span>${head}${em ? `<em> — ${em}</em>` : ""}</div>` +
  req(items) + `</div>`;

export const cards = (list, three) =>
  `<div class="teamcards${three ? " three" : ""}">` + list.map((c) =>
    `<div class="tcard"${c.color ? ` style="border-top-color:${c.color};"` : ""}>` +
    `<div class="tn">${c.name}</div><div class="tr">${c.role}</div>` +
    `<ul>${c.items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`).join("") + `</div>`;

export const flow = (steps) =>
  `<div class="flow">` + steps.map((s, i) =>
    `<div class="fstep"><div class="fn">STEP ${i + 1}</div><div class="ft">${s.t}</div>` +
    `<div class="fb">${s.b}</div></div>`).join("") + `</div>`;

export const table = (cls, head, rows) =>
  `<table class="${cls}"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + `</table>`;

export const stack = (rows) =>
  `<table class="stack">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>`;

export const liaison = (l, r, cls = "") =>
  `<div class="liaison ${cls}"><span>${l}</span><span class="lr">${r}</span></div>`;

/** Shell command block. Highlights # comments. */
export const cmd = (text) =>
  `<pre class="cmd">` + esc(text).split("\n")
    .map((l) => l.trimStart().startsWith("#") ? `<span class="c">${l}</span>` : l)
    .join("\n") + `</pre>`;

/** A workbook exercise with a free-text answer box. */
export const ex = (title, time, bodyHtml, placeholder) =>
  `<div class="ex"><div class="exh"><span>${title}</span><span class="xt">${time}</span></div>` +
  bodyHtml + (placeholder === null ? "" :
    `<div class="ans" contenteditable="true" data-ph="${placeholder || "Your answer…"}"></div>`) +
  `</div>`;

/* Self-checks are numbered per chapter — SELF-CHECK 3.2 is the second one in
   chapter 3. Chapter-relative rather than a running total, so inserting a
   question in chapter 4 does not renumber every question after it, and so a
   reviewer can say "you missed 10.4" and both people can find it. Front matter
   is chapter 0. Call setChapter() at the top of each chapter module. */
let qChapter = 0;
let qSeq = 0;
export const setChapter = (n) => { qChapter = n; qSeq = 0; };

/** Self-check MCQ. correct = 0-based index. */
let qid = 0;
export const quiz = (question, options, correct, why) => {
  const id = `q${++qid}`;
  const label = `${qChapter}.${++qSeq}`;
  return `<div class="selfcheck" data-q="${id}" data-a="${correct}">` +
    `<div class="sq"><span class="sqh">SELF-CHECK ${label}</span>${question}</div>` +
    options.map((o, i) =>
      `<label class="opt"><input type="radio" name="${id}" value="${i}">${o}</label>`).join("") +
    `<div class="why"><b>Why:</b> ${why}</div></div>`;
};
