/**
 * `useAction` — the wrapper for mutations and click-triggered async reads.
 *
 * Its job is to make three things impossible to get wrong at once:
 *
 *   1. A mutation that succeeds tells the user (`success`).
 *   2. A mutation that is a no-op tells the user, differently (`idle`).
 *   3. An UNEXPECTED failure reaches the error monitor; an EXPECTED one
 *      (a 4xx, a config missing, a dropped network) does NOT.
 *
 * The five-line before-and-after in doc/ERROR_HANDLING.md is not marketing —
 * the reported session-kill bug was three stacked defects, and this hook shape
 * closes the last two of them (no success feedback, no `changed:false`
 * feedback). The `try/catch/setError` shape it replaces was twelve lines and
 * got both wrong.
 *
 * @example  // The common mutation shape.
 * const revoke = useAction(
 *   (id: string) => tenant(`/sessions/${id}/kill`, { method: "POST" }),
 *   {
 *     success: "Session revoked",
 *     idle: "That session was already revoked",
 *     onSuccess: () => { mine.reload(); all.reload(); },
 *   },
 * );
 * // …
 * <Button loading={revoke.busy} onClick={() => revoke.run(id)}>Revoke</Button>
 * {revoke.error && <ErrorState message={revoke.error} />}
 *
 * @example  // Background / fire-and-forget — silent to the user, visible to us.
 * const markRead = useAction(() => api.markThreadRead(id), { onError: "notice" });
 *
 * @example  // A read triggered by a click (export/print/refresh) still counts.
 * const exportCsv = useAction(
 *   () => tenantDownload("/invoices.csv", "invoices.csv"),
 *   { success: "Export ready" },
 * );
 */
import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "./use-resource";
import { ApiError, NETWORK_DOWN } from "./api-client";
import { reportClientError } from "./error-reporting";

/**
 * Mirrors `NOTIFY_SEVERITIES` on the server (error-reporter.js:70). Kept as
 * one vocabulary so backend and frontend agree on what "notice" means —
 * `notice` records without ever webhooking or spending the outbound rate limit.
 */
export type ActionSeverity = "silent" | "notice" | "warning" | "error";

/**
 * The mutation envelope. Handlers wrapped with `withResult` on the server
 * (src/shared/crud/with-result.js) always return this shape. A missing
 * envelope is treated as `changed:true` — the ~466 mutation routes not yet
 * converted continue to work unchanged.
 */
type Envelope<R> = { ok: true; changed: boolean; data?: R; message?: string };

function isEnvelope<R>(v: unknown): v is Envelope<R> {
  return !!v && typeof v === "object" && "ok" in v && "changed" in v;
}

/**
 * True when the failure was a decision the server made or a well-defined
 * client-side outcome we can display without a stack trace. Extends the
 * expected/unexpected split that `isNetworkError` already draws for the
 * connection-vs-decision line — see api-client.ts:202.
 *
 * Reporting an expected failure is what rebuilds the firehose the backend's
 * `NOTIFY_SEVERITIES` filter was written to prevent, so this list is
 * deliberately explicit rather than "anything with a code".
 */
const EXPECTED_STATUSES = new Set([400, 403, 404, 409, 422, 424]);
const EXPECTED_CODES = new Set([
  NETWORK_DOWN,
  "CONFIG_MISSING",
  "PERMISSION_DENIED",
  "VALIDATION_ERROR",
  "FEATURE_DISABLED",
  "NOT_FOUND",
]);

function isExpectedError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof ApiError) {
    if (EXPECTED_STATUSES.has(e.status)) return true;
    if (EXPECTED_CODES.has(e.code)) return true;
  }
  return false;
}

export type UseActionOptions<R> = {
  /**
   * The toast shown on a genuine success. Omit for class D/E (silent to the
   * user; a failure still records at `onError` severity).
   */
  success?: string | ((r: R) => string);
  /**
   * The toast shown on `{ changed: false }`. The session-kill "already
   * revoked" case — a 200 whose body says the row did not move.
   */
  idle?: string;
  /**
   * How an UNEXPECTED failure is reported (5xx, TypeError, schema mismatch,
   * DOWNLOAD_FAILED, malformed envelope). Expected failures are never
   * reported. Default: `"error"`.
   *
   * `"silent"` requires `silentReason` — the lint rule refuses a silent
   * catch without a taxonomy class from doc/ERROR_HANDLING.md.
   */
  onError?: ActionSeverity;
  /**
   * Required when `onError === "silent"`. The taxonomy class from
   * doc/ERROR_HANDLING.md; the ESLint rule refuses `"silent"` without it so
   * the intent shows up in code review.
   */
  silentReason?: "storage" | "parse" | "teardown";
  /**
   * Run after a resolved call, in both `changed:true` and `changed:false`
   * branches. Do reloads and modal-closes here rather than after `run()` — a
   * failed call must not run them.
   */
  onSuccess?: (r: R) => void;
};

