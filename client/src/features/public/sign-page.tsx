/**
 * The public signing page — what a counterparty sees when they open the link.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §6.6.
 *
 * ── Who this is for ────────────────────────────────────────────────────────
 * A procurement manager on a phone at a loading bay, with no account and no
 * training, being asked to put their name on something. Mobile-first is not a
 * preference here — it is where this is actually used.
 *
 * ── Four rules it keeps ────────────────────────────────────────────────────
 * 1. THE EMAIL IS READ-ONLY AND MASKED. Q7 = C is forbidden (§6.3): there is
 *    no field on this page that writes an address, and the API rejects a body
 *    carrying one rather than ignoring it. The signer can SEE it is theirs —
 *    `j••••@acme.cm` — without being able to change it. If it is wrong, the
 *    sender reissues, which is the audit behaviour worth having.
 * 2. THE NAME IS THEIRS TO STATE. That is `identity_source = 'DECLARED'`, and
 *    the page says so in those terms: the name is CLAIMED, the email is
 *    PROVED (§1.3(d)). Presenting a typed name as though the system had
 *    verified it is the thing this wording exists to avoid.
 * 3. THE CARDS ARE THE VAULT'S CARDS. `SignatureCardGrid` is imported from
 *    `features/vault/signature-cards` — the same component the sender and
 *    Settings → Signatures render. Blocked cards show DISABLED with a reason
 *    rather than hidden, so a counterparty told "you can sign this by hand"
 *    sees why that option is greyed out instead of wondering if the page is
 *    broken.
 * 4. NOTHING SIGNS WITHOUT A VERIFIED CODE. Every completion path passes
 *    through the OTP (Q1, §1.5(b)) — the button does not exist until the code
 *    is verified, and the server refuses regardless of what the button does.
 *
 * Language: FR by default, EN on `?lang=en` (§3.14), resolved by the API.
 */

import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { tenant } from "@/lib/api-client";
import { useBranding } from "@/app/branding/branding-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { OtpInput } from "@/components/ui/otp-input";
import { Spinner } from "@/components/ui/states";
import { SignatureCardGrid, type SignatureMenu } from "@/features/vault/signature-cards";
import { errMsg } from "@/lib/use-resource";
import { SignaturePad } from "./signature-pad";

type Lang = "fr" | "en";

type Payload = {
  language: Lang;
  status: string;
  request: {
    doc_type: string;
    /* In words, resolved server-side — never the raw enum on a page a
       counterparty reads (§3.12). */
    doc_type_label: string;
    message: string | null;
    expires_at: string | null;
    sequence_no: number;
    party_count: number;
  };
  signer: {
    full_name: string;
    party_role: string | null;
    email_masked: string;
    party_kind: string;
  };
  as_requested: {
    title: string;
    fields: { key: string; label: string; value: string }[];
    detail: { label: string; value: string } | null;
  } | null;
  menu: SignatureMenu;
  /* Served WITH the page: /signatures/reasons is MOD-64 view behind auth, and
     the counterparty has no account. */
  decline_reasons: { reason_code: string; label: string }[];
  otp: {
    sent_to: string;
    expires_at: string;
    attempts_remaining: number;
    resends_remaining: number;
    cooldown_until: string | null;
    verified_at: string | null;
  } | null;
};

