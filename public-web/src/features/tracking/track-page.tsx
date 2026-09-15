import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicApiError, messageFor, requestIdFor } from "@/lib/api";
import { trackShipment, type TrackingResult } from "@/lib/tracking-api";
import { tStatic } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { LoadingState } from "@/components/state";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackWidget } from "@/components/site/track-widget";
import { SectionHead } from "@/components/site/section-head";
import { StagedLines } from "@/components/ui/type";
import { BadgePill } from "@/components/ui/badge-pill";
import { BgMap } from "@/components/ui/bg-map";
import { SearchIcon, BoxIcon, ShieldIcon, DocumentIcon } from "@/components/ui/icons";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { TrackingView } from "./track-result";

/**
 * `/public/track` — the public lookup, and the page most visitors of this whole
 * app are actually here for.
 *
 * ── WHY THE REFERENCE LIVES IN THE URL ─────────────────────────────────────
 *
 * `?ref=…` IS the state, so the page is reproducible, shareable and
 * bookmarkable, and the Back button means something. Freight references get copied
 * out of WhatsApp messages and read aloud over the phone; a lookup whose result
 * cannot be expressed as a URL is a lookup that cannot be handed to the next
 * person. The hero widget on every other page writes the same parameter, so the
 * handoff from the homepage is a navigation rather than a second code path.
 *
 * ── WHAT THIS PAGE IS NOT ──────────────────────────────────────────────────
 *
 * It is not a carrier integration. `tracking_public.routes.js` reads the tenant's
 * own milestone ledger and computes a status from it — no project44, no carrier
 * portal, no scraping of a line's tracking site. Which is why the empty answer is
 * "we have no record of that reference" and never "your vessel is delayed": there
 * is no feed behind this page to support a claim like that. The milestone set is
 * exactly what the tenant's operations team marked client-visible, so the copy
 * says whose judgement produced this list rather than implying a global network.
 *
 * ── THE FIVE OUTCOMES, AND WHY NONE OF THEM SHARE A COMPONENT ──────────────
 *
 * idle · loading · found · not-found · rate-limited · failed. `doc/
 * PUBLIC_WEB_PLAN.md` §3.3 requires the middle four to be designed and, in
 * particular, requires not-found to be distinguishable from empty: "no shipment
 * matches that reference" and "this file has no visible stages yet" are
 * different facts with different next actions, and a client whose file was
 * opened this morning must not be told their reference is wrong.
 *
 * The rate limit gets its own outcome for the same reason. The lookup allows 30
 * attempts per 15 minutes per connection, an office behind one NAT address
 * shares that ceiling, and it is reached at 17:00 on a busy day. Folded into a
 * generic failure it would leave the twelfth colleague concluding their shipment
 * has vanished — so it is stated plainly, and it is the one failure that does
 * NOT offer a retry button, because retrying is exactly what it is asking the
 * visitor to stop doing.
 *
 * ── WHAT PR 4 CHANGED (guide §8.1) ────────────────────────────────────────
 *
 * The answer moved above the identity. It used to open with the reference as an
 * `<h2>` and put the status in a pill in the top-right corner — which is the
 * layout of an internal record, and it puts the thing the visitor already knows
 * above the thing they came to find out. `track-result.tsx` now leads with the
 * status at display size and demotes the reference to a definition list beneath
 * it, and the timeline became a spatial object rather than a bulleted list.
 *
 * The other half of §8.1 is these outcome screens. "A wrong reference is the
 * most common outcome on this page and it currently gets the least design": a
 * centred sentence and a link. They are plates now, at the same weight as the
 * answer, and each one states what happened, what it does NOT mean, and the
 * next action that is actually available.
 */
type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; view: TrackingResult }
  | { kind: "notfound" }
  | { kind: "limited" }
  | { kind: "error"; message: string; requestId: string | null };

