import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot, Input, Select, Textarea } from "@/components/ui/field";
import { SuccessState } from "@/components/ui/states";
import { quoteRequests } from "@/lib/intake-api";
import { useIntake } from "@/lib/use-intake";
import { getLang } from "@/lib/i18n";
import type { ServiceCard } from "@/lib/services-api";
import { pickText, pickSlug } from "@/lib/services-api";

/**
 * The quote desk — the form a marketing page exists to get filled in.
 *
 * ── THE FIELD LIST IS THE SERVER'S, NOT A DESIGN CHOICE ──────────────────
 *
 * `public_intake.validator.js` parses this body with a Zod schema ending in
 * `.strict()`, so a key the schema does not name is a 422 and a lost enquiry. The
 * allowed keys are exactly the ones below. There is no weight field, no container
 * count and no commodity code, because the schema has no such fields — and the
 * page that shipped before this one put `service_type` and `estimated_weight` in
 * the payload and has been refused on every submit since (see README › FINDINGS).
 * A field the API cannot store is a promise nobody can keep, so cargo detail goes
 * in `cargo_description`, which the schema DOES carry and the CRM DOES read.
 *
 * ── THE ONE REQUIRED FIELD ─────────────────────────────────────────────────
 *
 * `incoterm: z.string().min(1).max(30)` — note the absence of `.optional()`. It
 * is the only field the intake schema insists on, and the shipped form left it
 * optional, so a blank Incoterm became a 422 nobody could explain. It is a select
 * here, HTML-`required`, with the terms this trade actually uses. That is not a
 * guess at the tenant's business; it is the list Incoterms 2020 defines.
 *
 * ── PROGRESSIVE, NOT PERFECT ───────────────────────────────────────────────
 *
 * `service_category` becomes a SELECT of the tenant's published services when the
 * `website` feature has any, and a free-text field when it has none. A stranger
 * choosing from a list is a quote the desk can price; a stranger typing "trucking
 * stuff douala" is a phone call. Same endpoint either way.
 */
const INCOTERMS = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
];

const EMAIL_RE = /.+@.+\..+/;

type Form = {
  requester_name: string;
  requester_company: string;
  requester_email: string;
  requester_phone: string;
  service_category: string;
  origin_location: string;
  destination_location: string;
  incoterm: string;
  cargo_description: string;
};

const EMPTY: Form = {
  requester_name: "",
  requester_company: "",
  requester_email: "",
  requester_phone: "",
  service_category: "",
  origin_location: "",
  destination_location: "",
  incoterm: "",
  cargo_description: "",
};

export function QuoteForm({ services = [] }: { services?: ServiceCard[] }) {
  const { t } = useTranslation();
  const lang = getLang();
  const [f, setF] = React.useState<Form>(EMPTY);
  const set = (k: keyof Form, v: string) => setF((s) => ({ ...s, [k]: v }));

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) =>
      quoteRequests.send(
        body as Parameters<typeof quoteRequests.send>[0],
        startedAt,
      ),
    onRateLimited: t("site.quote.limited"),
    onFailed: t("site.quote.err"),
  });

  const valid =
    f.requester_name.trim().length > 1 &&
    EMAIL_RE.test(f.requester_email.trim()) &&
    f.origin_location.trim().length > 1 &&
    f.destination_location.trim().length > 1 &&
    f.incoterm.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const r = await intake.submit({
      requester_name: f.requester_name.trim(),
      requester_company: f.requester_company.trim() || undefined,
      requester_email: f.requester_email.trim(),
      requester_phone: f.requester_phone.trim() || undefined,
      service_category: f.service_category.trim() || undefined,
      origin_location: f.origin_location.trim(),
      destination_location: f.destination_location.trim(),
      incoterm: f.incoterm,
      cargo_description: f.cargo_description.trim() || undefined,
    });
    if (r) setF(EMPTY);
  }

  const err = (k: keyof Form) => intake.fields[k] || undefined;

  if (intake.result) {
    return (
      <SuccessState
        title={t("site.quote.sent")}
        hint={
          intake.result.reference ? (
            <>
              {t("site.quote.reference")}{" "}
              <span className="num font-mono font-semibold tracking-tight text-foreground">
                {intake.result.reference}
              </span>
            </>
          ) : undefined
        }
      />
    );
  }

  const hasServices = services.length > 0;

  return (
    <form onSubmit={onSubmit} className="relative space-y-4" noValidate={false}>
      {intake.error && (
        <p
          role="alert"
          className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
        >
          {intake.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("site.quote.name")}
          required
          autoComplete="name"
          value={f.requester_name}
          error={err("requester_name")}
          onChange={(e) => set("requester_name", e.target.value)}
        />
        <Input
          label={t("site.quote.company")}
          autoComplete="organization"
          value={f.requester_company}
          error={err("requester_company")}
          onChange={(e) => set("requester_company", e.target.value)}
        />
        <Input
          label={t("site.quote.email")}
          type="email"
          required
          autoComplete="email"
          value={f.requester_email}
          error={err("requester_email")}
          onChange={(e) => set("requester_email", e.target.value)}
        />
        <Input
          label={t("site.quote.phone")}
          type="tel"
          autoComplete="tel"
          value={f.requester_phone}
          error={err("requester_phone")}
          onChange={(e) => set("requester_phone", e.target.value)}
        />
      </div>

      {hasServices ? (
        <Select
          label={t("site.quote.service")}
          required
          value={f.service_category}
          error={err("service_category")}
          onChange={(e) => set("service_category", e.target.value)}
          options={[
            { value: "", label: t("site.quote.servicePick") },
            ...services.map((s) => ({
              value: pickText(s, "name", lang) || pickSlug(s, lang),
              label: pickText(s, "name", lang) || "",
            })),
          ]}
        />
      ) : (
        <Input
          label={t("site.quote.service")}
          required
          placeholder={t("site.quote.servicePlaceholder")}
          value={f.service_category}
          error={err("service_category")}
          onChange={(e) => set("service_category", e.target.value)}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label={t("site.quote.origin")}
          required
          placeholder={t("site.quote.originPlaceholder")}
          value={f.origin_location}
          error={err("origin_location")}
          onChange={(e) => set("origin_location", e.target.value)}
        />
        <Input
          label={t("site.quote.destination")}
          required
          placeholder={t("site.quote.destinationPlaceholder")}
          value={f.destination_location}
          error={err("destination_location")}
          onChange={(e) => set("destination_location", e.target.value)}
        />
        <Select
          label={t("site.quote.incoterm")}
          required
          value={f.incoterm}
          error={err("incoterm")}
          onChange={(e) => set("incoterm", e.target.value)}
          options={[
            { value: "", label: t("site.quote.incotermPick") },
            ...INCOTERMS.map((i) => ({ value: i, label: i })),
          ]}
        />
      </div>

      <Textarea
        label={t("site.quote.cargo")}
        hint={t("site.quote.cargoHint")}
        rows={4}
        maxLength={5000}
        value={f.cargo_description}
        error={err("cargo_description")}
        onChange={(e) => set("cargo_description", e.target.value)}
      />

      {/* The honeypot: present for a scraper, invisible for a person. */}
      <Honeypot value={intake.honeypot} onChange={intake.setHoneypot} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          {t("site.quote.privacy")}
        </p>
        <Button
          type="submit"
          size="lg"
          loading={intake.busy}
          disabled={!valid || intake.busy}
        >
          {intake.busy ? t("site.quote.sending") : t("site.quote.submit")}
        </Button>
      </div>
    </form>
  );
}
