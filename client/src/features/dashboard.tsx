/**
 * Control Tower home — the Lovable "Control Tower" mock rendered in an isolated
 * <iframe srcDoc>, now fed with LIVE backend data instead of the static sample:
 *   GET /dashboard/control-tower → { operation_files, approvals_awaiting, live_shipments[] }
 *   GET /dashboard/kpis          → flat guarded counts
 *
 * We keep the mock's exact look (its own CSS/markup from features/dashboard-mock/*),
 * hide its duplicate app chrome (topbar / test banner / drawer — the app already
 * provides those), and inject a small script that rewrites the live-shipments list,
 * the "N active" pill, the hero subline and the Praxis briefing from real data. The
 * iframe's data-theme tracks the app's light/dark class.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { tenant } from "@/lib/api-client";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { errMsg } from "@/features/sales/ui";
import mockBody from "./dashboard-mock/body.html.txt?raw";
import mockStyle from "./dashboard-mock/style.css.txt?raw";
import mockScript from "./dashboard-mock/script.js.txt?raw";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Past-due receivables from `GET /receivables/overdue` (MOD-52).
 *
 * This replaced a derivation off the `receivables_ageing` report. Both the KPI
 * card and its drill-down now read this one payload, so the headline figure and
 * the invoice list reconcile by construction — previously the card came from the
 * ageing buckets (net of receipts) while the list came from raw invoices (not),
 * and they could disagree on screen. Returns null when the module is gated or
 * the user lacks the grant, so the card hides rather than showing a false zero.
 */
type OverduePayload = {
  total?: number;
  count?: number;
  clients?: number;
  invoices?: Row[];
};

/** Derive the mock status-pill class from a free-text status. */
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (/await|approv|pending/.test(s)) return "st-orange";
  if (/transit|progress|port|clear|berth|road|moving/.test(s)) return "st-blue";
  if (/deliver|complete|closed|paid|done|arrived|departed/.test(s)) return "st-ok";
  if (/overdue|risk|hold|block|late/.test(s)) return "st-warn";
  return "st-mute";
}

/** Map a live control-tower shipment to the shape the mock's liverow expects. */
function toLiveShipment(s: Row) {
  const route = str(s.route ?? s.lane ?? "");
  const parts = route.split(/→|->|—|-|to/i).map((p) => p.trim()).filter(Boolean);
  const vessel = str(s.vessel ?? s.vessel_flight ?? "");
  const mode = /air|flight|mawb/i.test(vessel + " " + route)
    ? "air"
    : /road|truck|corridor|transit/i.test(str(s.service ?? s.mode ?? "") + " " + route)
      ? "road"
      : "sea";
  const status = str(s.status ?? s.state ?? "Active");
  const metaBits = [str(s.client ?? s.client_name ?? vessel), str(s.eta ?? s.eta_label ?? "")].filter(Boolean);
  return {
    ref: str(s.ref ?? s.dossier_ref ?? s.reference ?? "—"),
    mode,
    from: parts[0] ?? route,
    to: parts[1] ?? "",
    st: status,
    stc: statusClass(status),
    meta: metaBits.join(" · "),
    prog: Number(s.progress ?? s.prog ?? 0) || 45,
  };
}

/* ───────────────────────── KPI drill-downs ─────────────────────────────────
 * Clicking a KPI card opens the mock's detail modal. That modal used to render
 * hardcoded sample rows (its own `kpiData` object) even though the card values
 * were live. We now build each drill-down from the same endpoints the rest of the
 * app uses and override the mock's `openKpi` so it renders real records.
 *
 * There is no dedicated drill-down endpoint and none is needed — every figure here
 * comes from a list the user is already entitled to read. Any source that 403s
 * (fleet is feature-gated, reports likewise) simply yields an empty drill-down
 * with an explanatory message rather than breaking the tower.
 */

