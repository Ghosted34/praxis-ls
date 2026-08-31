// JBS Praxis — house style extracted from the Fidson FieldForce Milestone Bible.
// Structure, type scale, page chrome and component classes are preserved verbatim
// so this workbook sits in the same family as every other JBS Praxis document.
//
// LOGOS: the Bible embeds two base64 PNGs (.logo-full, .logo-grey). They are not
// reproduced here — see assets/LOGOS.md for the one-step paste-in.

/* Hosted brand marks. Public URLs, so the logo appears whenever the reader is
   online. They are NOT inlined, which has one consequence worth knowing:
   html2canvas draws the PDF onto a <canvas>, and an image from another origin
   can taint that canvas. If it does, Chrome refuses to export it. To keep the
   PDF working no matter what, the marks are painted as CSS backgrounds over a
   text wordmark that is always present underneath — offline, or if the host is
   unreachable, the reader still sees "JBS" set in the brand face rather than a
   broken-image icon. Swap these for base64 data URIs to make the file fully
   self-contained again. */
export const LOGO_FULL_URL = "https://i.ibb.co/kZJNFD4/JBS-LOGO-FULL-COLOUR.png";
export const LOGO_GREY_URL = "https://i.ibb.co/9mX9TgfJ/JBS-LOGO-ON-GREY.png";

export const LOGO_CSS_SLOT = `
/* ============================================================================
   BRAND LOGOS
   .logo-full — full-colour mark, for light backgrounds
   .logo-grey — reversed mark, for the navy/dark bands
   ========================================================================== */
.lg{display:inline-block;background-repeat:no-repeat;background-position:center;background-size:contain;}
/* Fallback wordmark, sits underneath the image so nothing is ever blank. */
.logo-full,.logo-grey{position:relative;}
.logo-full::after,.logo-grey::after{content:"JBS";position:absolute;inset:0;display:flex;
  align-items:center;justify-content:center;font-family:'Montserrat',sans-serif;font-weight:900;
  font-size:7pt;letter-spacing:.5px;color:var(--midnight-navy);border:1.5px solid var(--midnight-navy);border-radius:2px;}
.logo-grey::after{color:rgba(255,255,255,.55);border-color:rgba(255,255,255,.35);}
/* The real marks, layered on top. When they load they cover the wordmark. */
.logo-full{background-image:url("${LOGO_FULL_URL}");}
.logo-grey{background-image:url("${LOGO_GREY_URL}");}
.logo-full.ok::after,.logo-grey.ok::after{display:none;}
`;

