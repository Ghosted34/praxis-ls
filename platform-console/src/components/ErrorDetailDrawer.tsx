/**
 * Error detail drawer — spec §3.2.
 *
 * Location, parsed stack trace, AI explanation, occurrence history, raw sample.
 *
 * The AI explanation is fetched LAZILY, on click, not on open. §7.1 calls it
 * "on-demand" and that is a cost decision, not a UX one: opening a drawer must
 * not spend a model call, or an admin scrolling through twenty errors during an
 * incident silently runs up twenty bills. A cached explanation that already
 * exists is returned by the detail payload and shown immediately, because that
 * one is free.
 */

import { useEffect, useState } from "react";
import { errorsApi, LEVEL_STYLE, ago, type ErrorDetail, type TrendPoint } from "@/lib/errors-api";
import { can } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Button, Loading, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";

export function ErrorDetailDrawer({
  errorId, onClose, onResolved, onShare,
}: {
  errorId: string;
  onClose: () => void;
  onResolved: () => void;
  onShare: (id: string) => void;
}) {
  const { toast } = useToast();
  const [row, setRow] = useState<ErrorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainedBy, setExplainedBy] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  /** §3.2's "Occurrences (Last 30 days)" strip, scoped to THIS signature. */
  const [history, setHistory] = useState<TrendPoint[] | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    errorsApi
      .get(errorId)
      .then((d) => {
        if (!live) return;
        setRow(d);
        // Already-generated explanation arrives with the detail — free to show.
        setExplanation(d.explanation);
        setExplainedBy(d.explanation_by);
      })
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [errorId]);

  /**
   * The 30-day strip, fetched separately and scoped by `signature`.
   *
   * Deliberately NOT folded into the detail payload: this is a second aggregate
   * over 30 days of rows, and paying for it on every drawer open — including the
   * ones where somebody is just reading the stack trace — would put it on the
   * §10 budget for opening the drawer at all. It fails silently for the same
   * reason: a missing sparkline must not blank a drawer whose actual job is to
   * show the error.
   */
  useEffect(() => {
    let live = true;
    if (!row?.signature) return undefined;
    errorsApi
      .trends({ signature: row.signature, status: "all", hours: 30 * 24 })
      .then((t) => live && setHistory(t.points))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [row?.signature]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const explain = async (force = false) => {
    setExplaining(true);
    try {
      const res = await errorsApi.explain(errorId, force);
      setExplanation(res.explanation);
      setExplainedBy(res.generated_by);
      if (res.cached && !force) toast("Loaded cached explanation");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Explanation failed");
    } finally {
      setExplaining(false);
    }
  };

  const resolve = async () => {
    try {
      await errorsApi.resolve(errorId);
      toast("Marked resolved");
      onResolved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not resolve");
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`);
    } catch {
      toast("Copy failed");
    }
  };

  const st = row ? LEVEL_STYLE[row.level] : null;

  return (
    <div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ justifyContent: "flex-end", alignItems: "stretch" }}
    >
      <div
        className="card"
        style={{
          width: "min(680px, 100%)", maxHeight: "100%", overflowY: "auto",
          borderRadius: 0, margin: 0, display: "flex", flexDirection: "column",
        }}
      >
        <div className="hd" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--panel)" }}>
          <Button size="sm" variant="ghost" onClick={onClose}>← Back to list</Button>
          {row && !row.resolved_at && can("errors.resolve") && (
            <Button size="sm" variant="primary" onClick={() => void resolve()}>✓ Mark resolved</Button>
          )}
        </div>

        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {loading ? (
            <Loading />
          ) : err || !row ? (
            <div className="empty">Couldn’t load this error — {err}</div>
          ) : (
            <>
              <div>
                <span
                  className="pill"
                  style={{ background: st!.bg, color: st!.fg, border: `1px solid ${st!.border}`, fontWeight: 700 }}
                >
                  {st!.badge} {st!.label.toUpperCase()} ×{row.occurrence_count}
                </span>
                {row.resolved_at && (
                  <span style={{ marginLeft: 8 }}>
                    <Pill tone="ok">Resolved by {row.resolved_by_name || "—"}</Pill>
                  </span>
                )}
                <h2 style={{ fontSize: 16, marginTop: 10, lineHeight: 1.35 }}>
                  {row.name ? `${row.name}: ` : ""}{row.message}
                </h2>
              </div>

              <Section title="📍 Location">
                <Row label="Primary" value={`${row.file_path || "—"}${row.line_number ? `:${row.line_number}` : ""}`} mono />
                <Row label="Module" value={row.module || "—"} />
                <Row label="Route" value={row.route || "—"} mono />
                <Row label="Scope" value={row.tenant_slug ? `Tenant · ${row.tenant_slug}` : "Platform-wide"} />
                <Row label="Origin" value={row.origin} />
                <Row label="Release" value={row.release || "—"} mono />
              </Section>

              <Section title="🔍 Stack trace analysis">
                {row.stack_trace?.length ? (
                  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                    {row.stack_trace.map((f) => (
                      <li
                        key={f.index}
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          padding: "5px 8px",
                          borderRadius: 6,
                          background: f.vendor ? "transparent" : "var(--panel-2, rgba(255,255,255,.03))",
                          opacity: f.vendor ? 0.5 : 1,
                        }}
                        title={f.vendor ? "Dependency frame" : "Your code"}
                      >
                        <span className="muted">[{f.index}]</span>{" "}
                        {f.file || "?"}:{f.line ?? "?"} <span className="muted">→</span> {f.function}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>No parsed frames for this error.</div>
                )}
              </Section>

              <Section
                title="🤖 AI explanation"
                actions={
                  explanation ? (
                    <div className="row" style={{ gap: 6 }}>
                      <Button size="sm" variant="ghost" loading={explaining} onClick={() => void explain(true)}>🔄 Regenerate</Button>
                      <Button size="sm" variant="ghost" onClick={() => void copy(explanation, "Explanation")}>📋 Copy</Button>
                    </div>
                  ) : null
                }
              >
                {explanation ? (
                  <>
                    <div style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{explanation}</div>
                    {explainedBy && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Generated by {explainedBy}</div>
                    )}
                  </>
                ) : (
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <Button size="sm" variant="primary" loading={explaining} onClick={() => void explain(false)}>
                      🤖 Explain this error
                    </Button>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      Plain-language cause and suggested fix. Cached per signature for an hour.
                    </span>
                  </div>
                )}
              </Section>

              <Section title="📊 Occurrences (last 30 days)">
                <OccurrenceStrip points={history} level={row.level} />
                <Row label="Total" value={String(row.occurrence_count)} />
                <Row label="First seen" value={`${fmtDateTime(row.first_seen)} (${ago(row.first_seen)})`} />
                <Row label="Last seen" value={`${fmtDateTime(row.last_seen)} (${ago(row.last_seen)})`} />
                {row.resolved_at && <Row label="Resolved" value={fmtDateTime(row.resolved_at)} />}
              </Section>

              <Section title="📋 Raw error sample">
                <pre
                  className="mono"
                  style={{
                    fontSize: 11, lineHeight: 1.5, margin: 0, padding: 10, borderRadius: 8,
                    background: "var(--panel-2, rgba(0,0,0,.25))", overflowX: "auto",
                    maxHeight: 220, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}
                >
                  {row.raw_stack || row.message}
                </pre>
              </Section>

              <div className="row wrap" style={{ gap: 8, paddingBottom: 8 }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void errorsApi.share(row.id).then((s) => copy(s.plain, "Full error"))}
                >
                  📋 Copy full error
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadTrace(row)}
                  title="Save the full trace as a .txt file"
                >
                  📥 Download trace
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onShare(row.id)}>🔗 Share</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)" }}>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row" style={{ gap: 10, fontSize: 12, padding: "3px 0", alignItems: "baseline" }}>
      <span className="muted" style={{ minWidth: 72, flexShrink: 0 }}>{label}</span>
      <span className={mono ? "mono" : ""} style={{ wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

/**
 * §3.2's occurrence strip — one cell per day for 30 days.
 *
 * Bars rather than the spec mockup's `●●●○○○` dots because the shape that
 * matters is "when did this get worse", and identical dots cannot show
 * magnitude. Empty days are RENDERED, not skipped: a gap has to look like a
 * quiet day, which is the same reason the server's trends query uses
 * generate_series.
 *
 * Scale is per-signature — the tallest day in THIS error's own history is full
 * height. A shared scale across errors would flatten every ordinary bug into a
 * blank strip next to the one pathological one.
 */
function OccurrenceStrip({ points, level }: { points: TrendPoint[] | null; level: string }) {
  if (points === null) {
    return <div className="muted" style={{ fontSize: 11, padding: "6px 0" }}>Loading history…</div>;
  }
  if (points.length === 0) {
    return <div className="muted" style={{ fontSize: 11, padding: "6px 0" }}>No history available.</div>;
  }

  const peak = Math.max(1, ...points.map((p) => p.occurrences));
  const tone = LEVEL_STYLE[level as keyof typeof LEVEL_STYLE] || LEVEL_STYLE.error;

  return (
    <div style={{ margin: "2px 0 10px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 34 }}>
        {points.map((p) => {
          const h = p.occurrences === 0 ? 2 : Math.max(3, Math.round((p.occurrences / peak) * 34));
          return (
            <div
              key={p.bucket}
              title={`${new Date(p.bucket).toLocaleDateString()} — ${p.occurrences} occurrence${p.occurrences === 1 ? "" : "s"}`}
              style={{
                flex: 1,
                height: h,
                minWidth: 2,
                borderRadius: 1,
                background: p.occurrences === 0 ? "var(--line-2)" : tone.fg,
                opacity: p.occurrences === 0 ? 0.5 : 0.85,
              }}
            />
          );
        })}
      </div>
      <div className="row between muted" style={{ fontSize: 10, marginTop: 3 }}>
        <span>{new Date(points[0].bucket).toLocaleDateString()}</span>
        <span>peak {peak}/day</span>
        <span>today</span>
      </div>
    </div>
  );
}

/**
 * §3.2's `[📥 Download Trace]`.
 *
 * Built client-side from data already in the drawer — no endpoint, because the
 * payload is already here and a round trip would only add a way for the two to
 * disagree. The filename carries the signature and the date so several traces
 * saved during one incident do not collide in a downloads folder.
 */
function downloadTrace(row: ErrorDetail) {
  const body = [
    `${row.name || "Error"}: ${row.message}`,
    "",
    `Level:       ${row.level}`,
    `Origin:      ${row.origin}`,
    `Module:      ${row.module || "—"}`,
    `Route:       ${row.route || "—"}`,
    `Location:    ${row.file_path || "—"}${row.line_number ? `:${row.line_number}` : ""}`,
    `Scope:       ${row.tenant_slug || "platform-wide"}`,
    `Release:     ${row.release || "—"}  Env: ${row.env || "—"}`,
    `Occurrences: ${row.occurrence_count}`,
    `First seen:  ${row.first_seen}`,
    `Last seen:   ${row.last_seen}`,
    `Signature:   ${row.signature}`,
    "",
    "── Parsed frames ─────────────────────────────────────────────",
    ...(row.stack_trace || []).map(
      (f) => `  [${f.index}] ${f.function || "?"}  (${f.file || "?"}:${f.line ?? "?"})${f.vendor ? "  [vendor]" : ""}`,
    ),
    "",
    "── Raw stack ─────────────────────────────────────────────────",
    row.raw_stack || "(none captured)",
    "",
  ].join("\n");

  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `praxis-trace-${row.signature.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately cancels the download in some browsers; one tick is enough.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
