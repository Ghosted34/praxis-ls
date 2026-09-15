import { useTranslation } from "react-i18next";
import {
  mediaSrcSet,
  mediaUrl,
  partnersOfKind,
  type PublicCredential,
  type PublicPartner,
  type PublicProof,
} from "@/lib/site-api";
import { dateFmt } from "@/lib/format";

/**
 * Partners, clients and credentials — guide §9.4.
 *
 * ── "THREE CLAIMS, THREE TREATMENTS. NEVER ONE GREY GRID." ────────────────
 *
 * This is the whole specification and it is a structural rule, not a styling
 * preference. 13782 made `kind` a required column for exactly this reason:
 *
 *   carrier   "we move cargo on these lines"   — a CAPABILITY
 *   client    "these organisations trust us"   — a REFERENCE
 *   network   "we are a member of this"        — a MEMBERSHIP
 *
 * A single logo wall asserts all three at once and therefore none of them, and
 * `doc/WEB_BUILD_BRIEF.md` N11 forbids it by name. So:
 *
 *   · CARRIERS sit with the corridor network — the lanes are the claim, and a
 *     carrier's mark beside them says which lines. §9.4 says "on the corridor
 *     map, the mark at the lane it serves"; see `CarrierMarks` below for why
 *     the mark is beside the scene rather than pinned to a chord.
 *   · CLIENTS get a quiet monochrome band that takes colour on hover or focus.
 *     **Never a "Trusted by" headline** (N11) — the heading names the fact
 *     ("Organisations we work with") rather than instructing the reader how to
 *     feel about it.
 *   · CREDENTIALS get a dated strip with the issuer and the identifier. §9.4
 *     calls this "the most persuasive content on the page" and it is: a number
 *     somebody can check is worth more than any number of logos.
 *
 * ── EVERY MARK HERE IS CLEARED, AND THAT IS GUARANTEED THREE LAYERS DOWN ──
 *
 * §9.7: "Every partner rendered has a `permission_note`. Asserted by a test,
 * not by inspection." Nothing in this file checks it and nothing needs to:
 * `ck_site_partner_active_needs_permission` (13782) makes an active row without
 * a note impossible, `publicPartners` filters on the note as well as on
 * `is_active`, and the media route's owner join means an uncleared partner's
 * logo has no live URL either. `site-public-redaction.test.js` asserts the
 * read; `proof-bands.test.tsx` asserts the render.
 *
 * ── AND IF O-2 IS STILL OPEN, THE SECTION IS STILL COMPLETE ───────────────
 *
 * §9.4: "If O-2 is unresolved at build time, ship the section with credentials
 * only and leave the partner rows inactive. That is a complete section, not a
 * broken one." Each band renders independently and each renders NOTHING when
 * its own list is empty, so a tenant with credentials and no cleared partners
 * gets a credentials strip and no gap where a logo wall would have been.
 */

/** One mark, or the company's name set as type.
 *
 * ── A NAME IS A LEGITIMATE TREATMENT, NOT A PLACEHOLDER ───────────────────
 *
 * O-3 is the open item: the supplied logos are screen-resolution rasters with
 * white backgrounds baked in, and §9.4 is explicit that "a white rectangle on a
 * dark band is worse than an absent logo". The upload refuses an opaque mark
 * for these slots, so a partner without a usable file has no `logo_id` at all.
 *
 * The answer is not an empty box. It is the organisation's name, set in the
 * display face — which is what a wordmark is, states exactly the same fact, and
 * reads correctly on a dark band with no asset at all.
 */
function Mark({ partner }: { partner: PublicPartner }) {
  const { t } = useTranslation();
  const src = mediaUrl(partner.logo_id);
  const avif = mediaSrcSet(partner.logo_id, partner.logo_variants, "avif");
  const webp = mediaSrcSet(partner.logo_id, partner.logo_variants, "webp");

  if (!src) return <span className="proof-wordmark">{partner.name}</span>;
  return (
    <picture>
      {avif ? <source type="image/avif" srcSet={avif} sizes="10rem" /> : null}
      {webp ? <source type="image/webp" srcSet={webp} sizes="10rem" /> : null}
      <img
        src={src}
        alt={t("site.about.markAlt", { name: partner.name })}
        loading="lazy"
        decoding="async"
        className="proof-mark-img"
      />
    </picture>
  );
}

/** A mark, wrapped in the partner's own link when they gave one. Their site is
 *  theirs; `noreferrer` keeps the tenant's visitor list out of it. */
function MarkLink({ partner, className }: { partner: PublicPartner; className: string }) {
  const inner = <Mark partner={partner} />;
  if (!partner.url) return <div className={className}>{inner}</div>;
  return (
    <a className={className} href={partner.url} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  );
}

/**
 * Clients — a quiet monochrome band, colour on hover and focus.
 *
 * The desaturation is CSS (`filter: grayscale(1)`) and it lifts on
 * `:hover`/`:focus-within`, so a keyboard user gets the same reveal a pointer
 * user does — which is the half of "on hover" that is usually forgotten and is
 * §1.2 rule 3 in practice. Under `prefers-reduced-motion` the filter still
 * changes; what does not is the transition, so the settled state is a complete
 * band rather than a slower one.
 */
