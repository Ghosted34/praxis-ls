/**
 * Comms → Setup → Test calls (calls audit PR-7; owner decision O5).
 *
 * Proves, from this device and the server, that every step of a call works,
 * and names the one that does not. Offered only to someone holding the Test
 * right on Smart Comms (MOD-64); a run spends provider credit, so the server
 * allows 3 a day for the whole company and this screen says when the next
 * one is available rather than offering a button that will be refused.
 *
 * The run's server steps stream in over the socket (`comms:diagnostics`),
 * with polling as the fallback; the device steps run here
 * (test-calls-runner.ts). The finished run offers a plain-text report to
 * paste to support — timings and causes, never audio or a secret.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { dateTimeFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { getCommsSocket } from "@/lib/comms-socket";
import {
  ackDiagSignal,
  diagIce,
  diagRing,
  finishDiagRun,
  getDiagRun,
  listDiagRuns,
  reportDiagStep,
  startDiagRun,
  uploadDiagPart,
  type DiagCap,
  type DiagRun,
  type DiagRunRow,
  type DiagStatus,
  type DiagStep,
} from "@/lib/smartcomm-api";
import { browserDeps, runDeviceSteps, type DeviceDeps, type DevicePhase } from "./test-calls-runner";

const POLL_MS = 2_000;
const POLL_MAX_MS = 5 * 60 * 1000;

const STATUS_TONE: Record<DiagStatus, Tone> = {
  pass: "ok",
  warn: "warn",
  fail: "bad",
  skipped: "mute",
  pending: "mute",
  running: "blue",
};
const STATUS_LABEL: Record<DiagStatus, string> = {
  pass: "Passed",
  warn: "Check",
  fail: "Failed",
  skipped: "Skipped",
  pending: "Waiting",
  running: "Running",
};
const RUN_TONE: Record<DiagRun["status"], Tone> = { RUNNING: "blue", PASSED: "ok", WARN: "warn", FAILED: "bad" };
const RUN_LABEL: Record<DiagRun["status"], string> = { RUNNING: "Running", PASSED: "Passed", WARN: "Passed with warnings", FAILED: "Failed" };

/** What the person reads aloud during steps 5, 6 and 8. */
const SENTENCE = "The truck with container four left the port at nine and will reach the warehouse this afternoon.";

