/**
 * Vault & compliance — the hub shell, mirroring FinanceHub: a document/compliance
 * posture overview at /vault, and every vault screen as a tab at /vault/<section>.
 *
 * The five pages themselves are unchanged (features/vault/pages.tsx) — this only
 * wraps them, so the old standalone routes (/vault/documents, /vault/reports, …)
 * keep resolving as hub sections and no bookmark or ⌘K hit breaks.
 *
 * Two sections are feature-gated server-side: Reports needs `reporting` and
 * Signatures needs `signatures`. The overview degrades quietly when either is off
 * (a 403 becomes a dash, never an error banner) — the pages themselves already
 * render a proper "enable it" state.
 */
import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { DocumentsPage, SignaturesPage, VerificationPage, ComplianceFlagsPage, ReportsPage } from "./pages";

const shell = "mx-auto max-w-6xl animate-fade-in";

type TabDef = { slug: string; label: string; Component: React.ComponentType };

const TABS: TabDef[] = [
  { slug: "documents", label: "Documents", Component: DocumentsPage },
  { slug: "signatures", label: "Signatures", Component: SignaturesPage },
  { slug: "verification", label: "Verification", Component: VerificationPage },
  { slug: "compliance-flags", label: "Compliance flags", Component: ComplianceFlagsPage },
  { slug: "reports", label: "Reports", Component: ReportsPage },
];

const BY_SLUG: Record<string, TabDef> = Object.fromEntries(TABS.map((t) => [t.slug, t]));

type Doc = { doc_id: string; doc_type?: string | null; status?: string | null; entity_ref?: string | null; created_at?: string | null };
type Flag = { flag_id: string; rule_key: string; severity?: string | null; message?: string | null; resolved_at?: string | null; created_at?: string | null };

const sevTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "RED") return "bad";
  if (u === "WARN") return "warn";
  return "blue";
};
const docTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "VERIFIED") return "ok";
  if (u === "REJECTED") return "bad";
  if (u === "ARCHIVED") return "mute";
  return "warn";
};

