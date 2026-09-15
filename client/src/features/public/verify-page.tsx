/**
 * The public verification portal — what a stranger holding a printed document
 * sees when they scan its QR or type the code beneath it.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §5.4, §5.7.
 *
 * ── Who this page is for ───────────────────────────────────────────────────
 * Not a user. A customs officer at a border post, a supplier's accounts clerk,
 * a buyer's lawyer three years from now. They have no account, no training and
 * no reason to trust us — so the page answers in sentences, states the two
 * verdicts separately, and never shows an enum.
 *
 * ── Three rules it keeps ───────────────────────────────────────────────────
 * 1. THE SUMMARY IS THE DOCUMENT AS SIGNED. It comes from the API's
 *    `as_signed`, which the server renders from the payload frozen at signing
 *    time. This page must never fetch the live record to fill a gap: a March
 *    waybill scanned in September would then show September's figures to
 *    whoever holds March's paper.
 * 2. THE CARDS ARE THE VAULT'S CARDS. `SignatureCard` is imported from
 *    `features/vault/signature-cards` — the same component the sender, the
 *    signing page and Settings → Signatures render. A second grid here is how
 *    a tenant ends up renaming a card in one place and not the other.
 * 3. NOTHING IS RENDERED THAT THE SERVER DID NOT RESOLVE. No doc-type
 *    branching, no fallback that dumps whatever fields came back. An
 *    unregistered doc type shows the verdicts and the signer, and that is the
 *    correct amount.
 *
 * ── Language ───────────────────────────────────────────────────────────────
 * FR by default, EN on `?lang=en` (§3.14). Deliberately NOT the staff app's
 * i18n: that resolves from `localStorage["praxis.lang"]`, which is the
 * OPERATOR's preference on the operator's machine and has nothing to do with
 * the stranger reading this page. The API resolves the language and returns
 * every server-side string already translated; the chrome below is the rest.
 */

import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { tenant } from "@/lib/api-client";
import { useBranding } from "@/app/branding/branding-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout, type CalloutTone } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/states";
import { SignatureCard } from "@/features/vault/signature-cards";

type Lang = "fr" | "en";

type Verdict = {
  key: string;
  state: "PASS" | "FAIL" | "UNKNOWN";
  label: string;
  message: string;
};

type SummaryField = { key: string; label: string; value: string };

type Payload = {
  status: "VALID" | "AMENDED" | "REVOKED";
  language: Lang;
  // The code was minted in the tenant's test environment (sandbox), not live.
  // Set from the printed URL's `?e=sandbox`, baked in when the PDF was
  // rendered; a live document lacks it. The banner below tells the reader.
  test_environment?: boolean;
  verdicts: Verdict[];
  signature: {
    verify_code: string;
    doc_type: string;
    content_hash_short: string;
    revoked_at: string | null;
    revoke_reason: string | null;
    card: {
      preset_code: string;
      label: string;
      blurb: string | null;
      tier: string | null;
      assurance_level: string;
      visual_mark: string;
    } | null;
    signed: {
      name: string;
      role: string | null;
      party: string;
      identity_source: string;
      identity_words: string;
      method: string;
      reason: string | null;
      signed_at: string;
      ip: string;
      device: string;
    };
  };
  as_signed: {
    doc_type: string;
    title: string;
    fields: SummaryField[];
    detail: { label: string; value: string } | null;
  } | null;
  changes: { field: string; label: string; before: string | null; after: string | null }[];
  issuer: {
    legal_name: string;
    trading_name: string | null;
    rccm: string | null;
    niu: string | null;
    address: string | null;
  } | null;
};

/**
 * Every word this page says on its own behalf, in both languages.
 *
 * Written out rather than assembled from fragments: a legal-adjacent page is
 * read by people who will quote it, and a sentence stitched from interpolated
 * clauses cannot be checked by the person who has to stand behind it.
 */
