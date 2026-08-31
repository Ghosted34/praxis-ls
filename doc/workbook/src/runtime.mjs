// Browser runtime: PDF export, page selection, edit mode, quizzes, progress,
// and localStorage persistence of everything the learner types or answers.
//
// Plus the assessment layer: enrolment (name capture), page-visit tracking,
// the gated final examination, and certificate generation.

import { EXAM, EXAM_DRAW, PASS_MARK } from "./exam.mjs";
import { LOGO_FULL_URL, LOGO_GREY_URL } from "./brand.mjs";

export const RUNTIME = `
window.jsPDF = window.jspdf.jsPDF;
var TOTAL = document.querySelectorAll('.page').length;
var KEY = 'jbs-praxis-workbook-v1';
var EXAM = ${JSON.stringify(EXAM)};
var EXAM_DRAW = ${EXAM_DRAW};
var PASS_MARK = ${PASS_MARK};
var LOGO_FULL_URL = ${JSON.stringify(LOGO_FULL_URL)};
var LOGO_GREY_URL = ${JSON.stringify(LOGO_GREY_URL)};

/* ---------- persistence ---------- */
function store(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ return {}; } }
function save(o){ try { localStorage.setItem(KEY, JSON.stringify(o)); } catch(e){} }
function persist(k,v){ var s=store(); s[k]=v; save(s); }

function restore(){
  var s = store();
  document.querySelectorAll('.ans').forEach(function(a,i){
    var k='ans'+i; if(s[k]!==undefined) a.innerHTML=s[k];
    a.addEventListener('input', function(){ persist(k, a.innerHTML); progress(); });
  });
  document.querySelectorAll('.selfcheck').forEach(function(sc){
    var k='quiz-'+sc.dataset.q;
    if(s[k]!==undefined){ var r=sc.querySelector('input[value="'+s[k]+'"]'); if(r){ r.checked=true; mark(sc); } }
  });
  document.querySelectorAll('.req li').forEach(function(li,i){
    var k='chk'+i;
    li.style.cursor='pointer';
    if(s[k]) li.classList.add('done');
    li.addEventListener('click', function(e){
      if(e.target.closest('a,.ans')) return;
      var on = li.classList.toggle('done'); persist(k, on?1:0); progress();
    });
  });
}

/* ---------- quizzes ---------- */
function mark(sc){
  var ans = parseInt(sc.dataset.a,10);
  var picked = sc.querySelector('input:checked');
  if(!picked) return;
  sc.querySelectorAll('.opt').forEach(function(o,i){
    o.classList.remove('right','wrong');
    if(i===ans) o.classList.add('right');
    else if(o.contains(picked)) o.classList.add('wrong');
  });
  sc.querySelector('.why').classList.add('show');
}
document.querySelectorAll('.selfcheck').forEach(function(sc){
  sc.addEventListener('change', function(){
    mark(sc);
    var p = sc.querySelector('input:checked');
    persist('quiz-'+sc.dataset.q, p ? p.value : null);
    progress();
  });
});

/* ---------- progress ---------- */
function progress(){
  var tasks = document.querySelectorAll('.req li').length
            + document.querySelectorAll('.ans').length
            + document.querySelectorAll('.selfcheck').length;
  var done  = document.querySelectorAll('.req li.done').length
            + [].slice.call(document.querySelectorAll('.ans')).filter(function(a){return a.textContent.trim().length>3;}).length
            + document.querySelectorAll('.selfcheck input:checked').length;
  var pct = tasks ? Math.round(done/tasks*100) : 0;
  document.getElementById('prog').style.width = pct+'%';
  var el=document.getElementById('progTxt'); if(el) el.textContent = pct+'% complete · '+done+'/'+tasks;
}

/* ---------- page selection ---------- */
function selCount(){ return document.querySelectorAll('.pgsel input:checked').length; }
function idle(){ var n=selCount(); return n? n+' of '+TOTAL+' page(s) selected' : 'Ready'; }
document.querySelectorAll('.pgsel input').forEach(function(cb){
  cb.addEventListener('change',function(){ document.getElementById('dlStatus').textContent = idle(); });
});
function selectedPages(){
  var all=[].slice.call(document.querySelectorAll('.page'));
  var s=all.filter(function(p){return p.querySelector('.pgsel input:checked');});
  return s.length?s:all;
}

/* ---------- edit mode ---------- */
function toggleEdit(){
  var b=document.body, btn=document.getElementById('editBtn');
  var on=b.classList.toggle('editing');
  document.querySelectorAll('.pc, .cover-content').forEach(function(el){
    el.setAttribute('contenteditable', on?'true':'false'); el.spellcheck=on;
  });
  btn.textContent = on? 'Edit: ON' : 'Edit';
  document.getElementById('dlStatus').textContent = on
    ? 'Edit mode — click any text to change it, then download' : idle();
}

/* ---------- reset ---------- */
function resetWorkbook(){
  if(!confirm('Clear every answer, tick and quiz response in this workbook?')) return;
  localStorage.removeItem(KEY); location.reload();
}

/* ---------- PDF ---------- */
function renderPDF(list, filename, done){
  var pdf=new jsPDF('p','mm','a4'); var W=210; var T=list.length;
  document.body.classList.add('capturing');
  var go=function(i){
    if(i>=T){ pdf.save(filename); document.body.classList.remove('capturing'); done(); return; }
    document.getElementById('dlStatus').textContent='Page '+(i+1)+' of '+T+'...';
    html2canvas(list[i],{scale:3,useCORS:true,logging:false,
      backgroundColor:list[i].classList.contains('dark')?'#0A1128':'#FFFFFF'}).then(function(c){
      var d=c.toDataURL('image/jpeg',0.97); var h=c.height*W/c.width;
      if(i>0)pdf.addPage();
      /* Every page is authored to fit A4, but if one ever grows past it we
         slice rather than clip — a silently truncated page is the one PDF bug
         nobody notices until a reader asks where the rest of the sentence went. */
      if(h<=297.5){ pdf.addImage(d,'JPEG',0,0,W,h); }
      else {
        var slices=Math.ceil(h/297);
        for(var sIdx=0;sIdx<slices;sIdx++){
          if(sIdx>0)pdf.addPage();
          pdf.addImage(d,'JPEG',0,-sIdx*297,W,h);
        }
      }
      go(i+1);
    });
  };
  setTimeout(function(){go(0);},300);
}
function generatePDF(){
  var btn=document.getElementById('dlBtn'),status=document.getElementById('dlStatus');
  var orig=btn.innerHTML; btn.innerHTML='GENERATING...'; btn.disabled=true; btn.style.opacity='0.5';
  document.fonts.ready.then(function(){
    renderPDF(selectedPages(),'JBS_Praxis_Engineering_Workbook.pdf',function(){
      btn.innerHTML=orig; btn.style.opacity='1'; btn.disabled=false;
      status.textContent='Downloaded!'; setTimeout(function(){status.textContent=idle();},3000);
    });
  });
}
/* ======================================================================
   ENROLMENT — the learner's name, captured once and kept.
   ====================================================================== */
function learner(){ return store().learner || null; }

function enrol(){
  var s = store();
  if (s.learner) { paintIdentity(); return; }
  var m = document.getElementById('enrolMask');
  if (!m) return;
  m.classList.add('on');
  var inp = document.getElementById('enrolName');
  var err = document.getElementById('enrolErr');
  var go  = document.getElementById('enrolGo');
  setTimeout(function(){ inp.focus(); }, 120);
  var submit = function(){
    var v = (inp.value || '').trim().replace(/\\s+/g,' ');
    /* Deliberately permissive. A name is whatever the person says it is —
       the only things rejected are empty, absurdly long, or a single
       character, because those produce a certificate nobody can use. */
    if (v.length < 2) { err.textContent = 'Please enter your full name as it should appear on your certificate.'; inp.focus(); return; }
    if (v.length > 60){ err.textContent = 'That is longer than a certificate line can hold (60 characters max).'; return; }
    var st = store();
    st.learner   = v;
    st.startedAt = st.startedAt || Date.now();
    save(st);
    m.classList.remove('on');
    paintIdentity();
  };
  go.addEventListener('click', submit);
  inp.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); });
}

function paintIdentity(){
  var n = learner(); if(!n) return;
  document.querySelectorAll('.whoami b').forEach(function(el){ el.textContent = n; });
  document.querySelectorAll('.whoami').forEach(function(el){ el.style.display='block'; });
  var w = document.getElementById('whoBar'); if (w) w.textContent = n;
}

/* ======================================================================
   PAGE VISITS — the gate on the final examination.

   Tracked with IntersectionObserver rather than scroll maths: a page counts
   as visited when a majority of it has actually been on screen. Merely
   scrolling past at speed does not count, and neither does the page being
   technically in the DOM.
   ====================================================================== */
function visited(){ return store().visited || {}; }

function trackVisits(){
  var pages = [].slice.call(document.querySelectorAll('.page'));
  if (!('IntersectionObserver' in window)) {
    /* No IO support: do not punish the learner for their browser. Mark
       everything seen and let the exam gate rest on the other criteria. */
    var s = store(); s.visited = {}; pages.forEach(function(_,i){ s.visited[i]=1; }); save(s);
    return;
  }
  var io = new IntersectionObserver(function(entries){
    var s = store(); var v = s.visited || {}; var changed = false;
    entries.forEach(function(en){
      if (en.isIntersecting) {
        var i = pages.indexOf(en.target);
        if (i >= 0 && !v[i]) { v[i] = 1; changed = true; }
      }
    });
    if (changed) { s.visited = v; save(s); progress(); refreshGate(); }
  }, { threshold: 0.55 });
  pages.forEach(function(p){ io.observe(p); });
}

function visitCount(){ return Object.keys(visited()).length; }

/* ======================================================================
   THE GATE

   Three conditions, all of which must hold before the examination unlocks:
     1. enrolled (we need a name for the certificate)
     2. every page visited
     3. every lab checklist item ticked

   The gate is honest about being client-side. It is a study aid, not a
   security control, and the workbook says so in as many words — pretending
   otherwise to an audience of engineers who can open DevTools would cost
   more credibility than the gate is worth.
   ====================================================================== */
function gateState(){
  var pagesSeen = visitCount();
  var reqs  = document.querySelectorAll('.req li').length;
  var ticks = document.querySelectorAll('.req li.done').length;
  return {
    named:  !!learner(),
    pages:  pagesSeen >= TOTAL,
    pagesSeen: pagesSeen,
    labs:   reqs > 0 && ticks >= reqs,
    ticks:  ticks, reqs: reqs,
    open:   !!learner() && pagesSeen >= TOTAL && ticks >= reqs
  };
}

function refreshGate(){
  var g = gateState();
  var box = document.getElementById('gateBox');
  if (box) {
    var rows = box.querySelectorAll('.lreq');
    var set = function(el, met, txt){ if(!el) return; el.classList.toggle('met', met); el.querySelector('i').textContent = met ? '\\u2713' : ''; el.querySelector('span').innerHTML = txt; };
    set(rows[0], g.named, g.named ? 'Enrolled as <b>' + escapeHtml(learner()) + '</b>' : 'Enter your name to enrol');
    set(rows[1], g.pages, 'Read every page &mdash; <b>' + g.pagesSeen + ' of ' + TOTAL + '</b> visited');
    set(rows[2], g.labs,  'Complete every lab checklist &mdash; <b>' + g.ticks + ' of ' + g.reqs + '</b> ticked');
  }
  var btn = document.getElementById('examBtn');
  if (btn) {
    btn.disabled = !g.open;
    btn.textContent = g.open ? 'Begin Final Examination' : 'Examination Locked';
  }
  var best = store().best;
  var cbtn = document.getElementById('certBtn');
  if (cbtn) {
    var passed = best && best.pct >= PASS_MARK;
    cbtn.disabled = !passed;
    cbtn.textContent = passed ? 'Download Your Certificate' : 'Certificate Locked';
  }
  var bl = document.getElementById('bestLine');
  if (bl) {
    bl.innerHTML = best
      ? ('Best score: <b>' + best.pct + '%</b> (' + best.correct + '/' + best.total + ') on ' + new Date(best.at).toLocaleDateString() + (best.pct >= PASS_MARK ? ' &mdash; <b style="color:#10B981">PASSED</b>' : ' &mdash; ' + PASS_MARK + '% required to pass') )
      : 'Not yet attempted. ' + PASS_MARK + '% required to pass.';
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

/* ======================================================================
   THE EXAMINATION
   ====================================================================== */
var SITTING = null;

/* Fisher-Yates. Used for both question selection and option order. */
function shuffle(a){
  var r = a.slice();
  for (var i = r.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = r[i]; r[i] = r[j]; r[j] = t;
  }
  return r;
}

/* Draw EXAM_DRAW questions, and shuffle each question's OPTIONS too.
   Option order matters: the bank was hand-written and its correct answers
   are not evenly distributed across positions. Shuffling at runtime means
   position carries no signal, and a learner re-sitting cannot pattern-match
   on "it was the second one". */
function drawSitting(){
  return shuffle(EXAM).slice(0, EXAM_DRAW).map(function(q){
    var idx = q.o.map(function(_, i){ return i; });
    var ord = shuffle(idx);
    return {
      ch: q.ch, q: q.q, why: q.why,
      o: ord.map(function(i){ return q.o[i]; }),
      a: ord.indexOf(q.a)
    };
  });
}

function openExam(){
  if (!gateState().open) return;
  SITTING = drawSitting();
  var body = document.getElementById('examBody');
  body.innerHTML = SITTING.map(function(q, i){
    return '<div class="exam-q" data-i="' + i + '">'
      + '<div class="eq"><b>' + String(i+1).padStart(2,'0') + '</b>' + q.q + '</div>'
      + q.o.map(function(opt, j){
          return '<label><input type="radio" name="eq' + i + '" value="' + j + '">' + opt + '</label>';
        }).join('')
      + '</div>';
  }).join('');
  body.querySelectorAll('input[type=radio]').forEach(function(r){
    r.addEventListener('change', function(){
      var wrap = r.closest('.exam-q');
      wrap.querySelectorAll('label').forEach(function(l){ l.classList.remove('sel'); });
      r.closest('label').classList.add('sel');
      examCount();
    });
  });
  document.getElementById('examResult').style.display = 'none';
  document.getElementById('examForm').style.display = 'block';
  examCount();
  document.getElementById('examMask').classList.add('on');
  document.querySelector('#examMask .modal').scrollTop = 0;
}

function examCount(){
  var n = document.querySelectorAll('#examBody input:checked').length;
  document.getElementById('examCount').textContent = n + ' / ' + SITTING.length + ' answered';
  document.getElementById('examSubmit').disabled = n < SITTING.length;
}

function submitExam(){
  var correct = 0, review = [];
  SITTING.forEach(function(q, i){
    var picked = document.querySelector('input[name="eq' + i + '"]:checked');
    var pv = picked ? parseInt(picked.value, 10) : -1;
    var ok = pv === q.a;
    if (ok) correct++;
    review.push({ ok: ok, ch: q.ch, q: q.q, yours: pv >= 0 ? q.o[pv] : '(no answer)', right: q.o[q.a], why: q.why });
  });
  var pct = Math.round(correct / SITTING.length * 100);
  var passed = pct >= PASS_MARK;

  var s = store();
  s.attempts = (s.attempts || 0) + 1;
  /* Keep the BEST score, not the latest. Re-sitting to improve is study;
     penalising a learner for practising would teach them not to practise. */
  if (!s.best || pct > s.best.pct) s.best = { pct: pct, correct: correct, total: SITTING.length, at: Date.now() };
  s.lastAttempt = { pct: pct, at: Date.now() };
  save(s);

  document.getElementById('examForm').style.display = 'none';
  var wrongs = review.filter(function(r){ return !r.ok; });
  /* Group the misses by chapter so the learner is told WHERE to go back to. */
  var chapters = {};
  wrongs.forEach(function(r){ chapters[r.ch] = (chapters[r.ch] || 0) + 1; });
  var chapterAdvice = Object.keys(chapters).sort(function(a,b){ return chapters[b]-chapters[a]; })
    .map(function(c){ return 'Chapter ' + c + ' (' + chapters[c] + ')'; }).join(' &middot; ');

  var res = document.getElementById('examResult');
  res.innerHTML =
      '<div class="score-wrap">'
    +   '<div class="score-num ' + (passed ? 'pass' : 'fail') + '">' + pct + '%</div>'
    +   '<div class="score-lab">' + correct + ' OF ' + SITTING.length + ' CORRECT &middot; ' + PASS_MARK + '% TO PASS</div>'
    +   '<div class="score-bar' + (passed ? '' : ' fail') + '"><i style="width:' + pct + '%"></i></div>'
    + '</div>'
    + '<p class="msub" style="text-align:center;margin-top:10px">'
    +   (passed
        ? '<b style="color:#10B981">Passed.</b> Your certificate is unlocked on the final page of the workbook.'
        : '<b style="color:#EF4444">Not yet.</b> ' + (chapterAdvice ? 'Revisit: ' + chapterAdvice + '. ' : '') + 'You may re-sit as many times as you like &mdash; a fresh set of questions is drawn each time, and your best score is the one that counts.')
    + '</p>'
    + (wrongs.length
        ? '<div class="review">' + wrongs.map(function(r){
            return '<div><b>Ch ' + r.ch + ' &mdash; ' + esc(r.q) + '</b><br>'
                 + 'Your answer: ' + esc(r.yours) + '<br>'
                 + 'Correct: <b>' + esc(r.right) + '</b><br>'
                 + '<span style="color:#5A6675">' + esc(r.why) + '</span></div>';
          }).join('') + '</div>'
        : '<div class="review"><div class="ok"><b>A clean sweep.</b> Every question correct.</div></div>')
    + '<div class="exam-foot"><button class="mbtn" onclick="closeExam()">Close</button>'
    +   '<button class="mbtn ghost" onclick="openExam()">Re-sit</button></div>';
  res.style.display = 'block';
  document.querySelector('#examMask .modal').scrollTop = 0;
  refreshGate();
}

/* Render authored markup as plain text, safely.
 *
 * The old one-liner set d.innerHTML on a scratch div and handed back its
 * textContent. CodeQL called that DOM text reinterpreted as HTML and it is
 * right, because the text does not stay text: it is concatenated straight back
 * into res.innerHTML below. The round trip DECODES entities, so an authored
 * &amp;lt;img src=x onerror=...&amp;gt; comes back as a live tag and is then
 * re-parsed as one. A sanitiser that hands its output to an HTML sink has not
 * sanitised anything.
 *
 * Two steps now, and the order is the point. STRIP, so authored <code> and <b>
 * in a question still read as plain text in the review list — the exam bank
 * genuinely contains them, so escaping alone would print the tags. Then ESCAPE,
 * so whatever survives cannot be markup when it reaches innerHTML.
 *
 * The strip loops to a fixpoint and uses * not +, same as build.mjs: an empty
 * tag is one that [^>]+ cannot match.
 *
 * NOTE FOR EDITORS: this whole block is emitted inside a JS template literal,
 * so it must contain no backtick and no dollar-brace. */
function stripTags(h){
  var out = String(h), prev;
  do { prev = out; out = out.replace(/<[^>]*>/g, ''); } while (out !== prev);
  return out;
}
function esc(h){
  return stripTags(h)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function closeExam(){ document.getElementById('examMask').classList.remove('on'); }

/* ======================================================================
   THE CERTIFICATE

   Rendered as a real DOM node off-screen, captured with html2canvas at the
   same scale as the PDF export, and saved as a landscape A4 PDF.
   ====================================================================== */
function certId(name, at){
  /* Deterministic, human-checkable reference. Not cryptographic — it exists
     so a hiring manager can ask "which sitting was this?" and get an answer,
     not to prove the certificate was not forged. */
  var basis = name + '|' + at;
  var h = 0;
  for (var i = 0; i < basis.length; i++) { h = ((h << 5) - h + basis.charCodeAt(i)) | 0; }
  var hex = Math.abs(h).toString(16).toUpperCase().padStart(6, '0').slice(0, 6);
  var d = new Date(at);
  return 'JBS-' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + '-' + hex;
}

function buildCertificate(){
  var s = store(), name = s.learner, best = s.best;
  if (!name || !best || best.pct < PASS_MARK) return null;
  var at = best.at;
  var d  = new Date(at);
  var dateStr = d.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  var days = s.startedAt ? Math.max(1, Math.round((at - s.startedAt) / 86400000)) : null;

  var wrap = document.getElementById('certCanvasWrap');
  wrap.innerHTML =
      '<div class="cert" id="certNode">'
    +   '<div class="cbg"></div>'
    +   '<div class="cinner">'
    +     '<div class="clogo">JBS PRAXIS</div>'
    +     '<div class="ctag">ENGINEERING PRACTICE</div>'
    +     '<h1>Certificate of Completion</h1>'
    +     '<div class="crule"></div>'
    +     '<div class="cpre">This is to certify that</div>'
    +     '<div class="cname">' + escapeHtml(name) + '</div>'
    +     '<div class="cbody">has completed the <b>JBS Praxis Engineering Workbook</b> in full &mdash; all '
    +       TOTAL + ' pages, every laboratory exercise, and the final written examination &mdash; '
    +       'demonstrating working competence across <b>React and Vite</b>, <b>Node.js and Express</b>, '
    +       '<b>PostgreSQL</b>, testing and quality assurance, background processing, LLM integration, '
    +       'CI, deployment and rollback, and agentic prompting practice.</div>'
    +     '<div class="cstats">'
    +       '<div class="cstat"><div class="cv">' + best.pct + '%</div><div class="cl">FINAL SCORE</div></div>'
    +       '<div class="cstat"><div class="cv">' + best.correct + '/' + best.total + '</div><div class="cl">CORRECT</div></div>'
    +       '<div class="cstat"><div class="cv">' + TOTAL + '</div><div class="cl">PAGES</div></div>'
    +       (days ? '<div class="cstat"><div class="cv">' + days + '</div><div class="cl">DAY' + (days===1?'':'S') + '</div></div>' : '')
    +     '</div>'
    +   '</div>'
    +   '<div class="cfoot">'
    +     '<div class="csig"><div class="cline"></div><div class="cw">Head of Engineering</div><div class="cr">JBS PRAXIS</div></div>'
    +     '<div class="cid">ISSUED ' + dateStr.toUpperCase() + '<br>REF ' + certId(name, at) + '</div>'
    +   '</div>'
    + '</div>';
  return document.getElementById('certNode');
}

function downloadCertificate(){
  var node = buildCertificate();
  if (!node) return;
  var btn = document.getElementById('certBtn');
  var orig = btn.textContent;
  btn.textContent = 'Generating...'; btn.disabled = true;
  document.fonts.ready.then(function(){
    html2canvas(node, { scale: 3, useCORS: true, logging: false, backgroundColor: '#FFFFFF' }).then(function(c){
      var pdf = new jsPDF('l', 'mm', 'a4');           // landscape
      pdf.addImage(c.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 297, 210);
      var safe = (store().learner || 'Learner').replace(/[^A-Za-z0-9]+/g, '_');
      pdf.save('JBS_Praxis_Certificate_' + safe + '.pdf');
      document.getElementById('certCanvasWrap').innerHTML = '';
      btn.textContent = orig; btn.disabled = false;
    });
  });
}

/* ---------- brand marks ----------
   The logos are hosted, not inlined, so they need a connection. Each is drawn
   as a CSS background over a text wordmark. We probe the image once: if it
   loads we add .ok, which hides the wordmark underneath; if it fails — offline,
   host down, corporate proxy — we leave the wordmark visible. The reader gets
   brand type instead of a broken-image box, and never a blank space. */
function markLogos(){
  [['.logo-full', LOGO_FULL_URL], ['.logo-grey', LOGO_GREY_URL]].forEach(function(pair){
    var probe = new Image();
    probe.crossOrigin = 'anonymous';   // lets html2canvas reuse it untainted
    probe.onload = function(){
      var els = document.querySelectorAll(pair[0]);
      for (var i = 0; i < els.length; i++) els[i].classList.add('ok');
    };
    probe.src = pair[1];
  });
}

/* ---------- boot ---------- */
restore();
markLogos();
enrol();
paintIdentity();
trackVisits();
progress();
refreshGate();
/* The gate depends on lab ticks, which are click-driven, so recompute on any
   click rather than wiring a listener into every checklist item. */
document.addEventListener('click', function(){ setTimeout(refreshGate, 0); });
`;