export function TrackPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const ref = (params.get("ref") || "").trim();
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<State>({ kind: "idle" });

  useDocumentMeta({
    title: `${t("site.trackPage.title")} · ${t("site.hero.eyebrow")}`,
    description: t("site.trackPage.sub"),
  });

  React.useEffect(() => {
    if (!ref) {
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    trackShipment(ref)
      .then((view) => alive && setState({ kind: "found", view }))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound) {
          setState({ kind: "notfound" });
        } else if (e instanceof PublicApiError && e.isRateLimited) {
          setState({ kind: "limited" });
        } else {
          setState({
            kind: "error",
            message: messageFor(e, tStatic("errors.loadFailed")),
            requestId: requestIdFor(e),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [ref, nonce]);

  return (
    <PageShell label={t("site.trackPage.title")} footer>
      {/* The lane field behind the plate (§6.7), the same one the quote hero
          carries. Inline SVG, so it is part of the first paint rather than a
          texture that arrives over copy somebody is already reading. */}
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        {/* Positioned, so the copy sits above the map rather than under it. */}
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.track.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            title={
              /* `paintImmediately`, per PR 3's F-17. Every page in §8 opens with
                 a staged headline, and `.staged-word` starts at `opacity: 0` —
                 so on each of them the LCP element would be invisible for the
                 length of its own entrance. On THIS page that would be the
                 worst trade on the site: it is the one opened on mobile data by
                 somebody who wants one fact. The words still stagger; they are
                 legible while they do it. */
              <StagedLines paintImmediately text={t("site.trackPage.titleMain")} />
            }
            accent={t("site.trackPage.titleAccent")}
            lead={t("site.trackPage.sub")}
          />
          <div className="mt-7 max-w-2xl">
            <TrackWidget variant="page" onDark />
          </div>
        </PageContainer>
      </section>

      <Section>
        {state.kind === "idle" ? (
          <TrackIdle />
        ) : state.kind === "loading" ? (
          <TrackingSkeleton />
        ) : state.kind === "notfound" ? (
          <TrackNotFound reference={ref} />
        ) : state.kind === "limited" ? (
          <TrackLimited />
        ) : state.kind === "error" ? (
          <TrackError
            message={state.message}
            requestId={state.requestId}
            onRetry={() => setNonce((n) => n + 1)}
          />
        ) : (
          <TrackingView view={state.view} reference={ref} />
        )}
      </Section>
    </PageShell>
  );
}

/**
 * ── THE OUTCOME PLATE ──────────────────────────────────────────────────────
 *
 * One shape for the four non-answers, because they are one KIND of thing: the
 * page has something to say and it is not a shipment. What differs between them
 * is the words and the actions, not the composition — and giving each its own
 * layout was how the old version ended up with three of them as a centred
 * sentence and one as a card.
 *
 * `--mode` is deliberately never set on these. The mode colour states a fact
 * about a specific shipment, and none of these screens has one — see
 * `service-identity.ts` on why a positional colour must not appear where the
 * page states a fact.
 */
function Outcome({
  icon: Icon,
  eyebrow,
  title,
  children,
  actions,
  /**
   * `alert` on the failure only.
   *
   * These four screens replace an element that has already rendered, so a
   * visitor using a screen reader gets no navigation event to tell them the
   * page changed. `ErrorState` carried `role="alert"` for that reason and the
   * first draft of this plate dropped it — caught by the test that asserts it,
   * which is the argument for the test.
   *
   * It is NOT on the other three. `alert` is assertive: it interrupts whatever
   * is being read. A rate limit and a wrong reference are answers the visitor
   * asked for and will reach by reading on; interrupting for them is the
   * behaviour that makes people turn the screen reader's verbosity down.
   */
  announce = false,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  announce?: boolean;
}) {
  return (
    <section
      className="track-verdict max-w-2xl p-6 sm:p-8"
      role={announce ? "alert" : undefined}
    >
      <div className="relative">
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
        >
          <Icon size={20} />
        </span>
        <p className="micro mt-4">{eyebrow}</p>
        {/* An h2 at display size: these are answers, and they get the same
            weight the found answer gets. */}
        <h2 className="track-headline mt-2">{title}</h2>
        <div className="mt-4 space-y-3 text-muted-foreground">{children}</div>
        {actions ? (
          <div className="mt-6 flex flex-wrap gap-3">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * No reference typed yet.
 *
 * Not an error, and not a blank page either — the widget is above, and this is
 * the space between it and the footer. It says where the reference comes from,
 * which is the actual obstacle for a first-time visitor, and it does NOT
 * describe a reference FORMAT: the format is per tenant and per service, this
 * app has no access to their numbering scheme, and a made-up example is exactly
 * the kind of invented fact N12 forbids on the page a stranger trusts most.
 */
function TrackIdle() {
  const { t } = useTranslation();
  return (
    <Outcome
      icon={SearchIcon}
      eyebrow={t("site.track.kicker")}
      title={t("site.track.empty")}
      actions={
        <ButtonLink to={p("/portal/login")} variant="outline">
          {t("site.trackPage.openPortal")}
        </ButtonLink>
      }
    >
      <p>{t("site.track.hint")}</p>
      <p className="text-sm">{t("site.trackPage.whereRef")}</p>
    </Outcome>
  );
}

/**
 * The most common outcome on this page, and the one §8.1 says gets the least
 * design today.
 *
 * Three things it has to do at once, and the old one-line version did none of
 * them: echo back the reference that was actually tried (so somebody reading
 * over a shoulder can spot the transposed digit), say plainly that this is NOT
 * a statement about the cargo, and offer the two next steps that exist.
 *
 * The reference is echoed as text inside a `<p>` — React escapes it, so a
 * reference containing markup is displayed and never parsed. `break-words`
 * because a pasted reference can be longer than a phone is wide.
 */
function TrackNotFound({ reference }: { reference: string }) {
  const { t } = useTranslation();
  return (
    <Outcome
      icon={BoxIcon}
      eyebrow={t("site.trackPage.noMatch")}
      title={t("site.track.notFound")}
      actions={
        <>
          <ButtonLink to={p("/contact")}>{t("site.trackPage.askDesk")}</ButtonLink>
          <ButtonLink to={p("/portal/login")} variant="outline">
            {t("site.trackPage.openPortal")}
          </ButtonLink>
        </>
      }
    >
      {reference ? (
        <p className="num break-words rounded-[calc(var(--radius)-2px)] border border-border bg-muted px-3 py-2 text-sm text-foreground">
          {reference}
        </p>
      ) : null}
      <p>{t("site.track.notFoundHint")}</p>
      {/* The sentence that stops a wrong reference reading as bad news about
          the cargo. This is the whole reason not-found and empty are different
          screens. */}
      <p className="text-sm">{t("site.trackPage.notFoundNotLost")}</p>
    </Outcome>
  );
}

/** The rate limit. No retry button, deliberately: the answer to a rate limit is
 *  to stop, and a button labelled "try again" invites the opposite. */
function TrackLimited() {
  const { t } = useTranslation();
  return (
    <Outcome
      icon={ShieldIcon}
      eyebrow={t("site.trackPage.tooMany")}
      title={t("site.track.limited")}
      actions={
        <ButtonLink to={p("/portal/login")} variant="outline">
          {t("site.trackPage.openPortal")}
        </ButtonLink>
      }
    >
      <p>{t("site.track.limitedHint")}</p>
    </Outcome>
  );
}

/** Something else went wrong. The support reference is the point of this
 *  screen: it is what turns "it did not work" into something the desk can look
 *  up, and it is why the message is not swallowed into a generic apology. */
function TrackError({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Outcome
      icon={DocumentIcon}
      eyebrow={t("common.status")}
      /* A SHORT title, and the server's sentence beneath it.
         It was `errors.loadFailed` — a full sentence — at display size, with
         `message` under it. `messageFor` falls back to that same string when
         the server sends no specific one, so the plate read the identical
         sentence twice at two different sizes. Caught in a screenshot, which is
         the only place it is visible: both halves are correct on their own. */
      title={t("site.trackPage.failedTitle")}
      actions={<Button onClick={onRetry}>{t("common.retry")}</Button>}
      announce
    >
      {/*
        THE SENTENCE BENEATH THE TITLE, AND WHEN THERE IS ONE.

        This plate used to render `messageFor(...)` under a title that was
        itself `errors.loadFailed` — the same sentence twice at two sizes, which
        is what a screenshot of the real page showed. The fix is not to delete
        the body but to render it only when it ADDS something.

        `PublicApiError.isPublicMessage` passes a server sentence through for
        exactly three failures: offline, not-found and rate-limited. Two of
        those have their own screen above, so the one that reaches this plate is
        OFFLINE — and "you appear to be offline" is precisely the sentence worth
        printing, because it tells the visitor the problem is not the reference
        they typed. Everything else, a 500 included, becomes the dictionary's
        generic sentence: `api.ts` says why, and the detail goes to the console
        where it helps whoever is debugging and cannot leak a table name onto a
        public page.

        So the comparison is against the FALLBACK, not against the title. That
        is what distinguishes "the server explained" from "we filled in a
        default".
      */}
      {message && message !== tStatic("errors.loadFailed") ? (
        <p>{message}</p>
      ) : null}
      {requestId ? (
        <p className="text-sm">
          <span className="micro mr-1.5">{t("states.requestRef")}</span>
          <span className="num">{requestId}</span>
        </p>
      ) : null}
    </Outcome>
  );
}

/**
 * The loading state, in the shape of the answer.
 *
 * §3.3: "a skeleton of the real shape. Never a spinner on a blank page." The
 * blocks below are the verdict plate and four timeline rows, at the sizes the
 * real ones occupy, so the result lands in place instead of pushing the page
 * down under somebody's thumb on a phone. Updated for §8.1's layout — the tall
 * block at the top is the display-size status, which is what now dominates.
 */
function TrackingSkeleton() {
  return (
    <LoadingState label={tStatic("site.trackPage.loading")} className="space-y-8">
      <Card padded>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-10 w-72 max-w-full" />
        <Skeleton className="mt-4 h-5 w-56 max-w-full" />
        <div className="mt-6 flex flex-wrap gap-8 border-t border-border pt-5">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="mt-6 h-2 w-full rounded-full" />
      </Card>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 rounded-[var(--radius)] p-3.5">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-52 max-w-full" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </LoadingState>
  );
}
