/**
 * The drawn-signature pad — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.6.
 *
 * A `<canvas>` with POINTER events, not mouse or touch events: the
 * counterparty is on a phone more often than not, and a pointer handler covers
 * finger, stylus and mouse with one code path instead of three that drift.
 *
 * ── The size cap is the interesting part ───────────────────────────────────
 * §6.6 caps the stored data URL at 200 KB, and the validator enforces it. That
 * is not a transport concern — the mark is stored ON THE SIGNATURE ROW, so an
 * uncapped one would put megabytes of canvas into every read of that
 * signature, forever, including the portal's.
 *
 * So the export downscales first and only then encodes: a 2x-DPR phone canvas
 * at full size is ~400 KB of PNG for a squiggle. Drawing happens at device
 * resolution (a signature that looks jagged reads as a broken product), and
 * the EXPORT is what gets scaled — which is the right way round.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";

/** The exported mark's width in CSS pixels. Height follows the aspect ratio. */
const EXPORT_WIDTH = 600;

export function SignaturePad({
  onChange,
  clearLabel = "Clear",
}: {
  onChange: (dataUrl: string | null) => void;
  clearLabel?: string;
}) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);
  const dirty = React.useRef(false);

  /** Size the backing store to the device, so the stroke is not blurry. */
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Ink, not a theme token: this is exported as a PNG that gets printed onto
    // a monochrome document, so it must be dark whatever the viewer's theme is.
    ctx.strokeStyle = "#111827";
  }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    // Capture, so a stroke that leaves the canvas mid-drag still ends cleanly
    // rather than leaving the pad stuck in a drawing state.
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = at(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const p = at(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(dirty.current ? exportMark(ref.current) : null);
  };

  const clear = () => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div className="mt-2">
      <canvas
        ref={ref}
        // `touch-none` so a finger draws instead of scrolling the page — on a
        // phone this is the difference between a pad and a frustration.
        className="h-32 w-full touch-none rounded-lg border border-border bg-background"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label="Signature"
      />
      <Button size="sm" variant="ghost" className="mt-1" onClick={clear} type="button">
        {clearLabel}
      </Button>
    </div>
  );
}

/**
 * Downscale, then encode.
 *
 * The other way round produces a 400 KB PNG on a 2x phone and then throws most
 * of it away — and the 200 KB cap would reject it before anything downscaled.
 */
function exportMark(source: HTMLCanvasElement | null): string | null {
  if (!source) return null;
  try {
    const scale = Math.min(1, EXPORT_WIDTH / source.width);
    const out = document.createElement("canvas");
    out.width = Math.round(source.width * scale);
    out.height = Math.round(source.height * scale);
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    // A stroke that still exceeds the cap after downscaling is not a signature,
    // it is a scribble filling the pad. Returning null lets the page keep the
    // Sign button disabled with a visible empty pad, which is a state the
    // signer can act on — where a 422 from the server is not.
    return url.length <= 200_000 ? url : null;
  } catch {
    return null;
  }
}