const COPY = {
  fr: {
    title: "Signature de document",
    of: "sur",
    signatory: "Signataire",
    email: "Code envoyé à",
    emailNote:
      "Cette adresse a été fournie par l'expéditeur et ne peut pas être modifiée ici. Si elle est incorrecte, demandez à l'expéditeur de réémettre la demande.",
    nameLabel: "Votre nom, tel qu'il figurera sur le document",
    roleLabel: "Votre fonction",
    nameNote:
      "Vous déclarez votre nom ; c'est le contrôle de cette adresse e-mail qui est prouvé.",
    document: "Ce que vous signez",
    sendCode: "Recevoir mon code",
    resend: "Renvoyer le code",
    codeLabel: "Code à six chiffres",
    codeSent: "Nous avons envoyé un code à",
    verify: "Valider le code",
    verified: "Code validé",
    method: "Comment souhaitez-vous signer ?",
    reason: "Motif",
    sign: "Signer le document",
    decline: "Refuser de signer",
    declineTitle: "Refuser de signer",
    declineReason: "Motif du refus",
    declineNote: "Précision (facultatif)",
    declineConfirm: "Confirmer le refus",
    cancel: "Annuler",
    done: "Signé. Merci.",
    doneNote:
      "Une copie et un certificat d'exécution sont envoyés à l'expéditeur. Vous pouvez fermer cette page.",
    declined: "Refus enregistré.",
    declinedNote: "L'expéditeur en a été informé avec le motif que vous avez indiqué.",
    unavailable: "Ce lien de signature n'est pas valide",
    unavailableNote:
      "Il a peut-être expiré, ou le document a déjà été signé. Contactez directement l'expéditeur.",
    drawNote: "Signez dans le cadre ci-dessous.",
    clear: "Effacer",
    attemptsLeft: "essai(s) restant(s)",
    working: "Un instant…",
  },
  en: {
    title: "Document signature",
    of: "of",
    signatory: "Signatory",
    email: "Code sent to",
    emailNote:
      "This address was provided by the sender and cannot be changed here. If it is wrong, ask the sender to reissue the request.",
    nameLabel: "Your name, as it will appear on the document",
    roleLabel: "Your role",
    nameNote: "You state your name; what is proved is your control of this email address.",
    document: "What you are signing",
    sendCode: "Send me a code",
    resend: "Send another code",
    codeLabel: "Six-digit code",
    codeSent: "We sent a code to",
    verify: "Check the code",
    verified: "Code confirmed",
    method: "How would you like to sign?",
    reason: "Reason",
    sign: "Sign the document",
    decline: "Decline to sign",
    declineTitle: "Decline to sign",
    declineReason: "Reason",
    declineNote: "Anything to add (optional)",
    declineConfirm: "Confirm decline",
    cancel: "Cancel",
    done: "Signed. Thank you.",
    doneNote:
      "A copy and a certificate of completion go to the sender. You can close this page.",
    declined: "Decline recorded.",
    declinedNote: "The sender has been told, with the reason you gave.",
    unavailable: "This signing link is not valid",
    unavailableNote:
      "It may have expired, or the document may already be signed. Please contact the sender directly.",
    drawNote: "Sign inside the box below.",
    clear: "Clear",
    attemptsLeft: "attempt(s) left",
    working: "One moment…",
  },
} as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </label>
  );
}

