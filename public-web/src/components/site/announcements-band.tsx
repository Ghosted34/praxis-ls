import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import {
  listAnnouncements,
  insightSlug,
  insightTitle,
  insightExcerpt,
  pinLive,
  type InsightCard,
} from "@/lib/insights-api";
import { useInView } from "@/components/ui/reveal";
import { motionReduced } from "@/lib/motion";
import { afterPaint } from "@/lib/after-paint";
import { ArrowRightIcon } from "@/components/ui/icons";
import { p } from "@/lib/base-path";
import { cn } from "@/lib/cn";

/**
 * The announcements band — directly under the hero (Q17: "around the hero
 * section", "more than important").
 *
 * ── IT IS ABSENT WHEN EMPTY, AND THAT IS THE FEATURE ──────────────────────
 *
 * No "no announcements yet" state, no skeleton that resolves to nothing, no
 * placeholder. §7.2 is explicit and it is the same rule N12 applies everywhere
 * on this site: a band that announces it has nothing to announce is worse than
 * no band. Most tenants will never pin anything, and their homepage should look
 * like a homepage that was designed without this band rather than one with a
 * hole in it.
 *
 * So: `null` until the read lands, `null` if the read fails, `null` if nothing
 * is pinned. The only thing that renders it is a live pin.
 *
 * ── WHY THIS IS NOT A MARQUEE, THOUGH IT MOVES ────────────────────────────
 *
 * A marquee is the obvious shape and every part of it is wrong here:
 *
 *   · It duplicates its content to fake a seamless loop, which puts every link
 *     in the tab order TWICE and reads every headline to a screen reader twice.
 *   · It cannot be stopped, so a reader who is slower than the animation never
 *     finishes a sentence.
 *   · It has no relationship to focus, so tabbing into it fights it.
 *
 * What this does instead is drive the container's own `scrollLeft`. The DOM
 * holds each announcement EXACTLY ONCE, so the tab order is the list and the
 * accessibility tree is the list. The browser's native scrolling does the rest:
 * tabbing to a link off the right-hand edge scrolls it into view for free, and
 * a trackpad swipe or a two-finger drag works because it is a real scroller,
 * not a transform.
 *
 * It stops for everything that means somebody is reading it: hover, focus
 * anywhere inside, a hidden tab, the band leaving the viewport, and any scroll
 * the visitor performs themselves (which then holds it for a few seconds — a
 * band that fights the hand pushing it is worse than one that does not move).
 *
 * ── aria-live="off", DELIBERATELY ──────────────────────────────────────────
 *
 * §7.2 names it. This is ambient, not urgent: the content does not change while
 * the page is open, and a polite live region on a band that scrolls would have
 * a screen reader announcing headlines the reader did not ask for. The pins are
 * a list, and a list is what is exposed.
 */

/** How fast the band drifts, in CSS pixels per second. Slow enough to read a
 *  headline as it passes; a band that has to be chased is a band nobody
 *  reads. */
const DRIFT_PX_PER_SEC = 22;

/** How long a visitor's own scroll holds the drift off. Long enough to finish
 *  reading what they scrolled to, short enough that an accidental brush does
 *  not stop the band for the rest of the visit. */
const HOLD_MS = 4000;

export function AnnouncementsBand() {
  const { t } = useTranslation();
  const lang = getLang();
  const [pinned, setPinned] = React.useState<InsightCard[] | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    /* AFTER THE PAINT, not on mount.
 
       This band is the second thing on the page and it is still not what the
       visitor is waiting for — the hero is, and it is the LCP element. A fetch
       issued during the critical path competes for the same connection on the
       metered link this app's budget exists for. The band renders nothing until
       the answer lands either way (see above), so the only thing deferring
       costs is a few hundred milliseconds before a band appears that most
       tenants do not have at all. */
    const release = afterPaint(() => {
      listAnnouncements({ signal: ac.signal })
        .then((res) => {
        // `pinLive` re-checks the expiry the SQL already checked. A payload can
        // outlive its pin in a cache or a service worker, and drawing a notice
        // whose date has passed is precisely the staleness 13784's timestamp
        // exists to prevent.
          setPinned((res.pinned || []).filter(pinLive));
        })
        // Every failure is the same answer: no band. A tenant without the
        // `website` package answers FEATURE_DISABLED here, which is a
        // configuration state and not an outage.
        .catch(() => setPinned([]));
    });
    return () => {
      release();
      ac.abort();
    };
  }, []);

  if (!pinned || pinned.length === 0) return null;
  return <Band items={pinned} lang={lang} t={t} />;
}

