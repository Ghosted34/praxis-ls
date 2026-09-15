import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import { mediaSrcSet, mediaUrl, pickBilingual, type PublicLeader } from "@/lib/site-api";
import { SocialGlyph } from "@/components/ui/social-glyphs";
import { cn } from "@/lib/cn";

/**
 * Leadership — guide §9.3. ONE renderer, both tiers.
 *
 * §6.7 put group and entity leadership in one table with a nullable
 * `entity_id`, precisely so there would be one editor and one renderer. This is
 * the renderer. The group section on the About page and each entity's card in
 * the network below it hand it the same `PublicLeader[]`, so the two tiers
 * cannot drift into looking like different kinds of person.
 *
 * ── "DIGNITY BEATS EFFECTS" IS A CONSTRAINT, NOT A MOOD ───────────────────
 *
 * §9.3: "Hover/focus response at rung 1–2. Restrained: this is the page where
 * dignity beats effects." Rung 1–2 in §5.3's depth model is a shadow and a
 * one-pixel lift — no parallax, no tilt, no scrub. The corridor scene is at
 * rung 3 and it is a diagram; a photograph of a named person moving under the
 * pointer is the thing that makes a leadership page look like a product page.
 *
 * ── THE BIO EXPANDS, AND IT IS A `<details>` ──────────────────────────────
 *
 * §9.3 asks for an expandable bio. `<details>`/`<summary>` is keyboard-operable
 * and screen-reader-announced with no JavaScript and no ARIA of ours, which
 * matters more here than anywhere else on the site: this content arrives after
 * paint, and a hand-rolled disclosure whose state lives in React is one hydration
 * mismatch away from a bio nobody can open.
 *
 * ── AND THE PORTRAIT IS `owned` OR IT DOES NOT EXIST ──────────────────────
 *
 * §9.3: "Portraits are `owned` provenance only — the guardrail is structural
 * (§1.3), not a convention." Nothing in this file enforces that and nothing in
 * this file needs to: the upload control does not offer `generated`, the API
 * refuses it for the LEADER role, and 13789's
 * `ck_vault_generated_is_atmosphere_only` refuses it at the row. What this file
 * does is handle the case that follows — a leader with no portrait at all,
 * which is the normal state for a tenant who has just started.
 *
 * A MONOGRAM PLATE, NOT A GREY SILHOUETTE. A silhouette is a picture of a
 * person who is not this person; the initials are this person's, drawn in the
 * tenant's own palette. Nothing is invented (N12) and the row of cards keeps
 * its rhythm instead of reading as three broken images.
 */

/** Two letters at most, from the parts of the name that carry it.
 *
 *  `Array.from` rather than `split("")`: "Émile" is one grapheme and two UTF-16
 *  code units, and slicing the string would print half a character. */
export function monogram(name: string): string {
  const parts = String(name || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  const first = Array.from(parts[0])[0] || "";
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] || "" : "";
  return (first + last).toUpperCase();
}

/**
 * One person.
 *
 * `featured` is the CEO message treatment §9.1 calls "the page's anchor" — the
 * same component at a larger size with the bio open, rather than a second
 * component that would drift from this one.
 */
export function LeaderCard({
  leader,
  featured = false,
}: {
  leader: PublicLeader;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const role = pickBilingual(leader.role, lang);
  const bio = pickBilingual(leader.bio, lang);
  const src = mediaUrl(leader.photo_id);
  const avif = mediaSrcSet(leader.photo_id, leader.photo_variants, "avif");
  const webp = mediaSrcSet(leader.photo_id, leader.photo_variants, "webp");

  return (
    <article className={cn("leader-card", featured && "is-featured")}>
      <div className="leader-portrait">
        {src ? (
          <picture>
            {/* AVIF first: on a portrait it is roughly 30% smaller than WebP at
                the same quality, and the browser takes the first format it
                understands. A `<source>` is omitted entirely rather than
                emitted empty when that format was never written — Safari
                treats an empty srcset as a candidate and then fails it. */}
            {avif ? <source type="image/avif" srcSet={avif} sizes={featured ? "(min-width: 900px) 22rem, 60vw" : "(min-width: 900px) 14rem, 40vw"} /> : null}
            {webp ? <source type="image/webp" srcSet={webp} sizes={featured ? "(min-width: 900px) 22rem, 60vw" : "(min-width: 900px) 14rem, 40vw"} /> : null}
            <img
              src={src}
              /* THE ALT TEXT IS THE PERSON'S NAME, IN A SENTENCE FROM OUR
                 DICTIONARY. Their name is theirs and is not translated; the
                 word "portrait" around it is ours and is. That split is why
                 there is no alt-text FIELD in the upload control — a second
                 copy of a name typed into a form is the copy a screen-reader
                 user hears after somebody fixes a spelling in the first. */
              alt={t("site.about.portraitAlt", { name: leader.name })}
              loading="lazy"
              decoding="async"
              className="leader-photo"
            />
          </picture>
        ) : (
          <span aria-hidden className="leader-monogram">
            {monogram(leader.name)}
          </span>
        )}
      </div>

      <div className="leader-body">
        <h3 className="leader-name">{leader.name}</h3>
        {role ? <p className="leader-role">{role}</p> : null}

        {bio ? (
          featured ? (
            /* The anchor of the page is not something to click open. §9.1 calls
               the CEO message "the single most credible asset in the
               programme"; putting it behind a disclosure would be hiding the
               one paragraph the page exists to carry. */
            <p className="leader-message">{bio}</p>
          ) : (
            <details className="leader-bio">
              <summary>{t("site.about.readBio")}</summary>
              <p className="leader-bio-text">{bio}</p>
            </details>
          )
        ) : null}

        {leader.linkedin_url ? (
          <a
            className="leader-link"
            href={leader.linkedin_url}
            target="_blank"
            /* `noopener` is the security half — the opened page can otherwise
               reach back through `window.opener`. `noreferrer` is the one this
               page owes the tenant: their visitor list is not LinkedIn's. */
            rel="noopener noreferrer"
          >
            <SocialGlyph platform="linkedin" size={16} />
            {/* The accessible name carries the person, because a page with six
                of these otherwise offers a screen-reader user six links called
                "LinkedIn". */}
            <span className="sr-only">
              {t("site.about.linkedinOf", { name: leader.name })}
            </span>
            <span aria-hidden>{t("site.about.linkedin")}</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}

/**
 * A tier of leadership, or nothing.
 *
 * Renders NOTHING when the tier is empty — not a heading over white space. Same
 * rule as the ESG band and the figures strip: an absence is not a claim, and a
 * section titled "Leadership" with no people in it reads as a page that failed
 * to load.
 */
export function LeaderGrid({
  leaders,
  className,
}: {
  leaders: PublicLeader[];
  className?: string;
}) {
  if (!leaders.length) return null;
  return (
    <ul className={cn("leader-grid", className)}>
      {leaders.map((l) => (
        <li key={l.id}>
          <LeaderCard leader={l} />
        </li>
      ))}
    </ul>
  );
}
