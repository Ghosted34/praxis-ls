/**
 * ACTION CARDS (§7.3).
 *
 * "Create a proforma from this email." The card reads the thread and the record
 * it is bound to, works out whether it could actually be completed, and then
 * answers in one of exactly TWO ways — never a third:
 *
 *   ready       → the button opens the owning module's screen, prefilled.
 *   not ready   → "I can start a proforma but I need 2 things: Incoterm, Place
 *                 of delivery", with the reasons, and the button STILL SAYS
 *                 "Create proforma".
 *
 * §7.3, verbatim, on what it must not do: "guess a missing value, substitute a
 * default, or open a form silently missing fields. If the thread does not say
 * the incoterm, the card says the thread does not say the incoterm."
 *
 * ── THE THIRD WAY IS THE ONE PEOPLE COMPLAIN ABOUT ──────────────────────────
 *
 * A disabled button with no explanation is the third way. It is the default
 * thing a UI does with an incomplete form, it is cheap to build, and it is
 * useless: the operator can see that they cannot proceed and has no idea what
 * would let them. Everything below is arranged so that state cannot be
 * expressed — there is no `disabled` on the primary button, anywhere in this
 * file, and there should never be one.
 *
 * ── THE CARD DOES NOT CREATE THE RECORD ─────────────────────────────────────
 *
 * `read_only` comes back on every card and is asserted before the button
 * renders. The card deep-links into the module that owns the document, where it
 * gets that module's numbering, approval chain and audit trail. A card that
 * wrote directly would be a second way to create a proforma, and the second way
 * is always the one missing a control.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { fieldLabel, smartCell } from "@/lib/format";
import { currentLocale, tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/**
 * Where the button goes.
 *
 * The prefill rides in the query string because the target is a SCREEN, not an
 * API call — the operator lands in a form they can read and change before
 * anything is written. That is Q23's "always confirm" expressed as a URL.
 */
function targetHref(card: api.ActionCard): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(card.prefill || {})) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  q.set("from_mail", "1");
  const sep = card.target.includes("?") ? "&" : "?";
  return `${card.target}${sep}${q.toString()}`;
}

function Card({ card, language }: { card: api.ActionCard; language: "en" | "fr" }) {
  const [open, setOpen] = React.useState(false);
  const label = language === "fr" ? card.label_fr : card.label_en;

  return (
    <li className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {card.ready ? (
            <Pill tone="ok">{tr("Ready")}</Pill>
          ) : (
            <Pill tone="warn">
              {`${tr("Needs")} ${card.missing.length} ${card.missing.length === 1 ? tr("thing") : tr("things")}`}
            </Pill>
          )}
        </div>
        {/* Same label, same prominence, whether or not it is ready. The
            difference is what happens next, not whether the offer exists —
            and there is deliberately no `disabled` here, nor anywhere in this
            file. See the header. */}
        <Link to={targetHref(card)}>
          <Button size="sm" variant={card.ready ? "default" : "outline"}>
            {label}
          </Button>
        </Link>
      </div>

      {!card.ready && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {open ? tr("Hide what is missing") : tr("What is missing?")}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1">
              {card.missing.map((m) => (
                <li key={m.field} className="text-xs">
                  <span className="font-medium">{m.label}</span>
                  {/* The REASON, from the card's own declaration. "Not stated
                      in this thread" and "the dossier has no delivery place
                      yet" send the operator to two different places; a string
                      generated from the field name would say neither. */}
                  <span className="text-muted-foreground"> — {m.why}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {card.ready && Object.keys(card.prefill || {}).length > 0 && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {tr("Prefilled:")}{" "}
          {Object.entries(card.prefill)
            .slice(0, 4)
            .map(([k, v]) => `${fieldLabel(k)} ${smartCell(v)}`)
            .join(" · ")}
        </p>
      )}
    </li>
  );
}

export function ActionCards({
  threadId,
  language,
}: {
  threadId: string;
  /**
   * Which language to LABEL the cards in. Defaults to the workspace's, not to
   * English.
   *
   * Every card comes back with `label_en` and `label_fr`; the server has always
   * sent both. This prop defaulted to `"en"` and no caller passed it, so
   * `label_fr` was never once rendered and a French operator read English card
   * names in an otherwise French rail — a straightforward EN/FR parity miss
   * (§3.9) hidden behind a default that looked harmless.
   *
   * The workspace language rather than the thread's or the party's: these
   * labels name OUR modules to the person reading, not the counterparty. What
   * gets written TO the client resolves separately, through
   * `signature/language.resolveLanguage`, which is the one that must follow the
   * party's preference.
   */
  language?: "en" | "fr";
}) {
  const lang = language ?? (currentLocale().startsWith("fr") ? "fr" : "en");
  const res = useResource(() => api.listCards(threadId), [threadId]);

  if (res.loading) return <LoadingRow label={tr("Working out what you could do…")} />;
  if (res.error) return <ErrorState message={res.error} />;

  const cards = (res.data?.cards || []).filter((c) => c.read_only !== false);
  if (!cards.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {tr("Nothing to start from this thread yet — link it to a client or a file first.")}
      </p>
    );
  }

  return (
    <section aria-label={tr("Things you can start from this email")}>
      <ul className="space-y-1.5">
        {cards.map((c) => (
          <Card key={c.card} card={c} language={lang} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {tr("Each of these opens the module that owns the document. Nothing is created from here.")}
      </p>
    </section>
  );
}
