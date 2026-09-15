import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The social glyphs — guide §9.5: "Monochrome glyphs from our own set,
 * `currentColor`."
 *
 * ── WHY THEY ARE IN THEIR OWN MODULE AND NOT IN `icons.tsx` ───────────────
 *
 * `icons.tsx` is on the first-paint path: the header imports it, and the header
 * is in the entry chunk. These seven glyphs are only ever drawn in the footer,
 * below the fold, after a network read that most often answers with a subset of
 * them and sometimes with nothing at all. Putting them beside the arrow and the
 * chevron would put a TikTok path in the bytes a visitor downloads before the
 * hero paints, on a route that may never render one.
 *
 * The entry chunk is at 96% of the 128 kB budget (PR 4's measurement), so this
 * is not a theoretical saving.
 *
 * ── FILLED, NOT STROKED, AND THAT IS A DEPARTURE ──────────────────────────
 *
 * Every other icon in this app is stroke-only on a 24 grid, and `icons.tsx`
 * explains why. These are filled, because a brand mark is a SHAPE — an outlined
 * WhatsApp bubble or a hollow X is not a quieter version of the mark, it is a
 * different mark, and at 18px it stops being recognisable at all. They stay
 * monochrome and `currentColor`, which is the part of the house style that
 * carries the meaning: they take the footer's ink, so a tenant's re-brand moves
 * them and no second asset exists to be forgotten.
 *
 * ── THEY ARE SIMPLIFIED, DELIBERATELY ─────────────────────────────────────
 *
 * These are recognisable silhouettes drawn to a 24 grid, not the platforms'
 * official artwork. That is the honest position for a white-label product: we
 * are not redistributing seven companies' trademark files, and a simplified
 * monochrome glyph is what a footer row needs. `alt`/`aria-label` names the
 * platform in words either way, which is what a screen reader reads.
 */

type GlyphProps = React.SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 18, className, children, ...rest }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {children}
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  linkedin: (
    <>
      <path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
      <path d="M3 9.5h4v11H3v-11Z" />
      <path d="M9.5 9.5h3.8v1.5a4.1 4.1 0 0 1 3.6-1.8c3 0 4.1 1.9 4.1 5v6.3h-4v-5.6c0-1.4-.5-2.3-1.8-2.3-1 0-1.6.7-1.8 1.4-.1.3-.1.7-.1 1v5.5h-4v-11Z" />
    </>
  ),
  facebook: (
    <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.63A22 22 0 0 0 14.3 3.5c-2.4 0-4 1.45-4 4.12V9.9H7.6V13h2.7v8h3.2Z" />
  ),
  instagram: (
    <>
      <path d="M8.2 2.5h7.6a5.7 5.7 0 0 1 5.7 5.7v7.6a5.7 5.7 0 0 1-5.7 5.7H8.2a5.7 5.7 0 0 1-5.7-5.7V8.2a5.7 5.7 0 0 1 5.7-5.7Zm0 2A3.7 3.7 0 0 0 4.5 8.2v7.6a3.7 3.7 0 0 0 3.7 3.7h7.6a3.7 3.7 0 0 0 3.7-3.7V8.2a3.7 3.7 0 0 0-3.7-3.7H8.2Z" />
      <path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      <circle cx="17.3" cy="6.7" r="1.2" />
    </>
  ),
  youtube: (
    <path d="M21.6 7.2a2.5 2.5 0 0 0-1.75-1.77C18.3 5 12 5 12 5s-6.3 0-7.85.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.75 1.77C5.7 19 12 19 12 19s6.3 0 7.85-.43A2.5 2.5 0 0 0 21.6 16.8 26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
  ),
  x: (
    <path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.2-5.8 6.2H1.5l7.5-8.6L1.2 3h6.6l4.5 5.7L17.5 3Zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3Z" />
  ),
  tiktok: (
    <path d="M15.9 2.5h-3.2v13.1a2.6 2.6 0 1 1-2.2-2.6v-3.2a5.8 5.8 0 1 0 5.4 5.8V9.2a7 7 0 0 0 4.1 1.3V7.3a4 4 0 0 1-4.1-4.1v-.7Z" />
  ),
  whatsapp: (
    <path d="M12 2.6a9.3 9.3 0 0 0-8 14.1L2.6 21.4l4.9-1.3A9.3 9.3 0 1 0 12 2.6Zm0 2a7.3 7.3 0 1 1-3.8 13.6l-.35-.2-2.6.7.7-2.55-.22-.36A7.3 7.3 0 0 1 12 4.6Zm-3.3 3.6c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.42 1.03 2.59.13.16 1.76 2.8 4.34 3.82 2.15.84 2.58.67 3.05.63.47-.04 1.5-.61 1.72-1.2.21-.6.21-1.1.15-1.21-.06-.1-.23-.17-.48-.29-.25-.13-1.5-.74-1.73-.82-.23-.09-.4-.13-.57.12-.17.25-.65.82-.8.99-.15.16-.29.19-.54.06-.25-.12-1.06-.39-2.02-1.25-.75-.66-1.25-1.48-1.4-1.73-.14-.25-.01-.38.11-.5.11-.11.25-.29.38-.44.12-.15.16-.25.24-.42.08-.16.04-.31-.02-.44-.06-.12-.56-1.37-.77-1.87-.2-.48-.4-.42-.55-.43h-.47Z" />
  ),
};

/** True when we can draw this platform. The registry in `@praxis/shared` and
 *  this map have to agree, and `social-row.test.tsx` asserts that they do —
 *  otherwise a tenant who saves a link gets a footer entry with a hole in it. */
export const hasGlyph = (platform: string) =>
  Object.prototype.hasOwnProperty.call(PATHS, platform);

export const SOCIAL_GLYPH_IDS = Object.keys(PATHS);

export function SocialGlyph({ platform, ...rest }: GlyphProps & { platform: string }) {
  const path = PATHS[platform];
  // Never a blank square: a platform we cannot draw is one the caller should
  // not render at all, and `hasGlyph` lets it decide that before it commits to
  // a list item.
  if (!path) return null;
  return <Glyph {...rest}>{path}</Glyph>;
}
