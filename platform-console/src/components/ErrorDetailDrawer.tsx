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
import { errorsApi, LEVEL_STYLE, ago, type ErrorDetail } from "@/lib/errors-api";
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

              <Section title="📊 Occurrences">
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