const COPY = {
  fr: {
    title: "Vérification de document",
    lead: "Ce document porte une signature électronique. Voici ce qu'elle atteste.",
    testEnvTitle: "Document d'environnement de test",
    testEnvBody:
      "Ce code a été émis dans l'environnement de test de l'émetteur. Le contrôle ci-dessous est authentique, mais le document lui-même n'est pas un document réel.",
    enterTitle: "Vérifier un document",
    enterLead:
      "Saisissez le code à douze caractères imprimé sous le QR code du document.",
    codeLabel: "Code de vérification",
    submit: "Vérifier",
    checking: "Vérification…",
    notFoundTitle: "Aucune vérification ne correspond à ce code",
    notFoundBody:
      "Vérifiez les douze caractères imprimés sous le QR code. Si le code est correct et que cette page persiste, contactez directement l'émetteur du document.",
    revokedTitle: "Cette signature a été révoquée",
    revokedBody:
      "Elle a bien été apposée, puis retirée par l'émetteur. Le document ne doit plus être considéré comme signé.",
    amendedTitle: "Ce document a changé depuis sa signature",
    amendedBody:
      "La signature ci-dessous est authentique, mais elle ne couvre plus ce que le document dit aujourd'hui. Ce qui a changé est indiqué ci-dessous.",
    revokedReasonLabel: "Motif de la révocation",
    validTitle: "Signature vérifiée",
    signatureH: "La signature",
    signedBy: "Signé par",
    onBehalf: "Pour le compte de",
    internal: "l'entreprise émettrice",
    external: "la contrepartie",
    method: "Méthode",
    reason: "Motif",
    signedAt: "Date de signature",
    network: "Réseau",
    device: "Appareil",
    asSigned: "Le document tel que signé",
    asSignedNote:
      "Ces informations sont figées au moment de la signature. Elles ne changent jamais, même si le dossier évolue ensuite.",
    changed: "Ce qui a changé depuis",
    noSummary:
      "Ce type de document ne publie pas de résumé. La signature et les contrôles ci-dessus restent valables.",
    issuer: "Émetteur",
    code: "Code",
    contentHash: "Empreinte du contenu",
    howTitle: "Comment cette vérification fonctionne",
    howLink: "Comment cela est-il vérifié ?",
    close: "Fermer",
    identityH: "Identité",
    identityB:
      "Qui a signé, et comment cette personne l'a prouvé. Un nom confirmé par un compte authentifié et un nom simplement déclaré sont deux affirmations différentes, et cette page indique laquelle vous lisez.",
    integrityH: "Intégrité",
    integrityB:
      "Deux empreintes, deux questions. La première porte sur le contenu du document — les montants, les parties, les références — et permet de savoir s'il a été modifié après signature. La seconde porte sur le fichier lui-même et confirme qu'il s'agit exactement du fichier émis.",
    traceH: "Traçabilité",
    traceB:
      "Chaque signature et chaque vérification sont inscrites dans un registre en ajout seul, conservé par l'émetteur. Votre consultation d'aujourd'hui en fait partie.",
    privacy:
      "Les vérifications de ce document sont enregistrées, y compris l'adresse réseau d'où elles proviennent.",
    langSwitch: "English",
  },
  en: {
    title: "Document verification",
    lead: "This document carries an electronic signature. Here is what it attests to.",
    testEnvTitle: "Test-environment document",
    testEnvBody:
      "This code was minted in the issuer's test environment. The check below is genuine, but the document itself is not a real document.",
    enterTitle: "Verify a document",
    enterLead:
      "Enter the twelve-character code printed beneath the QR code on the document.",
    codeLabel: "Verification code",
    submit: "Verify",
    checking: "Checking…",
    notFoundTitle: "No verification matches that code",
    notFoundBody:
      "Check the twelve characters printed beneath the QR code. If the code is right and this page persists, contact the issuer of the document directly.",
    revokedTitle: "This signature has been revoked",
    revokedBody:
      "It was genuinely applied, and then withdrawn by the issuer. The document should no longer be treated as signed.",
    amendedTitle: "This document has changed since it was signed",
    amendedBody:
      "The signature below is genuine, but it no longer covers what the document says today. What changed is listed below.",
    revokedReasonLabel: "Reason for revocation",
    validTitle: "Signature verified",
    signatureH: "The signature",
    signedBy: "Signed by",
    onBehalf: "On behalf of",
    internal: "the issuing company",
    external: "the counterparty",
    method: "Method",
    reason: "Reason",
    signedAt: "Signed",
    network: "Network",
    device: "Device",
    asSigned: "The document as signed",
    asSignedNote:
      "These details were frozen at the moment of signing. They never change, even if the file moves on afterwards.",
    changed: "What has changed since",
    noSummary:
      "This kind of document does not publish a summary. The signature and the checks above still stand.",
    issuer: "Issued by",
    code: "Code",
    contentHash: "Content fingerprint",
    howTitle: "How this verification works",
    howLink: "How is this verified?",
    close: "Close",
    identityH: "Identity",
    identityB:
      "Who signed, and how they proved it. A name confirmed by an authenticated account and a name simply declared are two different claims, and this page tells you which one you are reading.",
    integrityH: "Integrity",
    integrityB:
      "Two fingerprints, two questions. The first covers the document's contents — the amounts, the parties, the references — and answers whether it changed after signing. The second covers the file itself and confirms it is the exact file that was issued.",
    traceH: "Traceability",
    traceB:
      "Every signature and every verification is written to an append-only record kept by the issuer. Your visit today is part of it.",
    privacy:
      "Verifications of this document are logged, including the network address they came from.",
    langSwitch: "Français",
  },
} as const;

