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
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import { Panel } from "@/components/ui/panel";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { TabbedHub, HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, type Row } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, dateFmt } from "@/lib/format";
import { ReportsPage } from "./reports";
import { ComplianceFlagsPage } from "./compliance-flags";
import { DocumentsPage } from "./documents";
import { SignaturesPage } from "./signatures";
import { ReconciliationPage } from "./reconciliation";

const shell = pageShell.wide;

type Doc = {
  doc_id: string;
  doc_type?: string | null;
  status?: string | null;
  entity_ref?: string | null;
  created_at?: string | null;
};
type Flag = {
  flag_id: string;
  rule_key: string;
  severity?: string | null;
  message?: string | null;
  resolved_at?: string | null;
  created_at?: string | null;
};

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

/** Signatures whose document has changed since, summed over the doc types. */
function staleCount(stats: Row | null | undefined): number {
  const rows = (stats?.stale_by_doc_type as { n?: number }[] | undefined) ?? [];
  return rows.reduce((total, row) => total + Number(row.n ?? 0), 0);
}

function Overview() {
  const navigate = useNavigate();
  const docs = useList<Doc>("/documents");
  const flags = useList<Flag>("/compliance");
  /*
   * §5.6 — signature telemetry, thin and on purpose. It exists so a broken OTP
   * path or a portal nobody can reach shows up as a metric before it shows up
   * as a support ticket. `useResource`, not `useList`: /signatures/stats returns
   * one aggregate object, not a collection.
   */
  const sigStats = useResource<Row>(() => tenant<Row>("/signatures/stats"), []);

  const allDocs = docs.rows || [];
  const allFlags = flags.rows || [];
  const open = allFlags.filter((f) => !f.resolved_at);
  const red = open.filter(
    (f) => String(f.severity || "").toUpperCase() === "RED",
  ).length;
  const warn = open.filter(
    (f) => String(f.severity || "").toUpperCase() === "WARN",
  ).length;
  const info = open.length - red - warn;
  const pending = allDocs.filter(
    (d) => String(d.status || "").toUpperCase() === "PENDING",
  ).length;
  const verified = allDocs.filter(
    (d) => String(d.status || "").toUpperCase() === "VERIFIED",
  ).length;

  // Only surface an error if BOTH reads failed — a single gated module shouldn't
  // make the whole overview look broken.
  const bothFailed = !!docs.error && !!flags.error;

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Vault & compliance" to="/vault" />}
        title="Vault & compliance"
        description="Every document carries a SHA-256 content hash, so a stored file can be re-checked against its DNA at any time. Compliance rules run over the same corpus and raise flags for anything missing or aged."
        action={
          <Button onClick={() => navigate("/vault/documents")}>
            Upload document
          </Button>
        }
      />
      <HubTabs />

      {bothFailed && (
        <div className="mb-5 rounded-xl border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn)/0.08)] px-4 py-3 text-sm">
          Vault reads are unavailable — you may not have the document or
          compliance grant on this tenant.
        </div>
      )}

      <KpiRow>
        <KpiTile
          label={tr("Documents")}
          value={docs.error ? "—" : num(allDocs.length)}
          hint={docs.error ? "No access" : `${verified} verified`}
        />
        <KpiTile
          label="Awaiting verification"
          value={docs.error ? "—" : num(pending)}
          hint="Status PENDING"
        />
        <KpiTile
          label="Open flags"
          value={flags.error ? "—" : num(open.length)}
          hint={flags.error ? "No access" : `${red} red · ${warn} warn`}
        />
        <KpiTile
          label="Resolved flags"
          value={flags.error ? "—" : num(allFlags.length - open.length)}
          hint="Cleared by a reviewer"
        />
      </KpiRow>

      {/* Signatures, one row. Rendered even when the read fails (a tenant
          without the grant, or with the module off) — the tiles show "—" rather
          than the row vanishing, so nobody concludes the feature does not
          exist. */}
      <KpiRow>
        <KpiTile
          label="Signatures"
          value={sigStats.error ? "—" : num(Number(sigStats.data?.total ?? 0))}
          hint={
            sigStats.error
              ? "No access"
              : `${Number(sigStats.data?.last_30d ?? 0)} in the last 30 days`
          }
        />
        <KpiTile
          label="Revoked"
          value={sigStats.error ? "—" : num(Number(sigStats.data?.revoked ?? 0))}
          hint="Withdrawn after signing"
        />
        <KpiTile
          label="No longer covering"
          value={sigStats.error ? "—" : num(staleCount(sigStats.data))}
          hint="Document changed after signing"
        />
        <KpiTile
          label="Verifications"
          value={sigStats.error ? "—" : num(Number(sigStats.data?.scans_30d ?? 0))}
          hint={
            sigStats.error
              ? "No access"
              : `${Number(sigStats.data?.new_ip_scans_30d ?? 0)} from a new network`
          }
        />
      </KpiRow>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel
          title="Open compliance flags"
          subtitle="Highest severity first"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/vault/compliance-flags")}
            >
              Review
            </Button>
          }
        >
          {flags.error ? (
            <span className="micro">
              Compliance flags aren't readable with your current grants.
            </span>
          ) : open.length === 0 ? (
            <span className="micro">
              Nothing open — every rule that ran came back clean.
            </span>
          ) : (
            <>
              <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-[rgb(var(--ink-3)/0.15)]">
                <span
                  style={{
                    width: `${(red / open.length) * 100}%`,
                    background: "rgb(var(--bad))",
                  }}
                />
                <span
                  style={{
                    width: `${(warn / open.length) * 100}%`,
                    background: "rgb(var(--warn))",
                  }}
                />
                {/* --info is a raw hex with no consumer (lib/theme.ts), not an "R G B"
                    triplet, so it can't go through rgb(var(…)). --ink-3 is the muted
                    triplet index.css actually defines. */}
                <span
                  style={{
                    width: `${(info / open.length) * 100}%`,
                    background: "rgb(var(--ink-3))",
                  }}
                />
              </div>
              <ul className="space-y-2 text-sm">
                {[...open]
                  .sort((a, b) => {
                    const rank = (s?: string | null) =>
                      String(s).toUpperCase() === "RED"
                        ? 0
                        : String(s).toUpperCase() === "WARN"
                          ? 1
                          : 2;
                    return rank(a.severity) - rank(b.severity);
                  })
                  .slice(0, 5)
                  .map((f) => (
                    <li
                      key={f.flag_id}
                      className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <Pill tone={sevTone(f.severity)}>
                          {f.severity || "INFO"}
                        </Pill>
                        <span className="min-w-0">
                          <span className="num block truncate text-foreground">
                            {f.rule_key}
                          </span>
                          {f.message && (
                            <span className="micro block truncate">
                              {f.message}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="num shrink-0 text-muted-foreground">
                        {dateFmt(f.created_at)}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel
          title="Recent documents"
          subtitle="Newest uploads into the vault"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/vault/documents")}
            >
              Open vault
            </Button>
          }
        >
          {docs.error ? (
            <span className="micro">
              The document vault isn't readable with your current grants.
            </span>
          ) : allDocs.length === 0 ? (
            <span className="micro">Nothing uploaded yet.</span>
          ) : (
            <ul className="space-y-2 text-sm">
              {allDocs.slice(0, 6).map((d) => (
                <li
                  key={d.doc_id}
                  className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone={docTone(d.status)}>
                      {d.status || "PENDING"}
                    </Pill>
                    <span className="min-w-0 truncate">
                      <span className="text-foreground">
                        {d.doc_type || "Document"}
                      </span>
                      {d.entity_ref && (
                        <span className="num text-muted-foreground">
                          {" "}
                          · {d.entity_ref}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="num shrink-0 text-muted-foreground">
                    {dateFmt(d.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Replaced the "paste a hash" screen (guide §5.7, addition i). That
          screen asked an operator to type a fingerprint into a box and told
          them whether it matched — a mechanism this programme removes, and one
          that never answered a question anybody had. The question people do
          have is whether the counterparty ever checked the document, and that
          lives on the signature itself now. */}
      <Panel
        title="Verification portal"
        subtitle="What a counterparty sees when they scan a document"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open("/verify", "_blank", "noopener")}
          >
            Open
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Every signed document is printed with a QR code and a twelve-character
          code beneath it. Anyone holding the paper can check it without an
          account — the page shows what was signed, by whom, and whether the
          record has changed since. Who has checked a given document is on the
          signature itself.
        </p>
      </Panel>
    </section>
  );
}

const TABS = hubTabs("/vault", {
  overview: Overview,
  documents: DocumentsPage,
  signatures: SignaturesPage,
  reconciliation: ReconciliationPage,
  "compliance-flags": ComplianceFlagsPage,
  reports: ReportsPage,
});

export function VaultHub() {
  return (
    <TabbedHub eyebrow="Vault & compliance" basePath="/vault" tabs={TABS} />
  );
}
