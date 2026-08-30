import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot, Input, Select, Textarea } from "@/components/ui/field";
import { SuccessState } from "@/components/ui/states";
import { contactEnquiries } from "@/lib/intake-api";
import { useIntake } from "@/lib/use-intake";

/**
 * The general enquiry — `POST /public/intake/contact-enquiries`, which lands in
 * the tenant's inbound-intake queue (`sales/inbound_intake`) tagged
 * `source: "WEBSITE"`.
 *
 * `enquiry_type` is exposed as a choice because the enum already exists server-side
 * and because routing matters more on a public form than anywhere else in the
 * product: a customs question that arrives as "general" waits behind a newsletter
 * sign-up, and the person who filed it has already given up. It is
 * `GENERAL_ENQUIRY` if the visitor would not pick.
 *
 * Only `message` is required by the schema (`min(1)`), and only `message` is
 * required here. A contact form that demands a phone number from someone who
 * wants to email is a form that gets abandoned.
 */
const TYPES = [
  { value: "GENERAL_ENQUIRY", key: "site.contact.typeGeneral" },
  { value: "PARTNERSHIP", key: "site.contact.typePartnership" },
  { value: "CAREERS", key: "site.contact.typeCareers" },
  { value: "MEDIA", key: "site.contact.typeMedia" },
] as const;

export function ContactForm() {
  const { t } = useTranslation();
  const [f, setF] = React.useState({
    name: "",
    company_name: "",
    email: "",
    phone: "",
    subject: "",
    enquiry_type: "GENERAL_ENQUIRY",
    message: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) =>
      contactEnquiries.send(
        body as Parameters<typeof contactEnquiries.send>[0],
        startedAt,
      ),
    onRateLimited: t("site.contact.limited"),
    onFailed: t("site.contact.err"),
  });

  const canSend = f.message.trim().length > 0 && !intake.busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    const r = await intake.submit({
      name: f.name.trim() || undefined,
      company_name: f.company_name.trim() || undefined,
      email: f.email.trim() || undefined,
      phone: f.phone.trim() || undefined,
      subject: f.subject.trim() || undefined,
      enquiry_type: f.enquiry_type,
      message: f.message.trim(),
    });
    if (r) setF((s) => ({ ...s, subject: "", message: "" }));
  }

  if (intake.result) {
    return (
      <SuccessState
        title={t("site.contact.sent")}
        hint={
          intake.result.reference
            ? `${t("site.quote.reference")} ${intake.result.reference}`
            : undefined
        }
      />
    );
  }

  return (
    <form onSubmit={submit} className="relative space-y-4">
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
          autoComplete="name"
          value={f.name}
          error={intake.fields.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <Input
          label={t("site.quote.company")}
          autoComplete="organization"
          value={f.company_name}
          error={intake.fields.company_name}
          onChange={(e) => set("company_name", e.target.value)}
        />
        <Input
          label={t("site.quote.email")}
          type="email"
          autoComplete="email"
          value={f.email}
          error={intake.fields.email}
          onChange={(e) => set("email", e.target.value)}
        />
        <Input
          label={t("site.quote.phone")}
          type="tel"
          autoComplete="tel"
          value={f.phone}
          error={intake.fields.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("site.contact.subject")}
          value={f.subject}
          error={intake.fields.subject}
          onChange={(e) => set("subject", e.target.value)}
        />
        <Select
          label={t("site.contact.type")}
          value={f.enquiry_type}
          onChange={(e) => set("enquiry_type", e.target.value)}
          options={TYPES.map((o) => ({ value: o.value, label: t(o.key) }))}
        />
      </div>
      <Textarea
        label={t("site.contact.message")}
        required
        rows={5}
        maxLength={20000}
        value={f.message}
        error={intake.fields.message}
        onChange={(e) => set("message", e.target.value)}
      />
      <Honeypot value={intake.honeypot} onChange={intake.setHoneypot} />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          loading={intake.busy}
          disabled={!canSend}
        >
          {intake.busy ? t("site.contact.sending") : t("site.contact.send")}
        </Button>
      </div>
    </form>
  );
}