function Band({
  items,
  lang,
  t,
}: {
  items: InsightCard[];
  lang: string;
  t: (key: string) => string;
}) {
  const [hostRef, visible] = useInView<HTMLDivElement>();
  const trackRef = React.useRef<HTMLUListElement | null>(null);
  const still = motionReduced();

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track || still || !visible) return undefined;

    let raf = 0;
    let last = 0;
    /** Wall-clock time until which the visitor's own input owns the scroller. */
    let heldUntil = 0;
    let paused = false;
    // Sub-pixel travel is accumulated here rather than written to scrollLeft:
    // the property rounds to an integer, so 22 px/s at 60 Hz would round to
    // zero every frame and the band would never move at all.
    let offset = track.scrollLeft;

    const hold = () => {
      heldUntil = Date.now() + HOLD_MS;
      offset = track.scrollLeft;
    };
    const pause = () => {
      paused = true;
    };
    const resume = () => {
      paused = false;
      offset = track.scrollLeft;
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const room = track.scrollWidth - track.clientWidth;
      // Nothing to drift through. Five cards on a wide screen fit, and a band
      // that jitters against its own end stop is worse than a still one.
      if (room > 2 && !paused && !document.hidden && Date.now() >= heldUntil) {
        offset += DRIFT_PX_PER_SEC * dt;
        if (offset >= room) {
          // Back to the beginning, smoothly. `scroll-behavior: smooth` on the
          // element would fight every frame of the drift, so the return is an
          // explicit smooth scroll and the drift resumes from zero.
          offset = 0;
          track.scrollTo({ left: 0, behavior: "smooth" });
          // Hold briefly so the smooth scroll is not overwritten mid-flight.
          heldUntil = Date.now() + 700;
        } else {
          track.scrollLeft = offset;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    // Everything that means somebody is reading, or touching, this band.
    track.addEventListener("pointerenter", pause);
    track.addEventListener("pointerleave", resume);
    track.addEventListener("focusin", pause);
    track.addEventListener("focusout", resume);
    track.addEventListener("wheel", hold, { passive: true });
    track.addEventListener("touchstart", hold, { passive: true });
    // A backgrounded tab still fires rAF in some browsers; `document.hidden` is
    // checked in the frame, and this makes the resume immediate rather than
    // waiting for the next drift step.
    document.addEventListener("visibilitychange", resume);

    last = performance.now();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      track.removeEventListener("pointerenter", pause);
      track.removeEventListener("pointerleave", resume);
      track.removeEventListener("focusin", pause);
      track.removeEventListener("focusout", resume);
      track.removeEventListener("wheel", hold);
      track.removeEventListener("touchstart", hold);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [still, visible]);

  return (
    <section
      ref={hostRef}
      aria-labelledby="announcements-heading"
      className="announce-band"
    >
      <div className="wrap flex flex-col gap-3 py-5 md:flex-row md:items-center md:gap-6">
        <div className="flex shrink-0 items-center gap-3">
          <h2 id="announcements-heading" className="micro whitespace-nowrap">
            {t("site.announce.eyebrow")}
          </h2>
          <span aria-hidden className="announce-rule hidden md:block" />
        </div>

        <ul
          ref={trackRef}
          /* Ambient, never urgent — §7.2. The content does not change while the
             page is open, so a polite live region would only make a screen
             reader read headlines nobody asked for. */
          aria-live="off"
          className={cn(
            "announce-track flex min-w-0 gap-3",
            // Under reduced motion the band is not a scroller at all: it wraps
            // into a static list. Not a slower drift — no drift, and no
            // horizontal scroll to have to operate.
            still ? "flex-wrap" : "overflow-x-auto",
          )}
        >
          {items.map((a) => {
            const slug = insightSlug(a, lang);
            const title = insightTitle(a, lang);
            const excerpt = insightExcerpt(a, lang);
            return (
              <li key={`${a.slug_fr ?? ""}${a.slug_en ?? ""}${title}`} className="announce-item">
                {/* An announcement with no slug in either language has no
                    detail page to open. It is still worth showing — the
                    headline IS the notice — so it renders as text rather than
                    as a link that goes nowhere. */}
                {slug ? (
                  <Link
                    to={p(`/insights/${encodeURIComponent(slug)}`)}
                    className="announce-link"
                  >
                    <span className="announce-title">{title}</span>
                    {excerpt ? (
                      <span className="announce-excerpt">{excerpt}</span>
                    ) : null}
                  </Link>
                ) : (
                  <span className="announce-link">
                    <span className="announce-title">{title}</span>
                    {excerpt ? (
                      <span className="announce-excerpt">{excerpt}</span>
                    ) : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* "View more" goes to the announcements list — PR 4 §8.6 gives that
            route its own page; until then `/insights` is where every published
            announcement already is, because an announcement IS an article. The
            link is therefore correct today and gains a narrower destination
            later rather than being a dead end now. */}
        <Link to={p("/insights")} className="announce-more shrink-0">
          {t("site.announce.more")}
          <ArrowRightIcon size={14} className="ml-1.5" />
        </Link>
      </div>
    </section>
  );
}