export const CSS = `
:root{
  --midnight-navy:#0A1128; --luminous-teal:#00E5FF; --stark-white:#FFFFFF; --slate-navy:#141E3C;
  --soft-bg:#F4F6F9; --text-body:#2D3142; --text-light:#6B7280; --border-light:#E2E6EC;
  --row-alt:#F8FAFB; --accent-gold:#FFB800; --accent-green:#10B981; --accent-indigo:#6366F1;
  --fin:#00B8D4; --sal:#F59E0B; --ops:#10B981; --hr:#6366F1;
  --praxis-orange:#FF5A00; --praxis-carbon:#0A0A0A;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;font-size:9pt;line-height:1.5;color:var(--text-body);
  background:#EAEEF2;display:flex;flex-direction:column;align-items:center;padding:96px 0 70px;}
.page{width:210mm;min-height:297mm;background:var(--stark-white);box-shadow:0 20px 40px rgba(0,0,0,0.08);
  position:relative;box-sizing:border-box;display:flex;flex-direction:column;margin-bottom:46px;overflow:hidden;}
.page.dark{background:var(--midnight-navy);}
.ph{padding:11mm 16mm 4mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}
.ph .lg{height:22px;width:17px;}
.ph .pn{font-family:'Fira Code',monospace;font-size:8pt;color:var(--text-light);}
.ph-line{width:calc(100% - 32mm);margin:0 auto;height:1px;background:var(--border-light);flex-shrink:0;}
.pc{flex:1;padding:6mm 16mm 4mm;overflow:visible;}
.pf{padding:3mm 16mm 7mm;text-align:center;flex-shrink:0;}
.pf span{font-family:'Fira Code',monospace;font-size:7pt;color:var(--text-light);letter-spacing:.5px;}
h1.sec{font-family:'Montserrat',sans-serif;font-size:15pt;font-weight:800;color:var(--midnight-navy);text-transform:uppercase;margin:0 0 3px;}
h1.sec .sn{color:var(--luminous-teal);}
.h1b{width:44px;height:3px;background:var(--luminous-teal);margin-bottom:9px;}
p{margin-bottom:6px;}
.lead{font-size:9.4pt;color:var(--text-light);margin-bottom:7px;line-height:1.5;}
.bl{list-style:none;margin:3px 0 7px;padding:0;}
.bl li{padding:1.2px 0 1.2px 15px;position:relative;font-size:8.6pt;line-height:1.44;}
.bl li::before{content:"";position:absolute;left:0;top:7px;width:6px;height:6px;background:var(--luminous-teal);border-radius:1px;}
.bl li strong,.bl li b{color:var(--midnight-navy);}
.callout{background:var(--soft-bg);border-left:3px solid var(--luminous-teal);padding:7px 11px;margin:6px 0 7px;font-size:8.6pt;line-height:1.45;}
.callout strong{color:var(--midnight-navy);}
.callout.gold{border-left-color:var(--accent-gold);background:#FFFBEB;}
.callout.green{border-left-color:var(--accent-green);background:#ECFDF5;}
.callout.red{border-left-color:#EF4444;background:#FEF2F2;}
/* cover */
.cover-content{flex:1;padding:60px 44px 40px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;}
.cover-content::before{content:"";position:absolute;top:-80px;right:-80px;width:320px;height:320px;border:1px solid rgba(255,255,255,.06);border-radius:50%;}
.cover-content::after{content:"";position:absolute;bottom:-120px;left:-60px;width:260px;height:260px;border:1px solid rgba(0,229,255,.08);border-radius:50%;}
.cover-tag{font-family:'Fira Code',monospace;font-size:9pt;color:var(--luminous-teal);letter-spacing:1px;border-left:2px solid var(--luminous-teal);padding-left:10px;margin-bottom:40px;}
.cover-title h2{font-family:'Montserrat',sans-serif;font-size:13pt;font-weight:700;color:var(--luminous-teal);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;}
.cover-title h1{font-family:'Montserrat',sans-serif;font-size:40pt;font-weight:900;color:var(--stark-white);line-height:.95;text-transform:uppercase;margin-bottom:12px;}
.cover-title h1 span{color:var(--luminous-teal);}
.cover-sub{font-size:10.5pt;color:rgba(255,255,255,.6);max-width:500px;margin-top:16px;line-height:1.55;}
.cover-bottom{border-top:1px solid rgba(255,255,255,.12);padding-top:16px;display:flex;justify-content:space-between;align-items:flex-end;}
.cover-meta{font-family:'Fira Code',monospace;font-size:8pt;color:rgba(255,255,255,.4);line-height:1.8;white-space:pre-line;}
.cover-powered{font-family:'Fira Code',monospace;font-size:8pt;color:rgba(255,255,255,.4);text-align:right;margin-top:8px;white-space:pre-line;}
.cover-powered strong{color:var(--luminous-teal);font-weight:500;}
.doc-end{text-align:center;margin-top:14px;padding-top:12px;border-top:2px solid var(--midnight-navy);}
.doc-end .el{font-family:'Fira Code',monospace;font-size:8pt;color:var(--text-light);letter-spacing:2px;}
.doc-end .eb{font-family:'Montserrat';font-size:9pt;font-weight:700;color:var(--midnight-navy);margin-top:4px;}
.doc-end .ep{font-family:'Fira Code';font-size:8pt;color:var(--luminous-teal);margin-top:2px;}
/* top bar */
.dl-bar{position:fixed;top:0;left:0;right:0;background:var(--midnight-navy);padding:14px 24px;display:flex;justify-content:center;align-items:center;gap:16px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);}
.dl-bar .dl-brand{position:absolute;left:24px;display:flex;align-items:center;gap:10px;}
.dl-bar .dl-brand .lg{height:20px;width:16px;}
.dl-bar .dl-brand span{font-family:'Fira Code',monospace;font-size:8pt;color:rgba(255,255,255,.45);}
.dl-btn{background:var(--luminous-teal);color:var(--midnight-navy);font-family:'Montserrat',sans-serif;font-weight:800;font-size:10pt;text-transform:uppercase;letter-spacing:1px;border:none;padding:11px 30px;cursor:pointer;transition:opacity .2s;border-radius:3px;}
.dl-btn:hover{opacity:.85;} .dl-btn:disabled{opacity:.5;cursor:wait;}
.dl-btn.alt{background:#141E3C;color:#fff;}
.dl-btn.txt{background:transparent;color:#00E5FF;border:1px solid rgba(0,229,255,.5);padding:9px 16px;}
.dl-status{font-family:'Fira Code',monospace;font-size:9pt;color:rgba(255,255,255,.6);}
/* section bands */
.mband{display:flex;gap:12px;align-items:center;background:var(--midnight-navy);border-radius:9px;padding:9px 14px;margin:0 0 9px;}
.mband.lab{background:var(--slate-navy);}
.mband.qa{background:#0E2A24;}
.mband .mnum{font-family:'Montserrat',sans-serif;font-weight:900;font-size:18pt;color:var(--luminous-teal);background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.3);border-radius:7px;padding:6px 10px 4px;line-height:1;flex-shrink:0;}
.mband .mt{font-family:'Montserrat',sans-serif;font-weight:800;font-size:12pt;color:#fff;text-transform:uppercase;line-height:1.12;}
.mband .mm{font-family:'Fira Code',monospace;font-size:7.4pt;color:rgba(255,255,255,.6);margin-top:4px;letter-spacing:.5px;}
.mband .mm b{color:var(--luminous-teal);font-weight:500;}
.h2m{font-family:'Montserrat',sans-serif;font-size:8.7pt;font-weight:800;color:var(--midnight-navy);text-transform:uppercase;letter-spacing:.5px;margin:7px 0 4px;border-left:3px solid var(--luminous-teal);padding-left:8px;}
.h2m:first-child{margin-top:0;}
.h2m em{font-family:'Fira Code',monospace;font-style:normal;font-weight:400;font-size:7.2pt;color:var(--text-light);letter-spacing:.2px;text-transform:none;}
/* checklists */
.req{list-style:none;margin:2px 0 5px;padding:0;}
.req li{position:relative;padding:1px 0 1px 22px;font-size:8.2pt;line-height:1.34;}
.req li::before{content:"";position:absolute;left:2px;top:3.6px;width:8px;height:8px;border:1.5px solid var(--fin);border-radius:2px;background:#fff;}
.req li b{color:var(--midnight-navy);}
.rgroup{margin:4px 0;}
.rgroup .rh{font-family:'Montserrat',sans-serif;font-weight:800;font-size:8pt;text-transform:uppercase;letter-spacing:.5px;color:var(--midnight-navy);border-bottom:2px solid var(--luminous-teal);padding-bottom:2px;margin-bottom:4px;}
.rgroup .rh span{color:var(--fin);font-family:'Fira Code',monospace;font-weight:700;margin-right:7px;font-size:8pt;}
.rgroup .rh em{font-family:'Fira Code',monospace;font-style:normal;font-weight:400;color:#B45309;font-size:7.2pt;letter-spacing:.3px;}
/* lettered / numbered items */
.lete{list-style:none;margin:2px 0 6px;padding:0;}
.lete li{position:relative;padding:1.4px 0 1.4px 26px;font-size:8.4pt;line-height:1.4;}
.lete li .lm{position:absolute;left:2px;top:2px;font-family:'Fira Code',monospace;font-weight:700;font-size:7.5pt;color:var(--fin);}
.lete li b{color:var(--midnight-navy);}
/* cards */
.teamcards{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin:6px 0 4px;}
.teamcards.three{grid-template-columns:repeat(3,1fr);}
.tcard{border:1px solid var(--border-light);border-top:3px solid var(--fin);border-radius:7px;padding:7px 9px;background:#fff;}
.tcard .tn{font-family:'Montserrat',sans-serif;font-weight:800;font-size:8.8pt;color:var(--midnight-navy);}
.tcard .tr{font-family:'Fira Code',monospace;font-size:6.7pt;color:var(--fin);margin:2px 0 5px;letter-spacing:.4px;}
.tcard ul{list-style:none;margin:0;padding:0;}
.tcard li{font-size:7.4pt;line-height:1.32;padding:1.6px 0 1.6px 10px;position:relative;color:var(--text-body);}
.tcard li::before{content:"";position:absolute;left:0;top:7px;width:4px;height:4px;border-radius:1px;background:var(--luminous-teal);}
.tcard li b{color:var(--midnight-navy);}
.devgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0;}
/* chips + verdict strips */
.dod{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px;}
.dod span{font-family:'Fira Code',monospace;font-size:7.3pt;background:var(--soft-bg);border:1px solid var(--border-light);padding:4px 9px;border-radius:4px;color:var(--slate-navy);}
.dod span b{color:var(--fin);font-weight:700;}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px;}
.chip{font-family:'Fira Code',monospace;font-size:7.6pt;background:#EEF1F6;border:1px solid var(--border-light);color:var(--slate-navy);padding:4px 9px;border-radius:20px;}
.chip b{color:var(--midnight-navy);}
.val{background:#ECFDF5;border-left:3px solid var(--accent-green);padding:7px 11px;margin:6px 0 7px;font-size:8.6pt;line-height:1.45;}
.val strong{color:var(--midnight-navy);}
.liaison{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--slate-navy);color:#fff;border-radius:8px;padding:6px 14px;margin:0 0 9px;font-family:'Fira Code',monospace;font-size:7.6pt;flex-wrap:wrap;}
.liaison b{color:var(--luminous-teal);font-weight:700;letter-spacing:.6px;}
.liaison .lr{color:rgba(255,255,255,.55);}
.liaison.qa{background:#0E2A24;}
/* flow */
.flow{display:flex;align-items:stretch;gap:6px;margin:6px 0 7px;flex-wrap:wrap;}
.fstep{flex:1;min-width:104px;background:var(--soft-bg);border-radius:7px;border-top:3px solid var(--luminous-teal);padding:7px 9px;}
.fstep .fn{font-family:'Fira Code',monospace;font-size:7.3pt;color:var(--fin);letter-spacing:.5px;}
.fstep .ft{font-family:'Montserrat',sans-serif;font-weight:700;font-size:8pt;color:var(--midnight-navy);margin:3px 0 2px;text-transform:uppercase;}
.fstep .fb{font-size:7.6pt;color:var(--text-body);line-height:1.35;}
/* tables */
.stack,.mst{width:100%;border-collapse:collapse;font-size:7.9pt;margin:3px 0 6px;}
.stack th,.mst th{background:var(--midnight-navy);color:#fff;text-align:left;padding:4px 8px;font-family:'Montserrat';font-weight:700;font-size:7pt;text-transform:uppercase;letter-spacing:.4px;}
.stack td,.mst td{padding:3.4px 8px;border-bottom:1px solid var(--border-light);vertical-align:top;line-height:1.36;}
.mst tr:nth-child(even) td{background:var(--row-alt);}
.stack td:first-child{font-family:'Fira Code',monospace;font-size:6.9pt;color:var(--text-light);text-transform:uppercase;width:108px;}
.stack td:last-child{color:var(--midnight-navy);}
.mst .mnum{font-family:'Fira Code',monospace;font-weight:700;color:var(--fin);text-align:center;width:26px;}
.mst .mname{font-weight:600;color:var(--midnight-navy);}
.mst .mfee{text-align:right;font-family:'Montserrat';font-weight:700;color:var(--midnight-navy);white-space:nowrap;width:52px;}
.signoff{width:100%;border-collapse:collapse;font-size:8.2pt;margin:4px 0 6px;}
.signoff th{background:#0E2A24;color:#fff;text-align:left;padding:5px 9px;font-family:'Montserrat';font-weight:700;font-size:7.3pt;text-transform:uppercase;}
.signoff td{padding:6px 9px;border-bottom:1px solid var(--border-light);}
.signoff td:first-child{font-family:'Fira Code',monospace;font-size:7.2pt;color:var(--text-light);text-transform:uppercase;}
/* toc */
.toc{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0 4px;}
.ti{background:var(--soft-bg);border-left:3px solid var(--luminous-teal);padding:6px 9px;}
.ti b{display:block;font-family:'Fira Code',monospace;font-size:7.3pt;color:var(--fin);margin-bottom:2px;}
.ti span{font-family:'Inter';font-size:8.2pt;font-weight:600;color:var(--midnight-navy);line-height:1.3;display:block;}
/* contents list */
.tocl{list-style:none;margin:6px 0 0;padding:0;column-count:2;column-gap:16mm;}
.tocl li{display:flex;align-items:baseline;gap:4px;font-size:7.9pt;line-height:1.45;padding:1.4px 0;
  break-inside:avoid;-webkit-column-break-inside:avoid;}
.tocl li.tmaj{margin-top:5px;padding-top:3px;border-top:1px solid var(--border-light);}
.tocl li.tmaj:first-child{margin-top:0;border-top:none;}
.tocl .tl{color:var(--text-body);}
.tocl li.tmaj .tl b{font-family:'Montserrat';font-weight:800;font-size:7.9pt;color:var(--midnight-navy);
  text-transform:uppercase;letter-spacing:.2px;}
.tocl .tsub{color:var(--text-light);}
.tocl .td{flex:1;border-bottom:1px dotted #C7D0DA;transform:translateY(-2px);min-width:8px;}
.tocl .tp{font-family:'Fira Code',monospace;font-size:7.2pt;color:var(--fin);font-weight:500;}
.tocl li.tmaj .tp{color:var(--midnight-navy);font-weight:700;}
/* ===== WORKBOOK ADDITIONS (not in the Bible — this doc is interactive) ===== */
code,.code{font-family:'Fira Code',monospace;font-size:7.7pt;background:#EEF1F6;border:1px solid var(--border-light);
  padding:1px 4px;border-radius:3px;color:var(--midnight-navy);}
pre.cmd{font-family:'Fira Code',monospace;font-size:7.1pt;line-height:1.42;background:var(--midnight-navy);color:#D7E3EA;
  padding:9px 12px;border-radius:8px;margin:5px 0 8px;overflow-x:auto;white-space:pre;}
pre.cmd .c{color:#7FA6B8;} pre.cmd .k{color:var(--luminous-teal);} pre.cmd .s{color:#FFD98A;}
.ex{border:1px solid var(--border-light);border-left:4px solid var(--accent-gold);border-radius:8px;background:#FFFDF7;
  padding:9px 12px;margin:8px 0 10px;}
.ex .exh{font-family:'Montserrat',sans-serif;font-weight:800;font-size:8.4pt;text-transform:uppercase;letter-spacing:.5px;
  color:#8A5A00;margin-bottom:4px;display:flex;justify-content:space-between;gap:10px;}
.ex .exh .xt{font-family:'Fira Code',monospace;font-weight:400;font-size:7pt;color:var(--text-light);text-transform:none;}
.ex p{font-size:8.3pt;line-height:1.42;margin-bottom:4px;}
.ans{border:1px dashed var(--border-light);border-radius:6px;min-height:26px;padding:5px 8px;margin:4px 0 2px;
  background:#fff;font-family:'Fira Code',monospace;font-size:8pt;color:var(--text-body);}
.ans:empty::before{content:attr(data-ph);color:#B6BDC6;}
.ans:focus{outline:2px solid rgba(0,229,255,.45);outline-offset:1px;}
.selfcheck{margin:4px 0 2px;}
/* The number sits inline at the head of the question rather than on its own
   line, so numbering all 38 self-checks costs no vertical space on an A4 page. */
.selfcheck .sqh{font-family:'Fira Code',monospace;font-size:6.3pt;letter-spacing:.09em;
  color:var(--fin);font-weight:600;background:#E8FAFD;border:1px solid #B8ECF5;
  border-radius:3px;padding:0.5px 4px;margin-right:5px;white-space:nowrap;vertical-align:1.5px;}
.selfcheck .sq{font-size:8.2pt;line-height:1.38;margin-bottom:3px;}
.selfcheck .sq b{color:var(--midnight-navy);}
.opt{display:block;font-size:7.9pt;line-height:1.36;padding:2.4px 7px;margin:1.6px 0;border:1px solid var(--border-light);
  border-radius:5px;cursor:pointer;background:#fff;}
.opt:hover{border-color:var(--fin);}
.opt input{margin-right:7px;accent-color:#00B8D4;}
.opt.right{border-color:var(--accent-green);background:#ECFDF5;}
.opt.wrong{border-color:#EF4444;background:#FEF2F2;}
.why{font-size:7.6pt;line-height:1.38;color:var(--text-light);margin:4px 0 0;padding-left:4px;border-left:2px solid var(--border-light);display:none;}
.why.show{display:block;}
.why b{color:var(--midnight-navy);}
.prog{position:fixed;left:0;bottom:0;height:3px;background:var(--luminous-teal);width:0;z-index:9998;transition:width .25s;}
.pgsel{position:absolute;top:9px;right:12px;z-index:60;display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.92);
  border:1px solid var(--border-light);border-radius:20px;padding:3px 11px 3px 8px;font-family:'Fira Code',monospace;
  font-size:7.2pt;color:var(--slate-navy);cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(10,17,40,.10);}
.pgsel input{accent-color:#00B8D4;width:12px;height:12px;cursor:pointer;}
.page.dark .pgsel{background:rgba(20,30,60,.9);border-color:rgba(0,229,255,.35);color:#cfeffd;}
body.capturing .pgsel,body.capturing .prog{display:none!important;}
body.editing .pc, body.editing .cover-content{outline:1.5px dashed rgba(0,184,212,.55);outline-offset:2px;}
.req li.done{color:var(--text-light);}
.req li.done b{color:var(--text-light);}
.req li.done::before{background:var(--fin);border-color:var(--fin);}
.req li.done::after{content:"";position:absolute;left:4.2px;top:5px;width:2.6px;height:5.4px;border:solid #fff;
  border-width:0 1.6px 1.6px 0;transform:rotate(42deg);}
.req li:hover::before{box-shadow:0 0 0 3px rgba(0,184,212,.15);}
.dl-bar .dl-prog{position:absolute;right:24px;font-family:'Fira Code',monospace;font-size:8pt;color:rgba(255,255,255,.5);}
/* ===== ENROLMENT / EXAM / CERTIFICATE ===================================== */
/* Modal shell. Used by the name gate and the exam; both are full-viewport and
   sit above the fixed toolbar. */
.mask{position:fixed;inset:0;background:rgba(10,17,40,.92);z-index:10000;display:none;
  align-items:center;justify-content:center;padding:24px;overflow-y:auto;}
.mask.on{display:flex;}
.modal{background:#fff;border-radius:14px;max-width:640px;width:100%;padding:30px 34px;
  box-shadow:0 30px 80px rgba(0,0,0,.5);position:relative;margin:auto;}
.modal.wide{max-width:820px;}
.modal h2{font-family:'Montserrat',sans-serif;font-size:19pt;font-weight:900;color:var(--midnight-navy);
  text-transform:uppercase;line-height:1.05;margin-bottom:6px;}
.modal h2 span{color:var(--fin);}
.modal .msub{font-size:10pt;color:var(--text-light);line-height:1.5;margin-bottom:16px;}
.modal label.fl{display:block;font-family:'Montserrat',sans-serif;font-weight:800;font-size:8.5pt;
  text-transform:uppercase;letter-spacing:.6px;color:var(--midnight-navy);margin:12px 0 5px;}
.modal input[type=text]{width:100%;font-family:'Inter',sans-serif;font-size:12pt;padding:11px 13px;
  border:1.5px solid var(--border-light);border-radius:7px;color:var(--text-body);background:#fff;}
.modal input[type=text]:focus{outline:none;border-color:var(--fin);box-shadow:0 0 0 3px rgba(0,184,212,.16);}
.modal .mbtn{background:var(--midnight-navy);color:#fff;font-family:'Montserrat',sans-serif;font-weight:800;
  font-size:10pt;text-transform:uppercase;letter-spacing:1px;border:none;padding:13px 30px;border-radius:6px;
  cursor:pointer;margin-top:18px;transition:opacity .2s;}
.modal .mbtn:hover{opacity:.88;}
.modal .mbtn.ghost{background:transparent;color:var(--text-light);border:1.5px solid var(--border-light);margin-left:8px;}
.modal .mbtn:disabled{opacity:.4;cursor:not-allowed;}
.modal .merr{color:#B91C1C;font-size:8.6pt;margin-top:8px;min-height:14px;}
.modal .mnote{background:var(--soft-bg);border-left:3px solid var(--luminous-teal);padding:10px 13px;
  font-size:8.6pt;line-height:1.5;margin-top:16px;border-radius:0 6px 6px 0;}
.modal .mnote b{color:var(--midnight-navy);}
/* exam */
.exam-q{border-top:1px solid var(--border-light);padding:14px 0 4px;}
.exam-q:first-of-type{border-top:none;}
.exam-q .eq{font-size:10pt;line-height:1.45;color:var(--text-body);margin-bottom:8px;}
.exam-q .eq b{color:var(--fin);font-family:'Fira Code',monospace;font-size:9pt;margin-right:7px;}
.exam-q label{display:block;font-size:9.4pt;line-height:1.4;padding:7px 11px;margin:4px 0;
  border:1.5px solid var(--border-light);border-radius:6px;cursor:pointer;transition:border-color .15s;}
.exam-q label:hover{border-color:var(--fin);}
.exam-q label.sel{border-color:var(--fin);background:#F0FBFD;}
.exam-q input{margin-right:9px;accent-color:#00B8D4;}
.exam-head{display:flex;justify-content:space-between;align-items:center;gap:12px;
  border-bottom:2px solid var(--midnight-navy);padding-bottom:9px;margin-bottom:4px;}
.exam-count{font-family:'Fira Code',monospace;font-size:9pt;color:var(--fin);}
.exam-foot{position:sticky;bottom:0;background:#fff;padding-top:14px;border-top:1px solid var(--border-light);margin-top:10px;}
/* score ring */
.score-wrap{text-align:center;padding:8px 0 4px;}
.score-num{font-family:'Montserrat',sans-serif;font-size:52pt;font-weight:900;line-height:1;color:var(--midnight-navy);}
.score-num.pass{color:var(--accent-green);} .score-num.fail{color:#EF4444;}
.score-lab{font-family:'Fira Code',monospace;font-size:9pt;color:var(--text-light);letter-spacing:1px;margin-top:4px;}
.score-bar{height:8px;background:var(--border-light);border-radius:5px;overflow:hidden;margin:16px 0 8px;}
.score-bar i{display:block;height:100%;background:var(--accent-green);width:0;transition:width .6s;}
.score-bar.fail i{background:#EF4444;}
.review{max-height:230px;overflow-y:auto;margin-top:14px;text-align:left;}
.review div{font-size:8.6pt;line-height:1.45;padding:7px 10px;margin:5px 0;border-radius:5px;
  border-left:3px solid #EF4444;background:#FEF2F2;}
.review div.ok{border-left-color:var(--accent-green);background:#ECFDF5;}
.review div b{color:var(--midnight-navy);}
/* gate/lock notice on the certificate page */
.lockbox{border:2px dashed var(--border-light);border-radius:10px;padding:16px 18px;margin:8px 0;background:var(--row-alt);}
.lockbox .lt{font-family:'Montserrat',sans-serif;font-weight:800;font-size:10pt;text-transform:uppercase;
  color:var(--midnight-navy);margin-bottom:8px;}
.lockbox .lreq{display:flex;align-items:center;gap:9px;font-size:8.8pt;padding:4px 0;color:var(--text-light);}
.lockbox .lreq i{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--border-light);
  flex-shrink:0;font-style:normal;font-size:9pt;line-height:13px;text-align:center;color:transparent;}
.lockbox .lreq.met{color:var(--text-body);}
.lockbox .lreq.met i{background:var(--accent-green);border-color:var(--accent-green);color:#fff;}
.lockbox .lreq b{color:var(--midnight-navy);}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;}
.cta button{background:var(--midnight-navy);color:#fff;font-family:'Montserrat',sans-serif;font-weight:800;
  font-size:9pt;text-transform:uppercase;letter-spacing:.8px;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;}
.cta button:disabled{background:#C3CBD6;cursor:not-allowed;}
.cta button.alt{background:var(--fin);}
/* certificate (rendered to canvas for download) */
#certCanvasWrap{position:fixed;left:-99999px;top:0;}
.cert{width:297mm;height:210mm;background:#fff;position:relative;display:flex;flex-direction:column;
  align-items:center;justify-content:center;font-family:'Inter',sans-serif;box-sizing:border-box;padding:20mm;}
.cert .cbg{position:absolute;inset:0;border:3mm solid var(--midnight-navy);}
.cert .cbg::after{content:"";position:absolute;inset:4mm;border:.6mm solid var(--luminous-teal);}
.cert .cinner{position:relative;z-index:2;text-align:center;width:100%;}
.cert .clogo{font-family:'Montserrat',sans-serif;font-weight:900;font-size:15pt;letter-spacing:5px;
  color:var(--midnight-navy);margin-bottom:3mm;}
.cert .ctag{font-family:'Fira Code',monospace;font-size:8.5pt;letter-spacing:3px;color:var(--fin);margin-bottom:12mm;}
.cert h1{font-family:'Montserrat',sans-serif;font-size:26pt;font-weight:900;color:var(--midnight-navy);
  text-transform:uppercase;letter-spacing:1px;line-height:1.1;}
.cert .crule{width:38mm;height:1.4mm;background:var(--luminous-teal);margin:5mm auto 8mm;}
.cert .cpre{font-size:10.5pt;color:var(--text-light);margin-bottom:4mm;}
.cert .cname{font-family:'Montserrat',sans-serif;font-size:32pt;font-weight:800;color:var(--fin);
  border-bottom:.5mm solid var(--border-light);padding-bottom:4mm;margin:0 auto 6mm;display:inline-block;
  min-width:120mm;line-height:1.15;}
.cert .cbody{font-size:11pt;line-height:1.7;color:var(--text-body);max-width:200mm;margin:0 auto;}
.cert .cbody b{color:var(--midnight-navy);}
.cert .cstats{display:flex;justify-content:center;gap:18mm;margin:10mm 0 0;}
.cert .cstat{text-align:center;}
.cert .cstat .cv{font-family:'Montserrat',sans-serif;font-size:20pt;font-weight:900;color:var(--midnight-navy);line-height:1;}
.cert .cstat .cl{font-family:'Fira Code',monospace;font-size:7.5pt;letter-spacing:1.5px;color:var(--text-light);margin-top:2mm;}
.cert .cfoot{position:absolute;bottom:14mm;left:20mm;right:20mm;display:flex;justify-content:space-between;
  align-items:flex-end;z-index:2;}
.cert .csig{text-align:center;}
.cert .csig .cline{width:62mm;border-top:.4mm solid var(--midnight-navy);margin-bottom:2mm;}
.cert .csig .cw{font-family:'Montserrat',sans-serif;font-size:9pt;font-weight:700;color:var(--midnight-navy);}
.cert .csig .cr{font-family:'Fira Code',monospace;font-size:7pt;color:var(--text-light);letter-spacing:1px;margin-top:1mm;}
.cert .cid{font-family:'Fira Code',monospace;font-size:7pt;color:var(--text-light);letter-spacing:1px;text-align:right;}
/* learner name echoed into the cover */
.whoami{font-family:'Fira Code',monospace;font-size:8pt;color:var(--luminous-teal);margin-top:10px;
  padding-top:9px;border-top:1px solid rgba(0,229,255,.25);}
.whoami b{color:#fff;font-weight:500;}
/* toolbar additions */
.dl-bar .who{position:absolute;right:24px;bottom:5px;font-family:'Fira Code',monospace;font-size:7.4pt;
  color:rgba(255,255,255,.4);}
.dl-bar .dl-prog{bottom:auto;}
@media print{ body{background:none;padding:0;} .page{box-shadow:none;margin:0;page-break-after:always;min-height:auto;height:297mm;}
  .dl-bar,.prog,.mask{display:none!important;} }
`;