/**
 * Semantic tokens, never a raw palette colour: a `text-emerald-600` stays
 * emerald when the tenant's brand is teal, and this page is the tenant's face
 * to a stranger (client/scripts/check-palette.mjs enforces it).
 */
const VERDICT_INK: Record<string, string> = {
  PASS: "text-ok",
  FAIL: "text-bad",
  UNKNOWN: "text-warn",
};

/*
 * A glyph AND a word, never a glyph alone. The message beside it carries the
 * verdict in prose, so a reader who cannot distinguish the marks — colour-blind,
 * or holding a monochrome printout of this page — loses nothing.
 */
const VERDICT_MARK: Record<string, string> = {
  PASS: "✓",
  FAIL: "✕",
  UNKNOWN: "?",
};

/** Own-properties only — the same guard `signature-vocab.look()` exists for. */
function pick<T>(map: Record<string, T>, key: unknown, fallback: T): T {
  if (typeof key !== "string") return fallback;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function formatWhen(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(d);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-border/60 py-2 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * The two verdicts, on separate lines and never merged into one badge.
 *
 * A document can pass one and fail the other, and that pair is informative
 * rather than contradictory: "this is our file, and the record behind it has
 * moved on" is a real state a reader needs to be able to see.
 */
function Verdicts({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <div className="space-y-2">
      {verdicts.map((v) => (
        <div
          key={v.key}
          className="flex items-start gap-3 rounded-lg border border-border p-3"
        >
          <span aria-hidden className={pick(VERDICT_INK, v.state, "text-muted-foreground")}>
            {pick(VERDICT_MARK, v.state, "?")}
          </span>
          <div className="min-w-0">
            <div className="text-micro uppercase tracking-wide text-muted-foreground">
              {v.label}
            </div>
            <p className="text-sm">{v.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The anti-fraud explainer (§5.4). Written for an auditor, not an engineer. */
function HowDialog({
  open,
  onClose,
  c,
}: {
  open: boolean;
  onClose: () => void;
  c: (typeof COPY)[Lang];
}) {
  return (
    <Dialog open={open} onClose={onClose} title={c.howTitle} size="lg">
      <div className="space-y-4">
        {[
          [c.identityH, c.identityB],
          [c.integrityH, c.integrityB],
          [c.traceH, c.traceB],
        ].map(([h, b]) => (
          <section key={h}>
            <h3 className="text-sm font-semibold">{h}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{b}</p>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Manual entry — the `/verify` route, and where a 404 lands you. */
function CodeEntry({
  c,
  initial,
  onSubmit,
  busy,
}: {
  c: (typeof COPY)[Lang];
  initial: string;
  onSubmit: (code: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <form
      className="lux-card space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <h2 className="text-title font-semibold">{c.enterTitle}</h2>
      <p className="text-sm text-muted-foreground">{c.enterLead}</p>
      <label className="block text-sm font-medium" htmlFor="verify-code">
        {c.codeLabel}
      </label>
      <Input
        id="verify-code"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder="A4B7-K92M-XQ1P"
        onChange={(e) => setValue(e.target.value)}
        className="font-mono uppercase"
      />
      <Button type="submit" loading={busy} disabled={!value.trim()}>
        {c.submit}
      </Button>
    </form>
  );
}

export function VerifyPage() {
  const { code: routeCode } = useParams();
  const [query, setQuery] = useSearchParams();
  const lang: Lang = query.get("lang") === "en" ? "en" : "fr";
  // The printed URL from a sandbox-signed document carries `?e=sandbox`
  // (services/signatures/tokens.js). A primitive kept in a variable rather
  // than read straight off `query` inside the fetch effect, so the deps array
  // can name it and the effect re-fires exactly when it actually changes.
  const envParam = query.get("e") === "sandbox" ? "sandbox" : null;
  const c = COPY[lang];

  const [code, setCode] = React.useState(routeCode || "");
  const [data, setData] = React.useState<Payload | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [how, setHow] = React.useState(false);
  const brand = useBranding();

  React.useEffect(() => {
    setCode(routeCode || "");
  }, [routeCode]);

  React.useEffect(() => {
    if (!code) {
      setData(null);
      setMissing(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setMissing(false);
    const params = new URLSearchParams({
      lang,
      // The QR lands on /v/:code; a typed code arrives through the form. The
      // distinction is worth logging: a document checked at a border post and
      // one read down a phone line are different stories.
      via: routeCode ? "QR" : "CODE",
    });
    // Forward the printed URL's env to the API so the read pins to sandbox
    // and the code resolves; a live URL has no `e` and reads live.
    if (envParam === "sandbox") params.set("e", "sandbox");
    tenant<Payload>(`/v/${encodeURIComponent(code)}?${params}`, { auth: false })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setMissing(true);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, routeCode, envParam]);

  const toggleLang = () => {
    const next = new URLSearchParams(query);
    next.set("lang", lang === "fr" ? "en" : "fr");
    setQuery(next, { replace: true });
  };

  const headline =
    data?.status === "REVOKED"
      ? { tone: "bad" as CalloutTone, title: c.revokedTitle, body: c.revokedBody }
      : data?.status === "AMENDED"
        ? { tone: "bad" as CalloutTone, title: c.amendedTitle, body: c.amendedBody }
        : data
          ? { tone: "ok" as CalloutTone, title: c.validTitle, body: "" }
          : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background px-4 py-8 text-foreground">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{brand.branding.name || ""}</p>
          <h1 className="mt-1 text-heading font-bold">{c.title}</h1>
        </div>
        <Button size="sm" variant="ghost" onClick={toggleLang}>
          {c.langSwitch}
        </Button>
      </header>

      {busy && !data && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner /> {c.checking}
        </div>
      )}

      {!code && !busy && (
        <div className="mt-6">
          <CodeEntry c={c} initial="" onSubmit={setCode} busy={busy} />
        </div>
      )}

      {missing && !busy && (
        <div className="mt-6 space-y-4">
          {/* One answer for "no such verification". The server does not
              distinguish a malformed code from one that never existed, and
              neither does this page — otherwise the portal becomes an oracle
              confirming which of 2^60 codes are real. */}
          <Callout tone="warn" title={c.notFoundTitle}>
            {c.notFoundBody}
          </Callout>
          <CodeEntry c={c} initial={code} onSubmit={setCode} busy={busy} />
        </div>
      )}

      {data && headline && (
        <div className="mt-6 space-y-6">
          {/* Test-environment banner (§5.4). Above the primary verdict callout
              because it re-frames every claim below it: the seal is authentic,
              the document is a test one. A reader who scrolls past it and
              treats the sheet as production has been misled by our own page. */}
          {data.test_environment && (
            <Callout tone="warn" title={c.testEnvTitle}>
              {c.testEnvBody}
            </Callout>
          )}

          <Callout tone={headline.tone} title={headline.title}>
            {headline.body || c.lead}
          </Callout>

          <Verdicts verdicts={data.verdicts} />

          {data.status === "REVOKED" && data.signature.revoke_reason && (
            <div className="rounded-lg border border-border p-3">
              <div className="text-micro uppercase tracking-wide text-muted-foreground">
                {c.revokedReasonLabel}
              </div>
              <p className="mt-1 text-sm">{data.signature.revoke_reason}</p>
            </div>
          )}

          {data.changes.length > 0 && (
            <section>
              <h2 className="text-title font-semibold">{c.changed}</h2>
              <dl className="mt-2">
                {data.changes.map((ch) => (
                  <Row
                    key={ch.field}
                    label={ch.label}
                    value={
                      ch.before !== null && ch.after !== null ? (
                        <span className="font-mono text-xs">
                          {ch.before} → {ch.after}
                        </span>
                      ) : (
                        <Pill tone="warn">{lang === "en" ? "Changed" : "Modifié"}</Pill>
                      )
                    }
                  />
                ))}
              </dl>
            </section>
          )}

          <section>
            <h2 className="text-title font-semibold">{c.signatureH}</h2>
            <dl className="mt-2">
              <Row
                label={c.signedBy}
                value={
                  <>
                    {data.signature.signed.name}
                    {data.signature.signed.role
                      ? ` · ${data.signature.signed.role}`
                      : ""}
                  </>
                }
              />
              <Row
                label={c.onBehalf}
                value={
                  data.signature.signed.party === "INTERNAL"
                    ? c.internal
                    : c.external
                }
              />
              <Row label={c.method} value={data.signature.signed.method} />
              {data.signature.signed.reason && (
                <Row label={c.reason} value={data.signature.signed.reason} />
              )}
              <Row
                label={c.signedAt}
                value={formatWhen(data.signature.signed.signed_at, lang)}
              />
              {/* §3.13 — masked server-side by services/signatures/mask.js.
                  This page never receives a full address, so it cannot leak one. */}
              <Row label={c.network} value={data.signature.signed.ip || "—"} />
              <Row label={c.device} value={data.signature.signed.device} />
              <Row label={c.code} value={<span className="font-mono">{data.signature.verify_code}</span>} />
              <Row
                label={c.contentHash}
                value={
                  <span className="font-mono text-xs">
                    {data.signature.content_hash_short}
                  </span>
                }
              />
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {data.signature.signed.identity_words}
            </p>
          </section>

          {/* The vault's own card, not a copy of it. See rule 2 in the header. */}
          {data.signature.card && (
            <section>
              {/* The vault's own card, with the assurance line the SERVER
                  translated — the component's own vocabulary is the staff
                  app's and is English-only. Rule 2 in the header still holds:
                  one card component, one catalogue. */}
              <SignatureCard
                card={data.signature.card}
                assuranceWords={data.signature.signed.method}
              />
            </section>
          )}

          <section>
            <h2 className="text-title font-semibold">
              {data.as_signed ? data.as_signed.title : c.asSigned}
            </h2>
            {data.as_signed ? (
              <>
                <dl className="mt-2">
                  {data.as_signed.fields.map((f) => (
                    <Row key={f.key} label={f.label} value={f.value} />
                  ))}
                </dl>
                {data.as_signed.detail && (
                  <div className="mt-3 rounded-lg border border-border p-3">
                    <div className="text-micro uppercase tracking-wide text-muted-foreground">
                      {data.as_signed.detail.label}
                    </div>
                    <p className="mt-1 text-sm">{data.as_signed.detail.value}</p>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {c.asSignedNote}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{c.noSummary}</p>
            )}
          </section>

          {data.issuer && (
            <section>
              <h2 className="text-title font-semibold">{c.issuer}</h2>
              <p className="mt-1 text-sm">
                {data.issuer.legal_name}
                {data.issuer.rccm ? ` · RCCM ${data.issuer.rccm}` : ""}
                {data.issuer.niu ? ` · NIU ${data.issuer.niu}` : ""}
              </p>
              {data.issuer.address && (
                <p className="text-sm text-muted-foreground">
                  {data.issuer.address}
                </p>
              )}
            </section>
          )}
        </div>
      )}

      <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setHow(true)}
        >
          {c.howLink}
        </button>
        {/* Q13 — one line, always, whether or not a document resolved. */}
        <p className="mt-2">{c.privacy}</p>
      </footer>

      <HowDialog open={how} onClose={() => setHow(false)} c={c} />
    </main>
  );
}