export function SignPage() {
  const { token = "" } = useParams();
  const [query] = useSearchParams();
  const [data, setData] = React.useState<Payload | null>(null);
  const [gone, setGone] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<"SIGNED" | "DECLINED" | null>(null);

  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [code, setCode] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [preset, setPreset] = React.useState<string | null>(null);
  const [mark, setMark] = React.useState<string | null>(null);
  const [declining, setDeclining] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  const [declineNote, setDeclineNote] = React.useState("");

  const brand = useBranding();
  const langParam = query.get("lang") === "en" ? "en" : "fr";
  const lang: Lang = data ? data.language : (langParam as Lang);
  const c = COPY[lang];

  const load = React.useCallback(async () => {
    try {
      const r = await tenant<Payload>(
        `/public/sign/${encodeURIComponent(token)}?lang=${langParam}`,
        { auth: false },
      );
      setData(r);
      setName((prev) => prev || r.signer.full_name);
      setRole((prev) => prev || r.signer.party_role || "");
      setPreset((prev) => prev ?? r.menu.default ?? null);
      setVerified(Boolean(r.otp && r.otp.verified_at));
      setGone(null);
    } catch (e) {
      setGone(errMsg(e));
    }
  }, [token, langParam]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    act(async () => {
      await tenant(`/public/sign/${encodeURIComponent(token)}/otp`, {
        method: "POST", body: { lang }, auth: false,
      });
      await load();
    });

  const checkCode = () =>
    act(async () => {
      await tenant(`/public/sign/${encodeURIComponent(token)}/verify`, {
        method: "POST", body: { code }, auth: false,
      });
      setVerified(true);
    });

  const sign = () =>
    act(async () => {
      await tenant(`/public/sign/${encodeURIComponent(token)}/complete`, {
        method: "POST",
        // No `email` anywhere in this body. See rule 1 in the header — the API
        // rejects one rather than ignoring it, and there is no control here
        // that could produce it.
        body: {
          preset_code: preset,
          full_name: name.trim(),
          party_role: role.trim(),
          ...(mark ? { mark_image_b64: mark } : {}),
          lang,
        },
        auth: false,
      });
      setOutcome("SIGNED");
    });

  const decline = () =>
    act(async () => {
      await tenant(`/public/sign/${encodeURIComponent(token)}/decline`, {
        method: "POST",
        body: { reason_code: declineReason, note: declineNote || undefined, lang },
        auth: false,
      });
      setOutcome("DECLINED");
    });

  const chosen = data?.menu.cards.find((k) => k.preset_code === preset) || null;
  const needsMark = chosen?.visual_mark === "DRAWN";
  const canSign = Boolean(verified && preset && name.trim() && (!needsMark || mark) && !busy);

  if (gone) {
    return (
      <Frame brandName={brand.branding.name} title={c.title}>
        <Callout tone="warn" title={c.unavailable}>{c.unavailableNote}</Callout>
      </Frame>
    );
  }
  if (!data) {
    return (
      <Frame brandName={brand.branding.name} title={c.title}>
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner /> {c.working}
        </div>
      </Frame>
    );
  }
  if (outcome) {
    return (
      <Frame brandName={brand.branding.name} title={c.title}>
        <Callout tone={outcome === "SIGNED" ? "ok" : "warn"} title={outcome === "SIGNED" ? c.done : c.declined}>
          {outcome === "SIGNED" ? c.doneNote : c.declinedNote}
        </Callout>
      </Frame>
    );
  }

  return (
    <Frame brandName={brand.branding.name} title={c.title}>
      <p className="text-sm text-muted-foreground">
        {data.request.doc_type_label} · {data.request.sequence_no} {c.of} {data.request.party_count}
      </p>
      {data.request.message ? (
        <p className="mt-3 rounded-lg border border-border p-3 text-sm">{data.request.message}</p>
      ) : null}

      {data.as_requested ? (
        <section className="mt-6">
          <h2 className="text-title font-semibold">{c.document}</h2>
          <dl className="mt-2">
            {data.as_requested.fields.map((f) => (
              <div key={f.key} className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-0">
                <dt className="text-sm text-muted-foreground">{f.label}</dt>
                <dd className="text-sm font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
          <a
            className="mt-2 inline-block text-sm underline underline-offset-2"
            href={`/api/tenant/public/sign/${encodeURIComponent(token)}/document`}
            target="_blank"
            rel="noreferrer"
          >
            PDF
          </a>
        </section>
      ) : null}

      <section className="mt-6 space-y-4">
        <h2 className="text-title font-semibold">{c.signatory}</h2>
        {/* Rule 1 — read-only, masked, and there is no input that writes it. */}
        <div className="rounded-lg border border-border p-3">
          <div className="text-micro uppercase tracking-wide text-muted-foreground">{c.email}</div>
          <div className="mt-1 font-mono text-sm">{data.signer.email_masked}</div>
          <p className="mt-1 text-xs text-muted-foreground">{c.emailNote}</p>
        </div>
        {/* Rule 2 — the name is theirs to state, and the page says what that means. */}
        <Field label={c.nameLabel} hint={c.nameNote}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={c.roleLabel}>
          <Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
        </Field>
      </section>

      {/* Rule 4 — nothing signs without this. */}
      <section className="mt-6 space-y-3">
        {!data.otp || !verified ? (
          <>
            {data.otp ? (
              <p className="text-sm">
                {c.codeSent} <span className="font-mono">{data.otp.sent_to}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={data.otp ? "outline" : "default"} onClick={sendCode} loading={busy}>
                {data.otp ? c.resend : c.sendCode}
              </Button>
              {data.otp && data.otp.resends_remaining === 0 ? (
                <span className="text-xs text-muted-foreground">{data.otp.cooldown_until ?? ""}</span>
              ) : null}
            </div>
            {data.otp ? (
              <Field label={c.codeLabel}>
                <OtpInput value={code} onChange={setCode} onComplete={checkCode} />
                <div className="mt-2 flex items-center gap-3">
                  <Button onClick={checkCode} loading={busy} disabled={code.length !== 6}>
                    {c.verify}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {data.otp.attempts_remaining} {c.attemptsLeft}
                  </span>
                </div>
              </Field>
            ) : null}
          </>
        ) : (
          <Callout tone="ok" title={c.verified}>{data.signer.email_masked}</Callout>
        )}
      </section>

      {verified ? (
        <section className="mt-6 space-y-3">
          <h2 className="text-title font-semibold">{c.method}</h2>
          {/* Rule 3 — the vault's own grid, blocked cards included. */}
          <SignatureCardGrid menu={data.menu} value={preset} onChange={setPreset} />
          {needsMark ? (
            <div>
              <p className="text-sm text-muted-foreground">{c.drawNote}</p>
              <SignaturePad onChange={setMark} clearLabel={c.clear} />
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <Callout tone="bad" className="mt-4">{error}</Callout> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={sign} loading={busy} disabled={!canSign}>{c.sign}</Button>
        <Button variant="ghost" onClick={() => setDeclining(true)} disabled={busy}>{c.decline}</Button>
      </div>

      {declining ? (
        <section className="mt-6 space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-title font-semibold">{c.declineTitle}</h2>
          <Field label={c.declineReason}>
            <select
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            >
              <option value="">—</option>
              {data.decline_reasons.map((r) => (
                <option key={r.reason_code} value={r.reason_code}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field label={c.declineNote}>
            <Input value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} maxLength={400} />
          </Field>
          <div className="flex gap-3">
            <Button variant="destructive" onClick={decline} loading={busy} disabled={!declineReason || busy}>
              {c.declineConfirm}
            </Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>{c.cancel}</Button>
          </div>
        </section>
      ) : null}
    </Frame>
  );
}

function Frame({ brandName, title, children }: { brandName?: string | null; title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-xl bg-background px-4 py-8 text-foreground">
      <header className="border-b border-border pb-4">
        <p className="text-sm font-semibold">{brandName || ""}</p>
        <h1 className="mt-1 text-heading font-bold">{title}</h1>
      </header>
      <div className="pt-6">{children}</div>
    </main>
  );
}
