import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getProposal,
  proposalPdfUrl,
  type ProposalPresentation,
} from "@/lib/proposal-api";
import { PublicApiError, messageFor } from "@/lib/api";
import { useBranding } from "@/app/branding";
import { getLang, setLang, tStatic } from "@/lib/i18n";
import { BrandGlyph, DownloadIcon, DocumentIcon } from "@/components/ui/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentMeta } from "@/lib/use-document-meta";

/**
 * `/public/proposals/:token` — a commercial proposal handed to a client.
 *
 * ── WHY THIS PAGE LOOKS LIKE A DOCUMENT AND NOT LIKE THE WEBSITE ───────────
 *
 * A proposal is read twice: once on a phone in a corridor, once printed for the
 * person who approves the spend. Both readers are looking at the same artefact,
 * because the server renders the PDF from the very object this page renders
 * (`proposal_public.service.js` builds `unit_price_display` and `total_display`
 * once and both outputs consume it). That shared source is the whole contract, and
 * it has one hard consequence for the frontend:
 *
 *   **This page formats nothing.** No currency rounding, no thousand separators,
 *   no date localisation, no table header we chose ourselves — `labels` arrives
 *   from the server already in the document's language. A client who prints the
 *   page and a client who downloads the file must not be able to find a
 *   disagreement between them, and every re-format here is one more chance to
 *   create one.
 *
 * The design language therefore stops at the page furniture: brand mark up top, a
 * hairline rule, `text-pretty` prose. The document body is a document.
 *
 * ── THE TOKEN IS THE CREDENTIAL ────────────────────────────────────────────
 *
 * Nothing on this page can be reached by guessing an id. `?token=` is what the
 * desk minted for sharing, it is what expires, and when the server says the link
 * is done — 404, `EXPIRED`, whatever — the page says "ask your contact for a
 * fresh link" and stops. No login prompt: a 401 redirect would send a client to a
 * staff sign-in screen from a document they were meant to read, which is the
 * failure `lib/api.ts` exists to make impossible.
 */
export function ProposalPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { branding } = useBranding();

  // The document's own language wins over the site's: `?lang=` on a shared link
  // is the reader asking for the other version of THIS file, and the server decides
  // what it can actually produce.
  const requested = String(params.get("lang") || getLang().toUpperCase());
  const lang: "EN" | "FR" = requested === "FR" ? "FR" : "EN";

  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "found"; p: ProposalPresentation }
    | { kind: "gone" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getProposal(decodeURIComponent(token), lang)
      .then((data) => {
        if (!alive) return;
        const p = data?.presentation;
        if (p) setState({ kind: "found", p });
        else setState({ kind: "gone" });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound)
          setState({ kind: "gone" });
        else
          setState({
            kind: "error",
            message: messageFor(e, tStatic("errors.loadFailed")),
          });
      });
    return () => {
      alive = false;
    };
  }, [token, lang]);

  const p = state.kind === "found" ? state.p : null;

  useDocumentMeta({
    title: p ? `${p.title} · ${p.document_number}` : t("site.proposals.title"),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="no-print border-b border-border">
        <div className="wrap flex items-center justify-between gap-4 py-3.5">
          <div className="flex items-center gap-2.5">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name || ""}
                className="h-7 w-auto max-w-40 object-contain object-left"
              />
            ) : (
              <>
                <BrandGlyph name={branding.name || "Praxis"} size={26} />
                <span className="font-display text-sm font-semibold tracking-tight">
                  {branding.name || "Praxis"}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 rounded-[calc(var(--radius)-2px)] border border-border p-0.5 sm:flex">
              {(["EN", "FR"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => {
                    // The URL is the state, so a forwarded link opens in the
                    // language the sender and receiver agreed on.
                    setParams(l === "FR" ? { lang: "FR" } : {});
                    setLang(l === "FR" ? "fr" : "en");
                  }}
                  className="h-8 rounded-[calc(var(--radius)-4px)] px-2.5 text-xs font-semibold data-[on=true]:bg-accent"
                  data-on={lang === l}
                >
                  {l === "FR" ? "FR" : "EN"}
                </button>
              ))}
            </div>
            {p && (
              <ButtonLink
                href={proposalPdfUrl(decodeURIComponent(token), p.language)}
                size="sm"
                className="inline-flex items-center gap-2"
              >
                <DownloadIcon size={15} />
                {t("site.proposals.download")}
              </ButtonLink>
            )}
          </div>
        </div>
      </header>

      <main className="wrap py-10 md:py-14">
        <div className="mx-auto max-w-4xl">
          {state.kind === "loading" ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-64" />
            </div>
          ) : state.kind === "error" ? (
            <ErrorState message={state.message} />
          ) : !p ? (
            <Card padded>
              <EmptyState
                title={t("site.proposals.unavailable")}
                hint={t("site.proposals.unavailableHint")}
                icon={<DocumentIcon size={22} />}
              />
            </Card>
          ) : (
            <ProposalDocument p={p} token={decodeURIComponent(token)} />
          )}
        </div>
      </main>
    </div>
  );
}