export function ClientBand({ proof }: { proof: PublicProof }) {
  const { t } = useTranslation();
  const clients = partnersOfKind(proof, "client");
  if (!clients.length) return null;
  return (
    <section aria-labelledby="proof-clients" className="proof-band">
      {/* NOT "Trusted by" (N11). The heading states the relationship; whether
          that is impressive is the reader's call, and telling them is the
          sentence a procurement officer discounts. */}
      <h2 id="proof-clients" className="micro">
        {t("site.about.clientsTitle")}
      </h2>
      <ul className="proof-clients">
        {clients.map((c) => (
          <li key={c.id}>
            <MarkLink partner={c} className="proof-mark" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Carriers, beside the network.
 *
 * ── WHY THE MARK IS NOT PINNED TO A CHORD ─────────────────────────────────
 *
 * §9.4's treatment column says "Placed on the corridor map — the mark sits at
 * the lane it serves". There is no column anywhere that says WHICH lane a
 * carrier serves: `site_partner` has a name, a kind, a logo and a clearance
 * note, and nothing joins it to `corridor` or to a country. Pinning a mark to a
 * chord would therefore mean choosing one, and a carrier's logo drawn on a lane
 * they do not run is a claim about a third party's operations made up by us —
 * the exact failure N12 and §1.2 rule 7 exist to prevent, in the one place it
 * would also be somebody else's trademark.
 *
 * So the marks sit WITH the network as a row beneath it, under a heading that
 * makes the true claim — these are the lines we move cargo on — rather than a
 * per-lane claim nobody recorded. Recorded as a deviation, with the column that
 * would close it named: a `corridor_id` or a country list on `site_partner`.
 */
export function CarrierMarks({ proof }: { proof: PublicProof }) {
  const { t } = useTranslation();
  const carriers = partnersOfKind(proof, "carrier");
  if (!carriers.length) return null;
  return (
    <section aria-labelledby="proof-carriers" className="proof-band proof-band-dark">
      <h2 id="proof-carriers" className="micro">
        {t("site.about.carriersTitle")}
      </h2>
      <p className="proof-lead">{t("site.about.carriersLead")}</p>
      <ul className="proof-carriers">
        {carriers.map((c) => (
          <li key={c.id}>
            <MarkLink partner={c} className="proof-mark proof-mark-dark" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One certification. The issuer and the number are the content; the mark, when
 *  there is one, is an aside. */
function CredentialRow({ credential }: { credential: PublicCredential }) {
  const { t } = useTranslation();
  const src = mediaUrl(credential.logo_id);
  const webp = mediaSrcSet(credential.logo_id, credential.logo_variants, "webp");

  return (
    <li className="credential-row">
      {src ? (
        <picture>
          {webp ? <source type="image/webp" srcSet={webp} sizes="4rem" /> : null}
          <img
            src={src}
            alt={t("site.about.markAlt", { name: credential.name })}
            loading="lazy"
            decoding="async"
            className="credential-mark"
          />
        </picture>
      ) : null}
      <div className="credential-body">
        <p className="credential-name">{credential.name}</p>
        {credential.issuer ? (
          <p className="credential-issuer">{credential.issuer}</p>
        ) : null}
        <dl className="credential-facts">
          {credential.identifier ? (
            <div>
              <dt>{t("site.about.credentialRef")}</dt>
              {/* The mono face, because this is a reference somebody will read
                  aloud down a phone or type into a registry. */}
              <dd className="font-mono">{credential.identifier}</dd>
            </div>
          ) : null}
          {credential.issued_on ? (
            <div>
              <dt>{t("site.about.credentialIssued")}</dt>
              <dd>{dateFmt(credential.issued_on)}</dd>
            </div>
          ) : null}
          {credential.expires_on ? (
            <div>
              <dt>{t("site.about.credentialValid")}</dt>
              {/* An EXPIRED one never reaches this component — `publicPartners`
                  filters on the date in the read, where it cannot be forgotten.
                  Presenting a lapsed licence as current is the single most
                  damaging thing a forwarder can publish, so the filter is not
                  in the renderer. */}
              <dd>{dateFmt(credential.expires_on)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </li>
  );
}

/**
 * Credentials, and network memberships.
 *
 * `network` partners join this strip rather than the client band, which is what
 * 13782's own header says they are for: a membership is a credential somebody
 * granted, not a customer relationship. A membership with no issuer and no
 * number is rendered as a name — which is all a membership is.
 */
export function CredentialStrip({ proof }: { proof: PublicProof }) {
  const { t } = useTranslation();
  const memberships = partnersOfKind(proof, "network");
  if (!proof.credentials.length && !memberships.length) return null;
  return (
    <section aria-labelledby="proof-credentials" className="proof-band">
      <h2 id="proof-credentials" className="micro">
        {t("site.about.credentialsTitle")}
      </h2>
      {proof.credentials.length ? (
        <ul className="credential-list">
          {proof.credentials.map((c) => (
            <CredentialRow key={c.id} credential={c} />
          ))}
        </ul>
      ) : null}
      {memberships.length ? (
        <>
          <p className="micro mt-6">{t("site.about.membershipsTitle")}</p>
          <ul className="proof-clients">
            {memberships.map((m) => (
              <li key={m.id}>
                <MarkLink partner={m} className="proof-mark" />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