function HubTabBar({ active }: { active: string | null }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto mb-4 max-w-6xl">
      <div className="micro mb-2">Hub › Vault &amp; compliance</div>
      <div aria-label="Vault sections" className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted p-1">
        <button
          onClick={() => navigate("/vault")}
          className={
            active === null
              ? "whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
              : "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          }
        >
          Overview
        </button>
        {TABS.map((t) => (
          <button
            key={t.slug}
            onClick={() => navigate(`/vault/${t.slug}`)}
            className={
              active === t.slug
                ? "whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
                : "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <div className="micro uppercase tracking-wide">{subtitle}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Overview() {
  const navigate = useNavigate();
  const docs = useList<Doc>("/documents");
  const flags = useList<Flag>("/compliance");

  const allDocs = docs.rows || [];
  const allFlags = flags.rows || [];
  const open = allFlags.filter((f) => !f.resolved_at);
  const red = open.filter((f) => String(f.severity || "").toUpperCase() === "RED").length;
  const warn = open.filter((f) => String(f.severity || "").toUpperCase() === "WARN").length;
  const info = open.length - red - warn;
  const pending = allDocs.filter((d) => String(d.status || "").toUpperCase() === "PENDING").length;
  const verified = allDocs.filter((d) => String(d.status || "").toUpperCase() === "VERIFIED").length;

  // Only surface an error if BOTH reads failed — a single gated module shouldn't
  // make the whole overview look broken.
  const bothFailed = !!docs.error && !!flags.error;

  return (
    <section className={shell}>
      <header className="mb-5 border-b border-border pb-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Vault &amp; compliance</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every document carries a SHA-256 content hash, so a stored file can be re-checked against its DNA at any time. Compliance rules
          run over the same corpus and raise flags for anything missing or aged.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.slug}
                onClick={() => navigate(`/vault/${t.slug}`)}
                className="rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button onClick={() => navigate("/vault/documents")}>Upload document</Button>
        </div>
      </header>

      {bothFailed && (
        <div className="mb-5 rounded-xl border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn)/0.08)] px-4 py-3 text-sm">
          Vault reads are unavailable — you may not have the document or compliance grant on this tenant.
        </div>
      )}

      <KpiRow>
        <KpiTile label="Documents" value={docs.error ? "—" : num(allDocs.length)} hint={docs.error ? "No access" : `${verified} verified`} />
        <KpiTile label="Awaiting verification" value={docs.error ? "—" : num(pending)} hint="Status PENDING" />
        <KpiTile label="Open flags" value={flags.error ? "—" : num(open.length)} hint={flags.error ? "No access" : `${red} red · ${warn} warn`} />
        <KpiTile label="Resolved flags" value={flags.error ? "—" : num(allFlags.length - open.length)} hint="Cleared by a reviewer" />
      </KpiRow>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel
          title="Open compliance flags"
          subtitle="Highest severity first"
          action={<Button size="sm" variant="outline" onClick={() => navigate("/vault/compliance-flags")}>Review</Button>}
        >
          {flags.error ? (
            <span className="micro">Compliance flags aren't readable with your current grants.</span>
          ) : open.length === 0 ? (
            <span className="micro">Nothing open — every rule that ran came back clean.</span>
          ) : (
            <>
              <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-[rgb(var(--ink-3)/0.15)]">
                <span style={{ width: `${(red / open.length) * 100}%`, background: "rgb(var(--bad))" }} />
                <span style={{ width: `${(warn / open.length) * 100}%`, background: "rgb(var(--warn))" }} />
                {/* --info is a raw hex with no consumer (lib/theme.ts), not an "R G B"
                    triplet, so it can't go through rgb(var(…)). --ink-3 is the muted
                    triplet index.css actually defines. */}
                <span style={{ width: `${(info / open.length) * 100}%`, background: "rgb(var(--ink-3))" }} />
              </div>
              <ul className="space-y-2 text-sm">
                {[...open]
                  .sort((a, b) => {
                    const rank = (s?: string | null) => (String(s).toUpperCase() === "RED" ? 0 : String(s).toUpperCase() === "WARN" ? 1 : 2);
                    return rank(a.severity) - rank(b.severity);
                  })
                  .slice(0, 5)
                  .map((f) => (
                    <li key={f.flag_id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                      <span className="flex min-w-0 items-start gap-2">
                        <Pill tone={sevTone(f.severity)}>{f.severity || "INFO"}</Pill>
                        <span className="min-w-0">
                          <span className="num block truncate text-foreground">{f.rule_key}</span>
                          {f.message && <span className="micro block truncate">{f.message}</span>}
                        </span>
                      </span>
                      <span className="num shrink-0 text-muted-foreground">{dateFmt(f.created_at)}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel
          title="Recent documents"
          subtitle="Newest uploads into the vault"
          action={<Button size="sm" variant="outline" onClick={() => navigate("/vault/documents")}>Open vault</Button>}
        >
          {docs.error ? (
            <span className="micro">The document vault isn't readable with your current grants.</span>
          ) : allDocs.length === 0 ? (
            <span className="micro">Nothing uploaded yet.</span>
          ) : (
            <ul className="space-y-2 text-sm">
              {allDocs.slice(0, 6).map((d) => (
                <li key={d.doc_id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone={docTone(d.status)}>{d.status || "PENDING"}</Pill>
                    <span className="min-w-0 truncate">
                      <span className="text-foreground">{d.doc_type || "Document"}</span>
                      {d.entity_ref && <span className="num text-muted-foreground"> · {d.entity_ref}</span>}
                    </span>
                  </span>
                  <span className="num shrink-0 text-muted-foreground">{dateFmt(d.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Verify a document"
        subtitle="Hash lookup — tamper check against the stored DNA"
        action={<Button size="sm" variant="outline" onClick={() => navigate("/vault/verification")}>Open</Button>}
      >
        <p className="text-sm text-muted-foreground">
          Paste a content hash from a printed QR code to confirm the file in hand matches what the vault stored. The scan endpoint is public,
          so a counterparty can check a document without an account.
        </p>
      </Panel>
    </section>
  );
}

export function VaultHub() {
  const { section } = useParams();
  const tab = section ? BY_SLUG[section] : null;
  const active = tab ? tab.slug : null;
  const Active = tab?.Component;

  return (
    <div className="animate-fade-in">
      <HubTabBar active={active} />
      {Active ? <div key={active}><Active /></div> : <Overview />}
    </div>
  );
}