/** The document. Every string inside is the server's; this component only decides
 *  where the hairlines go. */
function ProposalDocument({
  p,
  token,
}: {
  p: ProposalPresentation;
  token: string;
}) {
  const { t } = useTranslation();
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const sections = Array.isArray(p.sections) ? p.sections : [];

  return (
    <article className="lux-card p-6 md:p-10 print:border-0 print:bg-transparent print:p-0">
      <header className="border-b border-border pb-6">
        <p className="eyebrow">{p.document_number}</p>
        <h1 className="mt-3 text-h1 font-semibold leading-[1.08] tracking-tight text-balance">
          {p.title}
        </h1>
        <dl className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="micro">{t("site.proposals.client")}</dt>
            <dd className="mt-1 font-medium">{p.client_name}</dd>
          </div>
          <div>
            <dt className="micro">{t("site.proposals.route")}</dt>
            <dd className="mt-1">{p.route}</dd>
          </div>
        </dl>
      </header>

      {sections.map((s) => (
        <section
          key={s.key}
          className="border-b border-border py-6 last:border-b-0"
        >
          <h2 className="text-title font-semibold tracking-tight">{s.title}</h2>
          <p className="mt-2 whitespace-pre-wrap text-pretty text-[0.9375rem] leading-7 text-muted-foreground">
            {s.body}
          </p>
        </section>
      ))}

      {lines.length > 0 && (
        <section className="pt-6">
          <div className="-mx-6 overflow-x-auto px-6 md:-mx-10 md:px-10">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("site.proposals.lines")}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 text-left font-semibold">
                    {p.labels.service}
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2 text-right font-semibold"
                  >
                    {p.labels.quantity}
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2 text-right font-semibold"
                  >
                    {p.labels.unit}
                  </th>
                  <th
                    scope="col"
                    className="py-2 pl-4 text-right font-semibold"
                  >
                    {p.labels.total}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr
                    key={`${l.label}-${i}`}
                    className="border-b border-border/60"
                  >
                    <td className="py-2.5 pr-4 align-top">{l.label}</td>
                    <td className="num px-2 py-2.5 text-right align-top">
                      {l.quantity}
                    </td>
                    <td className="num px-2 py-2.5 text-right align-top">
                      {l.unit_price_display}
                    </td>
                    <td className="num py-2.5 pl-4 text-right align-top font-semibold">
                      {l.total_display}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="no-print mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <p className="text-xs text-muted-foreground">
          {t("site.proposals.expireNote")}
        </p>
        <div className="flex gap-2">
          {/* A `Button`, not a `ButtonLink`: printing is an action the page takes,
              not a destination, and an anchor whose href does not exist is what a
              keyboard user activates into a jump to the top of the document. */}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            {t("site.proposals.print")}
          </Button>
          <ButtonLink href={proposalPdfUrl(token, p.language)} size="sm">
            {t("site.proposals.download")}
          </ButtonLink>
        </div>
      </footer>
    </article>
  );
}