export type UseActionResult<A extends unknown[], R> = {
  /** Invokes the wrapped fn. Never rejects — the error is on `error`. */
  run: (...args: A) => Promise<R | undefined>;
  /** True while a call is in flight. Wire to a button `loading` prop. */
  busy: boolean;
  /** Formatted error string, or null. The same shape `useList.error` uses. */
  error: string | null;
  /** Explicitly clear a stuck error (e.g. when reopening a modal). */
  clearError: () => void;
};

export function useAction<A extends unknown[], R = unknown>(
  fn: (...args: A) => Promise<R>,
  opts: UseActionOptions<R> = {},
): UseActionResult<A, R> {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Enforce the silent-reason contract at construction so a reviewer catches
  // it in dev — the ESLint rule catches it in code review; this catches
  // programmatic mistakes that route around the lint (dynamic opts objects).
  if (
    opts.onError === "silent" &&
    !opts.silentReason &&
    process.env.NODE_ENV !== "production"
  ) {
    console.warn(
      '[useAction] onError:"silent" requires silentReason (storage|parse|teardown). See doc/ERROR_HANDLING.md.',
    );
  }

  // Keep the latest fn/opts in a ref so `run` stays stable across renders —
  // component-owned closures that change on every render should not force
  // downstream memoisation to break.
  const fnRef = React.useRef(fn);
  const optsRef = React.useRef(opts);
  fnRef.current = fn;
  optsRef.current = opts;

  const run = React.useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await fnRef.current(...args);
        const o = optsRef.current;

        // Unwrap the envelope if the endpoint speaks it. `data` (when present)
        // is what the caller expects; a missing `data` on `changed:true` means
        // the endpoint is void-returning, which is fine — nothing to hand back.
        // `payload` is typed as R because the caller's fn resolves to R; when the
        // endpoint speaks the envelope we unwrap `data`, otherwise the whole
        // result IS the payload. The `as R` casts are the deliberate escape
        // valve — TS cannot see through the runtime envelope check, and R is by
        // definition what the caller told us the payload is.
        let payload: R = result;
        let changed = true;
        let idleMsg: string | undefined;
        if (isEnvelope<R>(result)) {
          changed = result.changed;
          idleMsg = result.message;
          if (result.data !== undefined) payload = result.data as R;
        }

        if (changed) {
          const s = o.success;
          if (s) toast.success(typeof s === "function" ? s(payload as R) : s);
        } else if (o.idle) {
          toast.info(o.idle);
        } else if (idleMsg && o.success) {
          // Endpoint said it was a no-op but the call site didn't provide idle
          // copy. Fall back to the server's message rather than the success
          // one — a "created" toast for a no-op would be a fresh lie.
          toast.info(idleMsg);
        }

        o.onSuccess?.(payload as R);
        return payload;
      } catch (e) {
        const o = optsRef.current;
        const message = errMsg(e);
        setError(message);

        // The severity split. Expected failures — 4xx, CONFIG_MISSING,
        // NETWORK_DOWN, AbortError — are the server making a decision or the
        // network dropping, and neither is a fault to page on. Everything else
        // is unexpected and reaches the reporter.
        const expected = isExpectedError(e);
        const severity: ActionSeverity = o.onError ?? "error";

        if (severity !== "silent" && o.success !== undefined) {
          // Only show a toast when the caller opted into user-visible feedback
          // by providing `success` copy. A class D action (background best-effort)
          // omits `success`; a failure is recorded but stays silent to the user.
          toast.error(message);
        }

        if (!expected && severity !== "silent") {
          reportClientError({
            kind: "unhandledrejection",
            message,
            name: e instanceof Error ? e.name : "ActionError",
            stack: e instanceof Error ? e.stack : undefined,
            // fatal is server-side severity mapping — leave it to the sink.
            fatal: severity === "error" || severity === "warning",
          });
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const clearError = React.useCallback(() => setError(null), []);

  return { run, busy, error, clearError };
}

/**
 * Row-action helper — one busy id and one error, shared across the rows of
 * a table. Predates `useAction` and lives on because a per-row `useAction`
 * cannot short-circuit "only one at a time" across sibling buttons.
 *
 * For new code prefer `useAction`. This exists to keep the single existing
 * consumer working (features/masterdata/service-type-dossier.tsx) without a
 * churn-only rewrite in this PR.
 */
export function useRowAction() {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setBusyId(id);
      setError(null);
      try {
        await fn();
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return {
    busyId,
    error,
    run,
    clearError: React.useCallback(() => setError(null), []),
  };
}
