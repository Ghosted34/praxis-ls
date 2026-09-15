import * as React from "react";
import { useTranslation } from "react-i18next";
import { SocialRow } from "./social-row";
import {
  getPublicProof,
  listPublicEntities,
  type PublicCredential,
  type PublicEntity,
} from "@/lib/site-api";
import { afterPaint } from "@/lib/after-paint";

/**
 * Everything §9.5 adds to the footer, in its own chunk.
 *
 * ── WHY THIS IS A SEPARATE FILE ───────────────────────────────────────────
 *
 * `site-footer.tsx` is in the entry chunk — every route renders it — so
 * anything it statically imports is downloaded before the hero paints. This
 * module carries two network readers and, through `social-row.tsx`, seven glyph
 * paths. Written inline, they took first paint from 123.4 kB to 129.4 kB
 * against a 128 kB budget.
 *
 * Nothing is lost by moving them: both reads were already behind `after-paint`,
 * both blocks are below the fold on every route, and neither can render
 * anything before its answer arrives. The chunk is fetched at the moment the
 * data is. `site-footer.tsx`'s `FooterExtras` carries the loading half and the
 * reason it is a plain dynamic import rather than `React.lazy`.
 *
 * ── ONE COMPONENT, TWO READS, AND WHY THEY SIT TOGETHER ───────────────────
 *
 * They are one block of small print. Two independent readers in the footer
 * would be two requests from two effects with two cleanup paths for four lines
 * of text, and the social row would still need the same chunk.
 *
 * Both reads are on endpoints the About page also uses, so on `/about` this is
 * a second render of an answer the browser has already cached, and everywhere
 * else it is two small requests below the fold.
 *
 * ── THE CREDENTIALS LINE ──────────────────────────────────────────────────
 *
 * The NAMES only. The About page carries the dated strip with issuers and
 * reference numbers; a footer has room for what the tenant holds, and a reader
 * who wants the number follows the link to the page that has it.
 *
 * EXPIRY IS ALREADY APPLIED. `publicPartners` filters on `expires_on` in the
 * read, where it cannot be forgotten, so a lapsed licence leaves the footer at
 * the same moment it leaves the page — which is the whole reason that filter is
 * not in a renderer.
 *
 * ── THE LEGAL ENTITY LINE, AND WHAT IT CANNOT SAY ─────────────────────────
 *
 * A legal entity line conventionally carries a registration number — "SARL au
 * capital de X, RCCM …". This one carries the LEGAL NAMES of the companies the
 * tenant has published, and nothing else, because `GET /public/site/entities`
 * deliberately publishes no statutory identifier (13787, §6.8): a trade-register
 * number changes no visitor's decision and is most of what somebody needs to
 * impersonate a company to its own suppliers. Printing one we do not have would
 * be inventing it (N12).
 *
 * The legal name is the point of the line even so: the footer's brand name is
 * the tenant's TRADING name, and "who am I actually contracting with" is a
 * question a procurement officer asks of a freight forwarder specifically.
 *
 * Each part renders nothing when empty, which is the default for a new tenant:
 * `site_credential` is empty until somebody fills it (O-4 records that none has
 * been supplied for the tenant this was built for), and `public_enabled` is off
 * until somebody turns it on (13787).
 */
export function FooterExtrasContent() {
  const { t } = useTranslation();
  const [credentials, setCredentials] = React.useState<PublicCredential[]>([]);
  const [entities, setEntities] = React.useState<PublicEntity[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      const signal = controller.signal;
      getPublicProof({ signal }).then((proof) => {
        if (alive) setCredentials(proof.credentials);
      });
      listPublicEntities({ signal })
        .then((rows) => {
          if (alive) setEntities(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          /* silent-catch: PRESENTATION. No public entity is the normal state
             (13787), and a footer line that is absent is the correct rendering
             of it. doc/ERROR_HANDLING.md */
        });
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, []);

  /* The LEGAL names, de-duplicated: a group whose subsidiaries share a legal
     name has one name, not three identical ones. */
  const legal = [...new Set(entities.map((e) => e.legal_name).filter(Boolean))];

  return (
    <div className="footer-extras">
      {credentials.length ? (
        <p>
          <span className="footer-extras-label">{t("site.footer.credentials")}</span>{" "}
          {credentials.map((c) => c.name).join(" · ")}
        </p>
      ) : null}
      {legal.length ? (
        <p>
          <span className="footer-extras-label">{t("site.footer.legalEntity")}</span>{" "}
          {legal.join(" · ")}
        </p>
      ) : null}
      <SocialRow onDark />
    </div>
  );
}
