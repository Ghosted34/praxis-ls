/**
 * PdfPreview — paint a local PDF onto a canvas so the operator can confirm
 * they picked the right scan, without going through Chrome's PDF plugin.
 *
 * Compact mode (the chip under FileDrop) shows the current page fitted into
 * a short strip. Expanded mode (the modal) shows a larger page with prev/next.
 * A render failure falls back to "Open in a new tab" — top-level navigation
 * of a blob URL is not subject to `object-src`, so that path still works even
 * if pdf.js itself cannot load.
 */
import * as React from "react";
import { loadPdfjs } from "@/lib/pdfjs";
import { cn } from "@/lib/cn";

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => {
      promise: Promise<void>;
      cancel: () => void;
    };
  }>;
  destroy: () => Promise<void> | void;
};

/** FileReader rather than `file.arrayBuffer()`: jsdom's File (and a few older
 *  WebViews) do not implement the promise API. */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsArrayBuffer(file);
  });
}

export function PdfPreview({
  file,
  full = false,
}: {
  file: File;
  /** Taller page + pager, used inside the expand modal. */
  full?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [page, setPage] = React.useState(1);
  const [pageCount, setPageCount] = React.useState(0);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPage(1);
  }, [file]);

  React.useEffect(() => {
    let live = true;
    let pdf: PdfDocument | null = null;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null =
      null;

    async function draw() {
      setStatus("loading");
      setError(null);
      try {
        const pdfjs = await loadPdfjs();
        if (!live) return;
        const data = new Uint8Array(await readAsArrayBuffer(file));
        if (!live) return;
        const task = pdfjs.getDocument({
          data,
          isEvalSupported: false,
          useSystemFonts: true,
        });
        pdf = (await task.promise) as unknown as PdfDocument;
        if (!live) {
          await pdf.destroy();
          return;
        }
        const total = pdf.numPages || 1;
        setPageCount(total);
        const pageNum = Math.min(Math.max(1, page), total);
        const pdfPage = await pdf.getPage(pageNum);
        if (!live) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) {
          throw new Error("Canvas is not available in this browser.");
        }

        const unscaled = pdfPage.getViewport({ scale: 1 });
        const targetH = full ? Math.min(window.innerHeight * 0.7, 900) : 112;
        const targetW = full
          ? Math.min(canvas.parentElement?.clientWidth || 720, 860)
          : 280;
        const fit = Math.min(
          targetW / unscaled.width,
          targetH / unscaled.height,
        );
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({
          scale: Math.max(fit, 0.15) * dpr,
        });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (live) setStatus("ready");
      } catch (err) {
        if (!live) return;
        setStatus("error");
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Could not render this PDF.",
        );
      }
    }

    void draw();
    return () => {
      live = false;
      try {
        renderTask?.cancel();
      } catch {
        /* @silent:teardown */
      }
      void pdf?.destroy();
    };
  }, [file, full, page]);

  function openTab() {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          pageCount
            ? `PDF preview, page ${Math.min(page, pageCount)} of ${pageCount}`
            : "PDF preview"
        }
        className={cn(
          "max-w-full rounded-md bg-white",
          full ? "max-h-[70vh]" : "max-h-28",
          status !== "ready" && "hidden",
        )}
      />
      {status === "loading" && (
        <div
          className={cn(
            "flex w-full items-center justify-center rounded-md border text-sm text-muted-foreground",
            full ? "h-[70vh]" : "h-28",
          )}
        >
          Rendering preview…
        </div>
      )}
      {status === "error" && (
        <div
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-md border px-3 text-center",
            full ? "h-[40vh]" : "h-28",
          )}
        >
          <p className="text-sm text-muted-foreground">
            {error && /password|encrypted/i.test(error)
              ? "This PDF is password-protected, so it cannot be previewed here."
              : "Could not render this PDF in the page."}
          </p>
          <button
            type="button"
            className="text-sm text-primary-ink underline"
            onClick={openTab}
          >
            Open in a new tab
          </button>
        </div>
      )}
      {status === "ready" && pageCount > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            className="underline disabled:no-underline disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="num">
            Page {Math.min(page, pageCount)} / {pageCount}
          </span>
          <button
            type="button"
            className="underline disabled:no-underline disabled:opacity-40"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