/** A cell row; `tone` renders the LAST cell as one of the mock's status pills. */
type DrillRow = { cells: string[]; tone?: string };
type Drill = {
  title: string;
  chip: string;
  chipText: string;
  meta: string[];
  headers: string[];
  rows: DrillRow[];
  cta: string;
  empty: string;
};

/** Where each card's CTA sends the user in the real app (not the mock's own views). */
const KPI_ROUTE: Record<string, string> = {
  revenue: "/finance/invoices",
  sla: "/operations",
  overdue: "/finance/receivables",
  fleet: "/fleet/vehicles",
};

const LOCKED_STATUSES = ["ISSUED_LOCKED", "APPROVED_LOCKED", "POSTED_LOCKED"];
const isLockedFinal = (r: Row) =>
  str(r.type).toUpperCase() === "FINAL" && LOCKED_STATUSES.includes(str(r.status).toUpperCase());

const grouped = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));

/**
 * Drill-down `meta` entries carry deliberate <b> markup, so they're injected as
 * HTML. Any value interpolated into them comes from the database (client names,
 * dossier refs), so escape it here — the iframe runs allow-same-origin, which is
 * not a security boundary worth trusting.
 */
const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/** Revenue → locked FINAL invoices, grouped by client (biggest first). */
function buildRevenueDrill(invoices: Row[] | null, clientName: Record<string, string>, cur: string): Drill {
  const finals = (invoices || []).filter(isLockedFinal);
  const byClient = new Map<string, { total: number; count: number }>();
  finals.forEach((r) => {
    const key = str(r.client_id) || "—";
    const prev = byClient.get(key) || { total: 0, count: 0 };
    byClient.set(key, { total: prev.total + (Number(r.total_ttc) || 0), count: prev.count + 1 });
  });
  const total = finals.reduce((s, r) => s + (Number(r.total_ttc) || 0), 0);
  const ranked = [...byClient.entries()].sort((a, b) => b[1].total - a[1].total);
  return {
    title: "Revenue · locked invoices",
    chip: "st-orange",
    chipText: `${finals.length} locked invoice${finals.length === 1 ? "" : "s"}`,
    meta: [
      `Total <b>${grouped(total)} ${cur}</b>`,
      `Invoices <b>${finals.length}</b>`,
      `Clients <b>${ranked.length}</b>`,
      ranked.length ? `Top <b>${escHtml(clientName[ranked[0][0]] || "Unattributed")}</b>` : "",
    ].filter(Boolean),
    headers: ["Client", "Invoices", cur, "Share"],
    rows: ranked.slice(0, 8).map(([id, v]) => ({
      cells: [
        clientName[id] || "Unattributed",
        String(v.count),
        grouped(v.total),
        total > 0 ? `${Math.round((v.total / total) * 100)}%` : "—",
      ],
    })),
    cta: "Open invoices →",
    empty: "No locked FINAL invoices yet — revenue posts here as invoices are locked.",
  };
}

/** SLA → dossiers that have both an ETA and an ATA; late ones surface first. */
function buildSlaDrill(dossiers: Row[] | null): Drill {
  const measured = (dossiers || []).filter((d) => d.eta && d.ata);
  const scored = measured.map((d) => {
    const eta = new Date(str(d.eta));
    const ata = new Date(str(d.ata));
    const slip = daysBetween(eta, ata);
    return { d, slip, onTime: slip <= 0 };
  });
  const late = scored.filter((s) => !s.onTime);
  const pct = measured.length ? Math.round(((measured.length - late.length) / measured.length) * 100) : null;
  const route = (d: Row) => [str(d.pol), str(d.pod)].filter(Boolean).join(" → ") || "—";
  return {
    title: "On-time delivery",
    chip: late.length ? "st-warn" : "st-ok",
    chipText: `${measured.length} arrival${measured.length === 1 ? "" : "s"} measured`,
    meta: [
      `On time <b>${pct === null ? "—" : pct + "%"}</b>`,
      `Measured <b>${measured.length}</b>`,
      `Late <b>${late.length}</b>`,
    ],
    headers: ["Dossier", "Route", "ETA", "Result"],
    // Late first, worst slip at the top — that's what a controller wants to see.
    rows: [...late.sort((a, b) => b.slip - a.slip), ...scored.filter((s) => s.onTime)].slice(0, 8).map((s) => ({
      cells: [
        str(s.d.ref),
        route(s.d),
        str(s.d.eta),
        s.onTime ? "On time" : `${s.slip} day${s.slip === 1 ? "" : "s"} late`,
      ],
      tone: s.onTime ? "st-ok" : s.slip > 3 ? "st-bad" : "st-warn",
    })),
    cta: "Open operation files →",
    empty: "No arrivals recorded yet — on-time rate needs both an ETA and an ATA on a dossier.",
  };
}

