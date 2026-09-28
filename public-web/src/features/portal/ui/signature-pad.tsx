/**
 * The drawn-signature pad, for accepting a proposal in the portal.
 *
 * The same pad as the ERP's public signing page (`client/src/features/public/
 * signature-pad.tsx`, doc/SIGNATURE_ENGINEERING_GUIDE.md §6.6), in the
 * portal's look — this app installs only its own dependencies and cannot
 * import from `client/`, so the two are kept in step by hand:
 *
 *   · POINTER events, one code path for finger, stylus and mouse;
 *   · drawn at device resolution (a jagged signature reads as a broken
 *     product), and DOWNSCALED BEFORE ENCODING, because the mark is stored on
 *     the signature row and the validator caps it at 200 KB;
 *   · ink, not a theme token — the PNG is printed onto a monochrome document
 *     whatever the reader's theme is.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";

const EXPORT_WIDTH = 600;
/** Printed ink. A theme token would make a dark-mode signature white on paper. */
const INK = "#111827";

export function SignaturePad({ onChange, label }: { onChange: (dataUrl: string | null) => void; label: string }) {
  const { t } = useTranslation();
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);
  const dirty = React.useRef(false);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
  }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
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
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <div className="pt-sign-pad">
        <canvas
          ref={ref}
          className="block h-40 w-full touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-label={label}
          role="img"
        />
        <span className="pt-sign-line" aria-hidden="true" />
      </div>
      <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm mt-1" onClick={clear}>
        {t("portal.prop.sign.clear")}
      </button>
    </div>
  );
}

/**
 * Downscale, then encode — the other way round makes a 400 KB PNG on a 2x
 * phone that the 200 KB cap would refuse before anything shrank it.
 */
function exportMark(source: HTMLCanvasElement | null): string | null {
  if (!source) return null;
  try {
    const scale = Math.min(1, EXPORT_WIDTH / source.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(source.width * scale));
    out.height = Math.max(1, Math.round(source.height * scale));
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    // Still over the cap after downscaling is a scribble filling the pad, not
    // a signature: null keeps Sign disabled, which the signer can act on.
    return url.length <= 200_000 ? url : null;
  } catch {
    return null;
  }
}
