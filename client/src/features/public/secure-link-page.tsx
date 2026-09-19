/**
 * The secure-link viewer — what a counterparty sees when they open a `/s/:token`
 * link from an email.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 *
 * `POST /mail/secure-links` mints `${origin}/s/${token}`, the composer pastes
 * it into mail, and the API half (`GET /api/tenant/public/secure/:token`) is
 * genuinely public. But no SPA route answered `/s/:token`, so the catch-all
 * sent every recipient to `/` — inside RequireAuth — and a stranger opening a
 * document link met a sign-in screen. Inside an installed PWA (scope `/`) the
 * tap never even left the app window. This page is the missing half: outside
 * RequireAuth and outside AppShell, like `/sign/:token` and `/v/:code`.
 *
 * ── WHAT IT DOES AND DOES NOT DO ────────────────────────────────────────────
 *
 * One metadata read (which is also what records the view — reaching the page is
 * the signal §9.4 puts on the timeline), then a plain download anchor. The
 * download is NOT fetched through the API client: it is bytes under a
 * `Content-Disposition: attachment` header, and an anchor lets the browser own
 * the Save dialog, the progress and the retry.
 *
 * ── THE PREVIEW, AND WHY IT IS NOW HERE (review #24) ────────────────────────
 *
 * This header used to end "No preview is rendered — an in-app renderer for
 * arbitrary vault bytes is a sandboxing project, not a viewer page." That was
 * the right call on its own terms and the wrong outcome: the counterparty being
 * asked to act on a document had to download an unidentified file from a link
 * in an email to find out what it was. That is precisely the behaviour every
 * security-awareness programme trains people out of, so the cautious choice was
 * teaching the recipient an unsafe habit.
 *
 * The sandboxing objection is answered rather than ignored, and it is answered
 * ON THE SERVER, where the recipient cannot argue with it:
 *
 *   · `preview_kind` is decided by the API from an allow-list of PDF and raster
 *     images. This page never infers it from the content type — a security rule
 *     duplicated in the browser is a rule that drifts, and drifts where an
 *     attacker can read it. Anything else is download-only, exactly as before.
 *   · The bytes come back under `X-Content-Type-Options: nosniff`,
 *     `default-src 'none'; object-src 'none'; frame-ancestors 'self'`, and — for
 *     images — `sandbox`.
 *
 * ── THE ONE PLACE THE SANDBOX IS DELIBERATELY ABSENT ────────────────────────
 *
 * A PDF is rendered by `<iframe>` WITHOUT a `sandbox` attribute, and that is
 * not an oversight. Chromium refuses to instantiate its built-in PDF viewer
 * inside a sandboxed frame: `sandbox=""` yields a blank pane (Brave shows a
 * block page), and because the response sets `object-src 'none'` the usual
 * `<embed>` fallback is closed too. A preview that renders nothing is worse
 * than no preview, because the recipient cannot tell it apart from a corrupt
 * file. An image has no such constraint and keeps the full sandbox — hence two
 * branches rather than one.
 *
 * Note the asymmetry with the internal `VaultPreviewDialog`, which also frames
 * `text/plain` and `text/csv`: its reader is an authenticated colleague, this
 * one is anyone holding a forwarded URL. Same component shape, deliberately
 * narrower allow-list.
 *
 * Expired, revoked and never-existed all render the same opaque state, matching
 * the API's single 404: telling an anonymous visitor WHICH applies tells them
 * whether a document was ever there.
 */

import * as React from "react";
import { useParams } from "react-router-dom";
import { tenant, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import { dateDmy } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Spinner } from "@/components/ui/states";

type Payload = {
  label?: string | null;
  target_kind: string;
  expires_at: string;
  filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  download_path: string;
  /**
   * The server's verdict on whether this may be shown in place, and how.
   * Never this page's. Absent or null = download only.
   */
  preview_kind?: "pdf" | "image" | null;
};

function sizeLabel(bytes?: number | null): string {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={40}
      height={40}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v4h4M9 12h6M9 16h6" />
    </svg>
  );
}

export function SecureLinkPage() {
  const { token = "" } = useParams();
  const [data, setData] = React.useState<Payload | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [busy, setBusy] = React.useState(true);

  React.useEffect(() => {
    if (!token) {
      setBusy(false);
      setMissing(true);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setMissing(false);
    // Unauthenticated by design — the token IS the authorisation. `auth: false`
    // sends no bearer even when the opener happens to hold a session (a staff
    // member testing their own link), so the page behaves for them exactly as
    // it will for the stranger who receives it.
    tenant<Payload>(`/public/secure/${encodeURIComponent(token)}`, { auth: false })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        // Any failure to resolve reads as gone: the API answers one opaque 404
        // for expired, revoked and never-existed alike, and a network failure
        // on a stranger's phone deserves the retry wording, not a stack trace.
        setMissing(err instanceof ApiError ? true : true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Wider once there is a document on screen: a PDF page in a 28rem column is
  // a thumbnail, and a preview nobody can read is decoration.
  const previewing = !!(data && data.preview_kind);
  const previewSrc = data ? `/api/tenant${data.download_path}?disposition=inline` : "";

  return (
    <main
      className={cn(
        "mx-auto flex min-h-dvh w-full flex-col justify-center px-4 py-10",
        previewing ? "max-w-3xl" : "max-w-md",
      )}
    >
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        {busy ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner />
            <p className="text-sm text-muted-foreground">{tr("Opening your document…")}</p>
          </div>
        ) : missing || !data ? (
          <div className="space-y-3 py-4">
            <h1 className="font-display text-lg font-medium">{tr("This link is no longer valid.")}</h1>
            <p className="text-sm text-muted-foreground">
              {tr("It may have expired or been revoked. Ask the sender to issue a fresh link.")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center text-muted-foreground">
              <DocIcon />
            </div>
            <div>
              <h1 className="break-words font-display text-lg font-medium">
                {data.label || data.filename || tr("Shared document")}
              </h1>
              {data.label && data.filename && data.filename !== data.label && (
                <p className="num mt-1 break-words text-xs text-muted-foreground">{data.filename}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {[sizeLabel(data.size_bytes), `${tr("Available until")} ${dateDmy(data.expires_at)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {/* THE DOCUMENT ITSELF, when the server said it may be shown.
                An image is an <img>, so no framing question arises at all and
                the response keeps its full `sandbox`. A PDF needs the
                browser's viewer, which will not start inside a sandboxed frame
                — see the header. `title` is what a screen reader announces. */}
            {data.preview_kind === "image" && (
              <img
                src={previewSrc}
                alt={data.label || data.filename || tr("Shared document")}
                className="mx-auto max-h-[60vh] w-auto rounded-lg border border-border bg-muted/30 object-contain"
              />
            )}
            {data.preview_kind === "pdf" && (
              <iframe
                src={previewSrc}
                title={data.label || data.filename || tr("Shared document")}
                className="h-[60vh] w-full rounded-lg border border-border bg-white"
              />
            )}
            {/* A plain anchor, not an API-client download: the endpoint answers
                `Content-Disposition: attachment`, and the browser owns Save,
                progress and retry. Absolute API path, so it works from any
                host the tenant resolves on. */}
            <a
              href={`/api/tenant${data.download_path}`}
              download={data.filename || true}
              className="block"
            >
              <Button size="lg" className="w-full">
                {tr("Download")}
              </Button>
            </a>
            <Callout tone="info" title={tr("Private to this link")}>
              {tr("Anyone holding the link can download this file until it expires. Forward it only to people who should have it.")}
            </Callout>
          </div>
        )}
      </div>
    </main>
  );
}
