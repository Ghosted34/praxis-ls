import { useState } from "react";
import {
  ops, ago, fmtBytes, fmtDuration, canOperate,
  type BackupStatus, type BackupRun, type DrillsResult, type ObjectStatus, type BackupPreflight,
  type WalStatus,
} from "@/lib/ops-api";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, ConfirmModal, Empty, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { OpsNav } from "./OpsNav";

/**
 * WS-B1 / B2 / B3 / B4 — backup freshness, the run log, object sync and the
 * restore drill record.
 *
 * The organising claim from §3.2 is that a dump nobody has restored is not a
 * recovery plan, it is an untested assertion about a file. So the drill panel is
 * not tucked away at the bottom — "never drilled" is surfaced as a headline
 * number next to "never backed up", because a tenant with perfect nightly dumps
 * and no successful restore is in a worse position than the dashboard would
 * otherwise suggest.
 */
export function OpsBackups() {
  const { toast, fail } = useToast();
  const status = useAsync<BackupStatus>(() => ops.backupStatus());
  const runs = useAsync<BackupRun[]>(() => ops.backupRuns({ limit: 60 }));
  const drills = useAsync<DrillsResult>(() => ops.drills(25));
  const objects = useAsync<ObjectStatus[]>(() => ops.objectStatus());
  const wal = useAsync<WalStatus>(() => ops.walStatus());

  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; run: () => Promise<unknown> }>(null);
  const [preflight, setPreflight] = useState<BackupPreflight | null>(null);
  const [drillDetail, setDrillDetail] = useState<DrillsResult["drills"][number] | null>(null);

  const act = (label: string, p: Promise<unknown>, done: string, reload?: () => void) => {
    setBusy(label);
    p.then(() => { toast(done); reload?.(); })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const checkTools = () => {
    setBusy("preflight");
    ops.backupPreflight()
      .then((r) => { setPreflight(r); if (!r.ok) toast("Preflight failed — see details"); })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const s = status.data;
  const d = drills.data;

  return (
    <>
      <PageHeader
        title="Backup & restore"
        desc="Per-tenant dump freshness, the run log, object sync, and the rehearsed restore that makes them real."
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="ghost" loading={busy === "preflight"} onClick={checkTools}>Check tooling</Button>
            {canOperate() && (
              <>
                <Button
                  size="sm"
                  loading={busy === "drill"}
                  onClick={() => setConfirm({
                    title: "Run a restore drill?",
                    body: "Restores the least-recently-drilled tenant into a scratch database, verifies it, records the measured RTO, then drops the scratch copy. This is real work on the Postgres host and can take minutes.",
                    run: () => ops.drillScheduled(),
                  })}
                >
                  Run drill
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === "fleet"}
                  onClick={() => setConfirm({
                    title: "Back up every tenant now?",
                    body: "Runs pg_dump for every LIVE tenant to offsite storage. Parallel dumps multiply I/O on a shared Postgres host — this is the nightly job, run by hand.",
                    run: () => ops.backupFleet(),
                  })}
                >
                  Back up fleet
                </Button>
              </>
            )}
          </div>
        }
      />
      <OpsNav />

      {status.loading ? (
        <Loading />
      ) : status.error ? (
        <Empty>Couldn’t load backup status — {status.error.message}</Empty>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <Stat n={s?.tenants.length || 0} l="Tenants" />
            <Stat n={s?.stale_count || 0} l={`Stale (>${s?.rpo_hours ?? 24}h)`} tone={s?.stale_count ? "bad" : "ok"} />
            <Stat n={s?.never_count || 0} l="Never backed up" tone={s?.never_count ? "bad" : "ok"} />
            <Stat n={d?.never_drilled.length || 0} l="Never drilled" tone={d?.never_drilled.length ? "warn" : "ok"} />
          </div>

          {(s?.never_count || 0) > 0 && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              {s?.never_count} tenant{s?.never_count === 1 ? "" : "s"} have never been backed up. Until a dump
              exists there is nothing to restore from — this is the highest-priority row on the page.
            </div>
          )}
          {(d?.never_drilled.length || 0) > 0 && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              Never drilled: <span className="mono">{d?.never_drilled.join(", ")}</span>. Dumps for these tenants
              have never been proven restorable.
            </div>
          )}

          {/* Recovery point — the RPO that actually holds ------------------- */}
          <Card title="Recovery point" style={{ marginBottom: 16 }}>
            {wal.loading ? (
              <Loading />
            ) : !wal.data ? (
              <div className="muted" style={{ fontSize: 13 }}>Couldn’t read the WAL archive state.</div>
            ) : !wal.data.enabled ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <Pill tone="warn">24h recovery point</Pill>
                  <span className="muted" style={{ fontSize: 12.5 }}>WAL archiving is off</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {wal.data.note ||
                    "Recovery is limited to the nightly dump. Lose the host late in the day and you lose the day."}
                  {" "}Set <span className="mono">WAL_ARCHIVE_ENABLED=true</span> and{" "}
                  <span className="mono">WAL_ARCHIVE_MODE=on</span> to bring this down to minutes.
                </div>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <Pill tone={wal.data.healthy ? "ok" : "bad"}>
                    {wal.data.rpo_minutes >= 60
                      ? `${Math.round(wal.data.rpo_minutes / 60)}h recovery point`
                      : `${wal.data.rpo_minutes}m recovery point`}
                  </Pill>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {wal.data.segments} segment{wal.data.segments === 1 ? "" : "s"} archived
                    {wal.data.newest_at ? ` · newest ${ago(wal.data.newest_at)}` : ""}
                  </span>
                </div>
                {!wal.data.healthy && (
                  <div className="banner warn">
                    {wal.data.error}
                    {" "}Until this is fixed the real recovery point is the last nightly dump, not minutes —
                    which is the assurance most worth not being wrong about.
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Per-tenant freshness ------------------------------------------- */}
          <Card title="Dump freshness" actions={<span className="muted" style={{ fontSize: 12 }}>RPO target {s?.rpo_hours ?? 24}h</span>}>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr><th>Tenant</th><th>Last good dump</th><th>Age</th><th>Size</th><th>Last failure</th><th></th></tr>
                </thead>
                <tbody>
                  {(s?.tenants || []).slice().sort((a, b) => Number(b.stale) - Number(a.stale) || a.slug.localeCompare(b.slug)).map((t) => (
                    <tr key={t.tenant_id}>
                      <td className="mono">{t.slug}</td>
                      <td>
                        {t.never_backed_up
                          ? <Pill tone="bad">never</Pill>
                          : <span className="muted">{fmtDateTime(t.last_ok_at)}</span>}
                      </td>
                      <td>
                        {t.age_hours === null ? "—"
                          : t.stale ? <Pill tone="bad">{t.age_hours}h</Pill>
                          : <span className="muted">{t.age_hours}h</span>}
                      </td>
                      <td className="muted">{fmtBytes(t.last_ok_bytes)}</td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>
                        {t.last_failure_at ? (
                          <span title={t.last_error || ""}>
                            <Pill tone="warn">{ago(t.last_failure_at)}</Pill>{" "}
                            {(t.last_error || "").slice(0, 60)}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {canOperate() && (
                          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                            <Button size="sm" variant="ghost" loading={busy === `b:${t.slug}`}
                              onClick={() => act(`b:${t.slug}`, ops.backupTenant(t.slug), `Backup queued for ${t.slug}`, status.reload)}>
                              Back up
                            </Button>
                            <Button size="sm" variant="ghost" loading={busy === `d:${t.slug}`}
                              onClick={() => setConfirm({
                                title: `Drill ${t.slug}?`,
                                body: "Restores this tenant's latest dump into a scratch database, runs integrity probes, records the RTO, then drops the copy. The live tenant database is never touched.",
                                run: () => ops.drillTenant(t.slug),
                              })}>
                              Drill
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Restore drills -------------------------------------------------- */}
          <Card
            title="Restore drills"
            style={{ marginTop: 16 }}
            actions={<span className="muted" style={{ fontSize: 12 }}>RTO target {fmtDuration(d?.rto_target_seconds)}</span>}
          >
            {drills.loading ? <Loading /> : (d?.drills.length || 0) === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No drill has ever run. Until one does, the backups are an untested assertion.
              </div>
            ) : (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>When</th><th>Tenant</th><th>Result</th><th>RTO</th><th>Restored to</th><th></th></tr></thead>
                  <tbody>
                    {(d?.drills || []).map((r) => {
                      const over = r.rto_seconds != null && d?.rto_target_seconds != null && r.rto_seconds > d.rto_target_seconds;
                      return (
                        <tr key={r.restore_drill_id}>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.ran_at)}</td>
                          <td className="mono">{r.slug || "—"}</td>
                          <td>{r.ok ? <Pill tone="ok">passed</Pill> : <Pill tone="bad">failed</Pill>}</td>
                          <td>{over ? <Pill tone="warn">{fmtDuration(r.rto_seconds)}</Pill> : <span className="muted">{fmtDuration(r.rto_seconds)}</span>}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.restored_to)}</td>
                          <td style={{ textAlign: "right" }}>
                            <Button size="sm" variant="ghost" onClick={() => setDrillDetail(r)}>Checks</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Object storage --------------------------------------------------- */}
          <Card title="Object storage (vault, branding, media)" style={{ marginTop: 16 }}>
            {objects.loading ? <Loading /> : (objects.data || []).length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No object sync has run yet.</div>
            ) : (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Tenant</th><th>Last sync</th><th>Last integrity scan</th><th></th></tr></thead>
                  <tbody>
                    {(objects.data || []).map((o) => (
                      <tr key={o.slug}>
                        <td className="mono">{o.slug}</td>
                        <td>
                          {o.last_sync_at
                            ? <span className="muted">{ago(o.last_sync_at)} {o.last_sync_status === "FAILED" && <Pill tone="bad">failed</Pill>}</span>
                            : <Pill tone="warn">never</Pill>}
                        </td>
                        <td>
                          {o.last_scan_at ? (
                            <span className="muted" title={o.last_scan_error || ""}>
                              {ago(o.last_scan_at)} {o.last_scan_status === "FAILED" && <Pill tone="bad">issues</Pill>}
                            </span>
                          ) : <Pill tone="warn">never</Pill>}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {canOperate() && (
                            <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                              <Button size="sm" variant="ghost" loading={busy === `s:${o.slug}`}
                                onClick={() => act(`s:${o.slug}`, ops.syncObjects(o.slug), `Object sync queued for ${o.slug}`, objects.reload)}>
                                Sync
                              </Button>
                              <Button size="sm" variant="ghost" loading={busy === `c:${o.slug}`}
                                onClick={() => act(`c:${o.slug}`, ops.scanObjects(o.slug), `Integrity scan queued for ${o.slug}`, objects.reload)}>
                                Scan
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Run log ---------------------------------------------------------- */}
          <Card
            title="Run log"
            style={{ marginTop: 16 }}
            actions={
              canOperate() ? (
                <Button size="sm" variant="ghost" loading={busy === "prune"}
                  onClick={() => act("prune", ops.pruneBackups(), "Retention applied", runs.reload)}>
                  Apply retention
                </Button>
              ) : undefined
            }
          >
            {runs.loading ? <Loading /> : (runs.data || []).length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>Nothing recorded yet.</div>
            ) : (
              <div className="tbl-wrap" style={{ maxHeight: 380, overflow: "auto" }}>
                <table>
                  <thead><tr><th>Started</th><th>Kind</th><th>Tenant</th><th>Result</th><th>Size</th><th>Took</th><th>Error</th></tr></thead>
                  <tbody>
                    {(runs.data || []).map((r) => (
                      <tr key={r.backup_run_id}>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.started_at)}</td>
                        <td><Pill tone="mute">{r.kind.replace("_", " ").toLowerCase()}</Pill></td>
                        <td className="mono">{r.slug || <span className="muted">fleet</span>}</td>
                        <td>{r.status === "OK" ? <Pill tone="ok">ok</Pill> : <Pill tone="bad">failed</Pill>}</td>
                        <td className="muted">{fmtBytes(r.bytes)}</td>
                        <td className="muted">{r.duration_ms != null ? fmtDuration(r.duration_ms / 1000) : "—"}</td>
                        <td className="muted" style={{ fontSize: 12, maxWidth: 300 }} title={r.error || ""}>
                          {(r.error || "").slice(0, 80) || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel="Run it"
          onConfirm={() =>
            confirm.run()
              .then(() => { toast("Started — results will appear here when it finishes"); status.reload(); drills.reload(); runs.reload(); })
              .catch(fail)
          }
          onClose={() => setConfirm(null)}
        />
      )}

      {preflight && (
        <Modal title="Backup tooling" onClose={() => setPreflight(null)} maxWidth={520}>
          <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
            <dt>Overall</dt><dd>{preflight.ok ? <Pill tone="ok">ready</Pill> : <Pill tone="bad">not ready</Pill>}</dd>
            <dt>pg_dump</dt><dd className="mono">{preflight.pg_dump || "—"}</dd>
            <dt>pg_restore</dt><dd className="mono">{preflight.pg_restore || "—"}</dd>
            <dt>Server</dt><dd className="mono">{preflight.server || "—"}</dd>
          </dl>
          {preflight.error && (
            <div className="banner warn" style={{ marginTop: 12 }}>{preflight.error}</div>
          )}
        </Modal>
      )}

      {drillDetail && (
        <Modal
          title={<span className="row" style={{ gap: 8 }}><span className="mono">{drillDetail.slug}</span> drill checks</span>}
          onClose={() => setDrillDetail(null)}
          maxWidth={620}
        >
          <dl className="kv" style={{ gridTemplateColumns: "120px 1fr", marginBottom: 12 }}>
            <dt>Result</dt><dd>{drillDetail.ok ? <Pill tone="ok">passed</Pill> : <Pill tone="bad">failed</Pill>}</dd>
            <dt>Measured RTO</dt><dd>{fmtDuration(drillDetail.rto_seconds)}</dd>
            <dt>Ran at</dt><dd>{fmtDateTime(drillDetail.ran_at)}</dd>
            <dt>Restored to</dt><dd>{fmtDateTime(drillDetail.restored_to)}</dd>
          </dl>
          {drillDetail.error && <div className="banner warn" style={{ marginBottom: 12 }}>{drillDetail.error}</div>}
          <div className="f" style={{ marginBottom: 4 }}>Integrity probes</div>
          <pre className="mono" style={{ fontSize: 11.5, margin: 0, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", overflow: "auto", maxHeight: 300 }}>
            {JSON.stringify(drillDetail.checks_json, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "bad" | "warn" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--ink)";
  return (
    <div className="stat">
      <div className="n" style={{ color }}>{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
