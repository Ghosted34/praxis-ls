/**
 * ResponsiveImage — render a stored image in the smallest modern format the
 * browser can take.
 *
 * The upload engine writes AVIF and WebP derivatives beside every master at
 * thumb (256px), preview (1024px) and full (2400px). This is the half that
 * makes that pay: a documents table that renders 40 masters pulls 40 full-size
 * images, where the same table pointed at `variant="thumb"` pulls 40 files of a
 * few KB each. That difference IS the page-load complaint.
 *
 * WHY THIS IS SAFE even for images uploaded before the engine existed. <picture>
 * does NOT fall back: if a <source srcset> 404s the browser shows a broken
 * image rather than dropping to the <img>. Referencing a derivative therefore
 * requires certainty it exists — and the /media route provides exactly that by
 * generating a missing derivative on first request (see server.js and
 * image-pipeline.service.js). Without that route this component would be unsafe
 * to point at any legacy row.
 *
 * The <img> inside keeps the MASTER as its src, so a right-click "Save image
 * as" still yields the portable JPEG/PNG rather than an AVIF the recipient's
 * software may not open.
 */
import * as React from "react";

/** Sizes the pipeline emits. Must match SIZES in image-pipeline.service.js. */
export type ImageVariant = "thumb" | "preview" | "full";

/**
 * Only keys served by /media get derivatives, and only rasters have them.
 * An SVG, a data URL, a blob preview or an off-site URL renders as a plain
 * <img> — pointing <picture> at any of those would produce the broken-image
 * case above.
 */
function derivableBase(src: string): string | null {
  if (!src.startsWith("/media/")) return null;
  const m = /^(.*)\.(jpe?g|png|webp)$/i.exec(src);
  return m ? m[1] : null;
}

export function ResponsiveImage({
  src,
  alt,
  variant = "preview",
  className,
  loading = "lazy",
  ...rest
}: {
  /** The MASTER's URL, as stored — e.g. /media/tenant_acme/site/hero_ab12.jpg */
  src: string;
  /** Required. A decorative image passes "" explicitly, never omits it. */
  alt: string;
  variant?: ImageVariant;
  className?: string;
  loading?: "lazy" | "eager";
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "loading">) {
  const base = derivableBase(src);

  const img = (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      // Keeps image decode off the main thread, so a long list of thumbnails
      // does not jank the scroll it is being scrolled through.
      decoding="async"
      {...rest}
    />
  );

  if (!base) return img;

  return (
    <picture>
      <source srcSet={`${base}.${variant}.avif`} type="image/avif" />
      <source srcSet={`${base}.${variant}.webp`} type="image/webp" />
      {img}
    </picture>
  );
}