/**
 * Overdue → `GET /receivables/overdue`. Amounts are `outstanding` (total_ttc net
 * of payment_allocation), which is the same basis as the KPI card's total, so the
 * rows here sum to the headline figure.
 */
function buildOverdueDrill(payload: OverduePayload | null, clientName: Record<string, string>, cur: string): Drill {
  const invoices = payload?.invoices || [];
  const oldest = invoices.length ? Number(invoices[0].days_overdue) || 0 : 0;
  return {
    title: "Receivables · past due",
    chip: "st-warn",
    chipText: "Outstanding past due date",
    meta: [
      `Outstanding <b>${grouped(Number(payload?.total) || 0)} ${cur}</b>`,
      `Invoices <b>${payload?.count ?? invoices.length}</b>`,
      `Clients <b>${payload?.clients ?? 0}</b>`,
      invoices.length ? `Oldest <b>${oldest} days</b>` : "",
    ].filter(Boolean),
    headers: ["Invoice", "Client", cur, "Age"],
    rows: invoices.slice(0, 8).map((r) => {
      const age = Number(r.days_overdue) || 0;
      return {
        cells: [
          str(r.doc_number) || str(r.invoice_id).slice(0, 8),
          clientName[str(r.client_id)] || "—",
          grouped(Number(r.outstanding) || 0),
          `${age} days`,
        ],
        tone: age > 30 ? "st-bad" : "st-warn",
      };
    }),
    cta: "Open receivables →",
    empty: "Nothing past due — every locked invoice is within terms.",
  };
}

/** Fleet → the vehicle register (feature-gated `fleet`; empty when off). */
function buildFleetDrill(vehicles: Row[] | null): Drill {
  const all = vehicles || [];
  const active = all.filter((v) => str(v.status).toUpperCase() === "ACTIVE");
  return {
    title: "Fleet utilisation",
    chip: "st-blue",
    chipText: `${active.length} of ${all.length} active`,
    meta: [
      `Active <b>${active.length}</b>`,
      `Fleet size <b>${all.length}</b>`,
      `Utilisation <b>${all.length ? Math.round((active.length / all.length) * 100) + "%" : "—"}</b>`,
    ],
    headers: ["Vehicle", "Category", "Status"],
    rows: all.slice(0, 8).map((v) => ({
      cells: [str(v.registration) || str(v.vehicle_id).slice(0, 8), str(v.category) || "—", str(v.status) || "—"],
      tone: str(v.status).toUpperCase() === "ACTIVE" ? "st-blue" : "st-mute",
    })),
    cta: "Open fleet →",
    empty: "No vehicles visible — the fleet module may be switched off for this tenant.",
  };
}

type LiveData = {
  shipments: ReturnType<typeof toLiveShipment>[];
  activeCount: number;
  heroSub: string;
  briefing: string;
  kpi: {
    revenue: number | null;
    revenueCur: string;
    sla: number | null;
    fleetActive: number | null;
    fleetTotal: number | null;
    overdue: number | null;
  };
  drill: Record<string, Drill>;
};

