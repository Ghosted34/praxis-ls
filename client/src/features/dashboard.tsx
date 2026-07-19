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
 * Past-due receivables from the `receivables_ageing` report: every bucket except
 * `current`. The report wraps its payload as { report_key, params, data }. Returns
 * null when the report is unavailable (feature `reporting` off / no permission),
 * so the KPI card hides rather than showing a misleading zero.
 */
function overdueTotal(ageing: Row | null): number | null {
  const d = (ageing && (ageing.data as Row)) || null;
  if (!d) return null;
  const buckets = ["d1_30", "d31_60", "d61_90", "d90_plus"];
  if (!buckets.some((k) => d[k] !== undefined)) return null;
  return buckets.reduce((sum, k) => sum + (Number(d[k]) || 0), 0);
}

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
  const [live, setLive] = React.useState<LiveData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      tenant<Row>("/dashboard/control-tower").catch(() => ({}) as Row),
      tenant<Row>("/dashboard/kpis").catch(() => ({}) as Row),
      // Receivables-overdue has no dashboard aggregate; derive it from the existing
      // report producer. Feature-gated `reporting` → null when off, card hides.
      tenant<Row>("/reports/run/receivables_ageing").catch(() => null),
    ])
      .then(([ct, kpis, ageing]) => {
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
        setLive({
          shipments,
          activeCount: active,
          heroSub,
          briefing,
          kpi: {
            revenue: numOrNull(kpis.revenue_final_ttc),
            revenueCur: str(kpis.revenue_currency || "XAF"),
            sla: numOrNull(kpis.sla_on_time_pct),
            fleetActive: numOrNull(kpis.fleet_active),
            fleetTotal: numOrNull(kpis.fleet_total),
            overdue: overdueTotal(ageing),
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
