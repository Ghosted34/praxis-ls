import * as React from "react";
import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { BgMap } from "@/components/ui/bg-map";
import { StagedLines, PullQuote } from "@/components/ui/type";
import { EsgTriptych } from "@/components/site/esg-triptych";
import { LeaderCard, LeaderGrid } from "@/components/site/leader-card";
import { EntityNetwork } from "@/components/site/entity-network";
import { ClientBand, CarrierMarks, CredentialStrip } from "@/components/site/proof-bands";
import { Timeline } from "@/components/site/timeline";
import { GlobeIcon, ShieldIcon } from "@/components/ui/icons";
import { getLang } from "@/lib/i18n";
import { afterPaint } from "@/lib/after-paint";
import {
  EMPTY_ABOUT,
  EMPTY_PROOF,
  getPublicAbout,
  getPublicProof,
  hasEsg,
  listPublicEntities,
  type PublicAbout,
  type PublicEntity,
  type PublicProof,
} from "@/lib/site-api";

/**
 * `/about` — guide §9.1, and the page the whole of §9 hangs off.
 *
 * ── THE ROUTE DID NOT EXIST, AND NEITHER DID THE LINKS ────────────────────
 *
 * §9.1's first bullet: "New route, and `About` into the header nav and the
 * footer — it is absent from both today." Both are added in the same change,
 * because a route nothing links to is a route nobody finds. `site.footer.about`
 * has been sitting unused in the dictionary since PR 1.
 *
 * ── THE STRUCTURE IS §6.7's TWO TIERS, IN ORDER ───────────────────────────
 *
 * The group story first — who this company is — then the entities, which is
 * where a group's story stops being one company's. §6.7 chose that split
 * deliberately ("a group's mission does not belong to a subsidiary, and a
 * subsidiary's coverage does not belong to the group") and the page reads in
 * that order for the same reason.
 *
 * ── EVERYTHING BELOW THE HERO IS READ AFTER PAINT ─────────────────────────
 *
 * Three reads — the story, the entities, the proof — issued together behind
 * `after-paint`, none blocking the others. The hero paints from the dictionary
 * and the tenant's branding, which are already in the bundle, so nothing on
 * screen is waiting for a network answer.
 *
 * Every failure is the empty answer, which for this page means a band that is
 * not drawn. That is not an error state hidden: a tenant who has written no
 * story, one without the `website` package and a fetch that failed are three
 * different facts server-side and one fact here, and a marketing page that says
 * "could not load our history" is worse in all three.
 *
 * ── THE PAGE HAS A REAL EMPTY STATE, AND IT IS THE HERO ───────────────────
 *
 * A brand-new tenant has no story, no entities and no partners: every band
 * returns null and the page is a hero over a footer. So the hero carries the
 * one sentence that is true for every tenant — their own name and what they do
 * — and the page is short rather than broken. Nothing says "coming soon" (N12).
 */

/** The three reads, in parallel, after paint. */
function useAboutData() {
  const lang = getLang();
  const [about, setAbout] = React.useState<PublicAbout>(EMPTY_ABOUT);
  const [entities, setEntities] = React.useState<PublicEntity[]>([]);
  const [proof, setProof] = React.useState<PublicProof>(EMPTY_PROOF);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      const signal = controller.signal;
      /* Not chained. They answer three different questions and none is a
         precondition of another: a tenant may have a story and no entities, or
         credentials and no story. Chaining would make the slowest read the
         page's speed and one failure the page's failure. */
      getPublicAbout({ lang, signal }).then((a) => alive && setAbout(a));
      listPublicEntities({ signal })
        .then((rows) => alive && setEntities(Array.isArray(rows) ? rows : []))
        .catch(() => {
          /* silent-catch: PRESENTATION. `public_enabled` is off until somebody
             turns it on (13787), so an empty answer is the NORMAL one and marks
             nothing. doc/ERROR_HANDLING.md */
        });
      getPublicProof({ signal }).then((p) => alive && setProof(p));
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, [lang]);

  return { about, entities, proof };
}

