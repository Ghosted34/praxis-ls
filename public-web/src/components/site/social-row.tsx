import * as React from "react";
import { useTranslation } from "react-i18next";
import { SocialGlyph, hasGlyph } from "@/components/ui/social-glyphs";
import { listPublicSocial, type SocialLink } from "@/lib/site-api";
import { afterPaint } from "@/lib/after-paint";

/**
 * The footer's social row — guide §9.5.
 *
 * ── "A BLANK PLATFORM RENDERS NOTHING" IS TRUE THREE TIMES OVER ───────────
 *
 * §9.7 asks for it as an acceptance criterion, and it is guaranteed at three
 * layers rather than checked here:
 *
 *   1. 13781 DELETES the row when a tenant clears the field. There is no such
 *      thing as a stored empty URL, so "registered" and "has a link" cannot
 *      come apart.
 *   2. `publicSocial` returns only rows that exist, and the read in
 *      `site-api.ts` drops anything without a string URL anyway.
 *   3. This component renders nothing at all when the list is empty — no
 *      heading, no empty row, no placeholder icons.
 *
 * A footer icon linking nowhere is worse than one icon fewer: it is a dead link
 * in the most-inspected part of a marketing page, and it tells a procurement
 * officer the site is not maintained.
 *
 * ── AND THE HOST IS VALIDATED WHERE IT IS WRITTEN, NOT HERE ───────────────
 *
 * `isValidSocialUrl` (`@praxis/shared/design/social`) checks the URL against
 * the platform's own host with a real URL parse, on the settings form and again
 * in the API. This component does not re-check, and importing the registry to
 * do so would pull `@praxis/shared` into `public-web`'s bundle — the exact
 * thing D-1 refused, for eleven kilobytes of Zod and country tables.
 *
 * The guarantee that matters is stated where it can be enforced: a LinkedIn
 * glyph in a tenant's own footer pointing at an arbitrary URL is a phishing
 * primitive with the tenant's reputation attached, so the write path refuses
 * one. `tests/unit/*` and `social.test.js` assert that; this file trusts it.
 *
 * ── THE READ IS AFTER PAINT; THE GLYPHS ARE IN THE ENTRY ─────────────────
 *
 * The fetch is behind `after-paint`, so nothing above the fold waits for it.
 * The glyph paths, though, ARE on the first-paint path: this file is imported
 * by the footer and the footer is in the entry chunk.
 *
 * That is a measured decision rather than an oversight. `social-glyphs.tsx` is
 * seven filled paths and no logic — 0.4 kB gzipped in the entry, reported in the
 * PR — against a separate chunk, a second request and a Suspense boundary for
 * a row most tenants do render. `leader-card.tsx` uses the same module for its
 * LinkedIn mark, so Rollup would hoist it into the entry anyway the moment two
 * chunks shared it (F-18's lesson about shared modules, from the other
 * direction).
 *
 * If the first-paint budget tightens, this is the cheapest thing on this page
 * to move behind a dynamic `import()` — the read is already asynchronous, so
 * the glyphs would simply arrive with the answer.
 */
export function SocialRow({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const [links, setLinks] = React.useState<SocialLink[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      listPublicSocial({ signal: controller.signal }).then((rows) => {
        if (alive) setLinks(rows);
      });
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, []);

  const drawable = links.filter((l) => hasGlyph(l.platform));
  if (!drawable.length) return null;

  return (
    <nav aria-label={t("site.footer.social")} className="social-row">
      <ul>
        {drawable.map((link) => (
          <li key={link.platform}>
            <a
              href={link.url}
              target="_blank"
              /* `noopener` stops the opened page reaching back through
                 `window.opener`; `noreferrer` keeps the tenant's visitor list
                 out of a social network's analytics. §9.5 asks for both by
                 name. */
              rel="noopener noreferrer"
              className={onDark ? "social-link is-dark" : "social-link"}
            >
              {/* THE ACCESSIBLE NAME IS PER PLATFORM (§9.5). A row of seven
                  links all called "Social" is a row a screen-reader user cannot
                  navigate. The platform's own name is a proper noun and is not
                  translated; the sentence around it is. */}
              <span className="sr-only">
                {t("site.footer.socialOn", { platform: PLATFORM_NAME[link.platform] ?? link.platform })}
              </span>
              <SocialGlyph platform={link.platform} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The platforms' own names, for the accessible label.
 *
 * NOT read from `@praxis/shared`'s registry, which is where they also live.
 * That package is CommonJS, pulls Zod, and D-1 kept it out of this bundle for
 * eleven kilobytes of headroom that PR 4 has since spent down to four. Seven
 * proper nouns are the cheaper copy, and `social-row.test.tsx` pins this map
 * against the registry so the two cannot drift silently.
 */
const PLATFORM_NAME: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
};

export { PLATFORM_NAME };
