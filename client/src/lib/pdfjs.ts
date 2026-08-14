/**
 * Lazy pdf.js loader.
 *
 * WHY IT IS SEPARATE. FileDrop used to preview a picked PDF in a sandboxed
 * `<iframe src="data:application/pdf;…">`. That never rendered in Chrome:
 * Helmet's default CSP is `object-src 'none'`, and Chrome's built-in PDF viewer
 * is a plugin subject to that directive — the interstitial is exactly
 * "This content is blocked. Contact the site owner to fix the issue." The empty
 * `sandbox=""` (added so a crafted file could not run script in the frame) also
 * disables plugins, and there is no sandbox token that turns them back on.
 *
 * pdf.js paints pages onto a `<canvas>`. No iframe, no plugin, no object-src,
 * and PDF JavaScript cannot execute (`isEvalSupported: false` at the call site).
 * The library is ~1 MB, so it is imported only when a PDF is actually previewed
 * and is left out of the `vendor` chunk (see ROUTE_LOCAL_VENDOR in
 * vite.config.ts) — a user who never picks a PDF never downloads it.
 *
 * The worker URL is a Vite `?url` asset so it is same-origin and satisfies
 * `script-src 'self'` / the worker-src fallback. A CDN worker would be refused.
 */
import type * as Pdfjs from "pdfjs-dist";

type PdfjsModule = typeof Pdfjs;

let cached: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!cached) {
    cached = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return cached;
}

/** Test-only: drop the memo so a suite can stub the next load. */
export function resetPdfjsLoader(): void {
  cached = null;
}