export function AboutPage() {
  const { t } = useTranslation();
  const { about, entities, proof } = useAboutData();

  useDocumentMeta({
    title: t("site.about.title"),
    description: t("site.about.sub"),
  });

  /* The CEO message is the page's anchor (§9.1) and it is the FIRST group
     leader — `sort_order` is what the settings screen drags, so the tenant
     decides who that is rather than this file guessing at a job title in two
     languages. The rest of the tier renders below, in the same renderer. */
  const [anchor, ...others] = about.leaders;

  return (
    <PageShell label={t("site.about.title")} footer>
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.about.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            /* F-17: this is the LCP element on this route. `paintImmediately`
               paints the words at full opacity and staggers only the rise, so
               the entrance costs the metric nothing. Every §8 page learned this
               the expensive way. */
            title={<StagedLines paintImmediately text={t("site.about.titleMain")} />}
            accent={t("site.about.titleAccent")}
            lead={about.summary || t("site.about.sub")}
          />
          {/* Two facts, when the tenant has recorded them. Founded and
              headquartered are what a procurement officer checks first, and
              they are the two `site_about` fields that are single values rather
              than prose. */}
          {about.foundedYear || about.headquarters ? (
            <dl className="about-facts">
              {about.foundedYear ? (
                <div>
                  <dt>{t("site.about.founded")}</dt>
                  <dd>{about.foundedYear}</dd>
                </div>
              ) : null}
              {about.headquarters ? (
                <div>
                  <dt>{t("site.about.hq")}</dt>
                  <dd>{about.headquarters}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </PageContainer>
      </section>

      {/* ── the group story ───────────────────────────────────────────── */}

      {about.mission || about.vision || about.principles.length ? (
        <Section eyebrow={t("site.about.storyKicker")} title={t("site.about.storyTitle")}>
          {about.mission || about.vision ? (
            <div className="grid gap-8 lg:grid-cols-2">
              {about.mission ? (
                /* A pull-quote, not a paragraph under a heading. §1.5: no prose
                   block on a marketing page exceeds 90 words unbroken, and a
                   mission statement is the one sentence on this page meant to
                   be read AS a statement rather than as copy. */
                <PullQuote cite={t("site.about.mission")}>{about.mission}</PullQuote>
              ) : null}
              {about.vision ? (
                <PullQuote cite={t("site.about.vision")}>{about.vision}</PullQuote>
              ) : null}
            </div>
          ) : null}

          {about.principles.length ? (
            <>
              <p className="micro mt-10">{t("site.about.principles")}</p>
              <ul className="principle-grid">
                {about.principles.map((principle) => (
                  <li key={principle.label} className="principle">
                    <h3>{principle.label}</h3>
                    {principle.text ? <p>{principle.text}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Section>
      ) : null}

      {/* ── the CEO message: the page's anchor ────────────────────────── */}

      {anchor ? (
        <Section
          variant="muted"
          divided
          eyebrow={t("site.about.messageKicker")}
          title={t("site.about.messageTitle")}
        >
          <LeaderCard leader={anchor} featured />
        </Section>
      ) : null}

      {/* ── time as depth ─────────────────────────────────────────────── */}

      {about.timeline.length ? (
        <Section
          divided
          eyebrow={t("site.about.timelineKicker")}
          title={t("site.about.timelineTitle")}
        >
          <Timeline entries={about.timeline} />
        </Section>
      ) : null}

      {/* ── the rest of the group's leadership ────────────────────────── */}

      {others.length ? (
        <Section
          divided
          eyebrow={t("site.about.peopleKicker")}
          title={t("site.about.peopleTitle")}
        >
          <LeaderGrid leaders={others} />
        </Section>
      ) : null}

      {/* ── the entities, as a network ────────────────────────────────── */}

      {entities.length ? (
        <Section
          divided
          eyebrowIcon={GlobeIcon}
          eyebrow={t("site.about.networkKicker")}
          title={t("site.about.networkTitle")}
          lead={t("site.about.networkLead")}
        >
          <EntityNetwork entities={entities} />
        </Section>
      ) : null}

      {/* ── ESG ──────────────────────────────────────────────────────────
          D-16: `EsgTriptych` takes `{esg}` and knows nothing about a page, so
          §9.1 mounts the IDENTICAL component §8.4 put on the services index,
          with no change to it at all. Two mounts of one component, not two
          components. */}
      {hasEsg(about.esg) ? (
        <Section
          divided
          eyebrow={t("site.esg.kicker")}
          title={t("site.esg.title")}
          accent={t("site.esg.titleAccent")}
        >
          <EsgTriptych esg={about.esg} />
        </Section>
      ) : null}

      {/* ── §9.4: three claims, three treatments ──────────────────────── */}

      <CarrierMarks proof={proof} />

      {proof.credentials.length || proof.partners.some((p) => p.kind !== "carrier") ? (
        <Section
          divided
          eyebrowIcon={ShieldIcon}
          eyebrow={t("site.about.proofKicker")}
          title={t("site.about.proofTitle")}
        >
          <CredentialStrip proof={proof} />
          <ClientBand proof={proof} />
        </Section>
      ) : null}
    </PageShell>
  );
}