/** Build the live-data injection script that runs after the mock's own script. */
function liveInjectionScript(live: LiveData): string {
  return `
(function(){
  var LIVE = ${JSON.stringify(live)};
  function esc(s){ return String(s==null?"":s).replace(/[&<>]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }
  function fmtM(v){ var n = Number(v) || 0; return (n/1e6).toFixed(1); }
  function icon(mode){
    if(mode==='sea') return '<svg viewBox="0 0 24 24"><path d="M3 14l9-4 9 4-9 5z"/><path d="M12 10V4"/></svg>';
    if(mode==='air') return '<svg viewBox="0 0 24 24"><path d="M2 12l20-7-7 20-3-8z"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M3 7h11l4 4v4h-2"/><circle cx="7" cy="16" r="2"/><circle cx="16" cy="16" r="2"/></svg>';
  }
  function liveRow(d){
    return '<div class="liverow">'
      + '<div class="ck '+d.mode+'">'+icon(d.mode)+'</div>'
      + '<div class="lb">'
      + '<div class="r1"><span class="ref">'+esc(d.ref)+'</span><span class="status '+d.stc+'" style="padding:2px 7px">'+esc(d.st)+'</span></div>'
      + '<div class="rt"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'+esc(d.from)+(d.to?(' &rarr; '+esc(d.to)):'')+'</div>'
      + '<div class="meta">'+esc(d.meta)+'</div>'
      + '<div class="bar"><i style="width:'+(d.prog||40)+'%"></i></div>'
      + '</div></div>';
  }
  try {
    var list = document.getElementById('liveList');
    if(list){
      list.innerHTML = LIVE.shipments.length
        ? LIVE.shipments.slice(0,7).map(liveRow).join('')
        : '<div class="meta" style="padding:18px">No live shipments right now.</div>';
    }
    var pill = document.querySelector('.livepanel .lph .status');
    if(pill) pill.textContent = LIVE.activeCount + ' active';
    var hsub = document.querySelector('#v-home .hsub');
    if(hsub && LIVE.heroSub) hsub.textContent = LIVE.heroSub;
    var brief = document.querySelector('.praxis .pt p');
    if(brief && LIVE.briefing) brief.innerHTML = LIVE.briefing;
    // KPI strip: all four cards are live now. Order in the mock is
    // [revenue, sla, overdue, fleet]; any metric that resolves null hides its card
    // rather than showing a stale mock value.
    var cards = document.querySelectorAll('.kpis .kpi');
    function setKpi(i, kv, kd){ var c = cards[i]; if(!c) return; var a = c.querySelector('.kv'); if(a) a.innerHTML = kv; var b = c.querySelector('.kd'); if(b){ b.textContent = kd || ''; b.className = 'kd'; } }
    function hideKpi(i){ var c = cards[i]; if(c) c.style.display = 'none'; }
    var K = LIVE.kpi || {};
    if(K.revenue == null) hideKpi(0); else setKpi(0, fmtM(K.revenue) + '<small> M ' + esc(K.revenueCur || 'XAF') + '</small>', 'Locked FINAL invoices');
    if(K.sla == null) hideKpi(1); else setKpi(1, esc(K.sla) + '<small> %</small>', 'On-time delivery');
    if(K.overdue == null) hideKpi(2); else setKpi(2, fmtM(K.overdue) + '<small> M ' + esc(K.revenueCur || 'XAF') + '</small>', 'Past due (1–90+ days)');
    if(K.fleetTotal == null || Number(K.fleetTotal) === 0) hideKpi(3); else setKpi(3, esc(K.fleetActive || 0) + '<small> / ' + esc(K.fleetTotal) + ' vehicles</small>', 'Active now');
  } catch(e){ /* keep the mock visible even if injection fails */ }

  // ── KPI drill-downs ──
  // The mock's openKpi renders its own sample rows and simulates an ~18% random
  // load failure. Both are wrong once the data is real, so we replace openKpi
  // outright (it's a top-level function declaration, hence a window property, so
  // the inline onclick="openKpi('revenue')" handlers pick this up). closeKpi and
  // setupKpiKeyboard are reused as-is — they only touch the DOM.
  try {
    var DRILL = LIVE.drill || {};
    function pill(tone, label){ return '<span class="status ' + esc(tone) + '">' + esc(label) + '</span>'; }
    function drillTable(d){
      var head = d.headers.map(function(h){ return '<th>' + esc(h) + '</th>'; }).join('');
      var body = d.rows.map(function(r){
        var last = r.cells.length - 1;
        var tds = r.cells.map(function(c, i){
          if(r.tone && i === last) return '<td>' + pill(r.tone, c) + '</td>';
          // Column 0 is the identifier, and the money column is right-aligned
          // numerals — same treatment the mock gives its own tables.
          if(i === 0) return '<td><span class="ref">' + esc(c) + '</span></td>';
          if(i === 2) return '<td><span class="num" style="font-weight:600">' + esc(c) + '</span></td>';
          return '<td>' + esc(c) + '</td>';
        }).join('');
        return '<tr>' + tds + '</tr>';
      }).join('');
      return '<div class="tablecard card" style="margin-top:4px"><table class="data">'
        + '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    function drillEmpty(msg){
      return '<div class="kpi-empty"><div class="ei"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor">'
        + '<path d="M20 6L9 17l-5-5"/></svg></div><b>All clear</b><p>' + esc(msg) + '</p></div>';
    }
    var openId = null;
    window.openKpi = function(id, opts){
      opts = opts || {};
      var d = DRILL[id];
      if(!d) return;
      openId = id;
      document.getElementById('kpiTitle').textContent = d.title || id;
      var chip = document.getElementById('kpiChip');
      chip.className = 'status ' + d.chip;
      chip.textContent = d.chipText;
      document.getElementById('kpiMeta').innerHTML = d.meta.map(function(m){ return '<span>' + m + '</span>'; }).join('');
      document.getElementById('kpiCta').innerHTML = esc(d.cta);
      document.getElementById('kpiBody').innerHTML = d.rows.length ? drillTable(d) : drillEmpty(d.empty);
      document.getElementById('kpiScrim').classList.add('show');
      // Keep the mock's deep-link behaviour so its closeKpi()/popstate still match.
      if(!opts.fromHash && location.hash !== '#kpi=' + id){
        history.pushState({ kpi: id }, '', '#kpi=' + id);
      }
      if(typeof setupKpiKeyboard === 'function') setupKpiKeyboard();
    };
    // The CTA leaves the mock entirely: ask the parent app to route. We send only
    // the card id — the parent owns the id→route map, so the iframe can't drive
    // navigation to an arbitrary path.
    window.kpiGoto = function(){
      var id = openId;
      if(typeof closeKpi === 'function') closeKpi();
      try { window.parent.postMessage({ type: 'praxis-kpi-nav', id: id }, '*'); } catch(e){}
    };
  } catch(e){ /* drill-downs are additive — never block the tower */ }

  // Track the app's light/dark theme (parent uses a .dark class; mock uses data-theme).
  function syncTheme(){
    try {
      var dark = window.parent.document.documentElement.classList.contains('dark');
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    } catch(e){}
  }
  syncTheme();
  try { new MutationObserver(syncTheme).observe(window.parent.document.documentElement, { attributes:true, attributeFilter:['class'] }); } catch(e){}
})();
`;
}