function StepRow({ step }: { step: DiagStep }) {
  const checks = step.detail?.checks || [];
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 text-right font-mono text-xs tabular-nums text-muted-foreground">{step.n}</span>
        <span className="min-w-0 flex-1 text-sm font-medium">{tr(step.title)}</span>
        {Number.isFinite(step.ms) && step.status !== "pending" && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {tv("{{ms}} ms", { ms: Math.round(Number(step.ms)) })}
          </span>
        )}
        <Pill tone={STATUS_TONE[step.status]}>{tr(STATUS_LABEL[step.status])}</Pill>
      </div>
      {step.cause && <p className="pl-8 text-sm">{step.cause}</p>}
      {step.fix && step.status !== "pass" && <p className="pl-8 text-xs text-muted-foreground">{step.fix}</p>}
      {checks.length > 0 && (
        <ul className="pl-8 text-xs text-muted-foreground">
          {checks.map((c, i) => (
            <li key={i}>
              {c.ok ? "✓" : "✗"} {c.label}
              {Number.isFinite(c.ms) ? ` · ${Math.round(Number(c.ms))} ms` : ""}
              {Number.isFinite(c.match) ? ` · ${tv("{{pct}}% words matched", { pct: Math.round(Number(c.match) * 100) })}` : ""}
              {c.error ? ` · ${c.error}` : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function TestCallsTab({ deps = browserDeps }: { deps?: DeviceDeps }) {
  const toast = useToast();
  const [runs, setRuns] = React.useState<DiagRunRow[] | null>(null);
  const [cap, setCap] = React.useState<DiagCap | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [run, setRun] = React.useState<DiagRun | null>(null);
  const [phase, setPhase] = React.useState<DevicePhase | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const runId = React.useRef<string | null>(null);

  const loadList = React.useCallback(() => {
    listDiagRuns()
      .then((r) => {
        setRuns(r.runs);
        setCap(r.cap);
        setListError(null);
      })
      .catch((e) => setListError(errMsg(e)));
  }, []);
  React.useEffect(loadList, [loadList]);

  // The worker's live signal (step 3) and the server steps' progress.
  React.useEffect(() => {
    const s = getCommsSocket();
    const onEvent = (p: { run_id?: string; kind?: string; nonce?: string } | null) => {
      if (!p || !p.run_id || p.run_id !== runId.current) return;
      if (p.kind === "signal" && p.nonce) {
        void ackDiagSignal(p.run_id, p.nonce).then(setRun).catch(() => {
          /* @silent:teardown — a late or refused echo is judged by the server's watchdog, which the run shows. */
        });
        return;
      }
      void getDiagRun(p.run_id).then(setRun).catch(() => {
        /* @silent:teardown — the poll below reads the run again. */
      });
    };
    s.on("comms:diagnostics", onEvent);
    return () => {
      s.off("comms:diagnostics", onEvent);
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startDiagRun(import.meta.env.VITE_BUILD_SHA || undefined);
      runId.current = started.run_id;
      setRun(started);
      const id = started.run_id;
      await runDeviceSteps({
        ring: (endpoint) => diagRing(id, endpoint),
        ice: () => diagIce(id),
        report: async (key, result) => setRun(await reportDiagStep(id, key, result)),
        upload: async (index, file) => setRun(await uploadDiagPart(id, index, file)),
      }, deps, setPhase);
      setRun(await finishDiagRun(id));
      const until = Date.now() + POLL_MAX_MS;
      let latest = await getDiagRun(id);
      while (latest.status === "RUNNING" && Date.now() < until) {
        setRun(latest);
        await new Promise((r) => setTimeout(r, POLL_MS));
        latest = await getDiagRun(id);
      }
      setRun(latest);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPhase(null);
      setBusy(false);
      loadList();
    }
  };

  const open = async (id: string) => {
    setError(null);
    try {
      runId.current = id;
      setRun(await getDiagRun(id));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const copy = async () => {
    if (!run?.report) return;
    try {
      await navigator.clipboard.writeText(run.report);
      toast.success(tr("Report copied"));
    } catch {
      /* @silent:storage — the clipboard is refused (permissions, insecure origin); the report is shown instead. */
      toast.error(tr("The browser refused the clipboard; select the report below and copy it."));
    }
  };

  const exhausted = !!cap && cap.remaining <= 0;
  const speaking = phase === "microphone" || phase === "audio" || phase === "recording";

  return (
    <div className="space-y-4">
      <Panel title={tr("Test calls")}>
        <p className="text-sm text-muted-foreground">
          {tr("Checks every step of a call on this device and on the server, and names the one that is broken. It uses the real call code, creates no call, and spends a little transcription and AI credit.")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => void start()} disabled={busy || exhausted || cap === null}>
            {busy ? tr("Testing…") : tr("Run the test")}
          </Button>
          {cap && (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {exhausted
                ? tv("All {{limit}} of today's runs are used. The next is available {{when}}.", {
                  limit: cap.limit,
                  when: cap.next_available_at ? dateTimeFmt(cap.next_available_at) : tr("tomorrow"),
                })
                : tv("{{n}} of {{limit}} runs left today for your company.", { n: cap.remaining, limit: cap.limit })}
            </span>
          )}
        </div>
        {speaking && (
          <div className="mt-3">
            <Callout tone="info">
              <p className="font-medium">{tr("Read this aloud, at your normal voice:")}</p>
              <p className="mt-1">“{tr(SENTENCE)}”</p>
            </Callout>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ErrorState message={error} />
          </div>
        )}
      </Panel>

      {run && (
        <Panel
          title={tv("Run of {{when}}", { when: dateTimeFmt(run.started_at) })}
          action={<Pill tone={RUN_TONE[run.status]}>{tr(RUN_LABEL[run.status])}</Pill>}
        >
          <ol aria-label={tr("Test steps")}>
            {run.steps.map((s) => <StepRow key={s.key} step={s} />)}
          </ol>
          {run.report && (
            <div className="mt-3 space-y-2">
              <Button variant="outline" size="sm" onClick={() => void copy()}>{tr("Copy report")}</Button>
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">{tr("Show the report")}</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 font-mono text-xs">
                  {run.report}
                </pre>
              </details>
            </div>
          )}
        </Panel>
      )}

      <Panel title={tr("Past runs")}>
        {listError ? (
          <ErrorState message={listError} />
        ) : runs === null ? (
          <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("No test has been run yet.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-primary-ink hover:underline"
                  onClick={() => void open(r.run_id)}
                >
                  {dateTimeFmt(r.started_at)}
                </button>
                <span className="text-muted-foreground">{r.user_name || tr("Someone")} · {r.env === "sandbox" ? tr("Test") : tr("Live")}</span>
                <Pill tone={RUN_TONE[r.status]}>{tr(RUN_LABEL[r.status])}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