/** CSS that hides the mock's own app chrome so it sits inside the real app shell. */
const HIDE_CHROME = `
  .testban, header.topbar, .botnav, .drawer, .drawer-scrim { display: none !important; }
  html, body { background: transparent; }
  .app { min-height: auto; }
  .scroll { padding-top: 8px; height: auto; overflow: visible; }
`;

function buildSrcDoc(live: LiveData | null): string {
  const inject = live ? `<script>${liveInjectionScript(live)}</script>` : "";
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8" />
<style>${mockStyle}\n${HIDE_CHROME}</style></head>
<body>${mockBody}
<script>${mockScript}</script>
${inject}
</body></html>`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [live, setLive] = React.useState<LiveData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // The KPI modal's CTA asks the parent to route. The iframe sends a card id only;
  // the id→route map lives here, so it can't navigate to an arbitrary path.
  React.useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { type?: string; id?: string } | null;
      if (!d || d.type !== "praxis-kpi-nav") return;
      const to = d.id ? KPI_ROUTE[d.id] : null;
      if (to) navigate(to);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      tenant<Row>("/dashboard/control-tower").catch(() => ({}) as Row),
      tenant<Row>("/dashboard/kpis").catch(() => ({}) as Row),
      // Past-due receivables, invoice-level and net of receipts. Feeds BOTH the
      // KPI card and its drill-down so the two always agree (MOD-52, gated
      // `accounting.core`) → null when off, card hides.
      tenant<OverduePayload>("/receivables/overdue").catch(() => null),
      // Drill-down sources. Each is a list the user may or may not be entitled to
      // read — a 403 yields null and that card's detail shows its empty state.
      tenant<Row[]>("/final-invoices").catch(() => null),
      tenant<Row[]>("/clients").catch(() => null),
      tenant<Row[]>("/operations").catch(() => null),
      tenant<Row[]>("/vehicles").catch(() => null),
    ])
      .then(([ct, kpis, overdue, invoices, clients, dossiers, vehicles]) => {
        if (!alive) return;
        const rawShips = Array.isArray(ct.live_shipments) ? (ct.live_shipments as Row[]) : [];
        const shipments = rawShips.map(toLiveShipment);
        const of = (ct.operation_files as Row) || {};
        const active = Number(of.active ?? of.open ?? shipments.length) || shipments.length;
        const approvals = Number(ct.approvals_awaiting ?? kpis.approvals_awaiting ?? 0) || 0;
        const flags = Number(kpis.open_compliance_flags ?? kpis.compliance_flags ?? 0) || 0;
        const unposted = Number(kpis.unposted_journals ?? 0) || 0;
        const heroSub =
          `${active} operation file${active === 1 ? "" : "s"} in motion` +
          (approvals ? ` — ${approvals} awaiting your approval.` : ".");
        const briefing =
          `<b>${active}</b> active operation file${active === 1 ? "" : "s"}` +
          (approvals ? `, <b>${approvals}</b> awaiting approval` : "") +
          (flags ? `, <b>${flags}</b> open compliance flag${flags === 1 ? "" : "s"}` : "") +
          (unposted ? `, <b>${unposted}</b> unposted journal${unposted === 1 ? "" : "s"}` : "") +
          ". Live from the Control Tower.";
        const cur = str(kpis.revenue_currency || "XAF");
        const clientName: Record<string, string> = {};
        (clients || []).forEach((c) => { clientName[str(c.client_id)] = str(c.name); });

        setLive({
          shipments,
          activeCount: active,
          heroSub,
          briefing,
          kpi: {
            revenue: numOrNull(kpis.revenue_final_ttc),
            revenueCur: cur,
            sla: numOrNull(kpis.sla_on_time_pct),
            fleetActive: numOrNull(kpis.fleet_active),
            fleetTotal: numOrNull(kpis.fleet_total),
            overdue: overdue ? numOrNull(overdue.total) : null,
          },
          drill: {
            revenue: buildRevenueDrill(invoices, clientName, cur),
            sla: buildSlaDrill(dossiers),
            overdue: buildOverdueDrill(overdue, clientName, cur),
            fleet: buildFleetDrill(vehicles),
          },
        });
      })
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const srcDoc = React.useMemo(() => buildSrcDoc(live), [live]);

  if (loading) return <LoadingRow label="Loading Control Tower…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <iframe
      title="Control Tower"
      srcDoc={srcDoc}
      className="h-[calc(100vh-7rem)] w-full border-0"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
