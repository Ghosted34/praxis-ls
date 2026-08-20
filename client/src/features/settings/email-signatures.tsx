/**
 * Settings — email signatures (PR-2).
 *
 * Two audiences on one screen, because that is how people already find it:
 *   - the caller's own typed fields + live preview + PNG download (1×/2×/3×)
 *   - template list for MOD-70 holders
 *
 * Name and title are not editable here. They come from HR, so a promotion
 * shows up on the next send without anyone remembering this page.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/mail-api";
import { reportActionError } from "@/lib/action-error";

export function EmailSignaturesPage() {
  const { t } = useTranslation();
  const [me, setMe] = React.useState<api.SignatureProfile | null>(null);
  const [templates, setTemplates] = React.useState<api.SignatureTemplate[]>([]);
  const [lang, setLang] = React.useState<"en" | "fr">("en");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [profile, tpls] = await Promise.all([
        api.getSignatureProfile(),
        api.listSignatureTemplates().catch(() => [] as api.SignatureTemplate[]),
      ]);
      setMe(profile);
      setTemplates(tpls || []);
    } catch (err) {
      setError((err as { message?: string })?.message || "Could not load signatures.");
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const profile = me?.profile || {};
  const person = me?.person || {};
  const preview = me?.preview;

  async function save(patch: Record<string, unknown>) {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.saveSignatureProfile(patch);
      setSaved(true);
      await load();
    } catch (err) {
      reportActionError(err);
      setError((err as { message?: string })?.message || "Could not save.");
    } finally { setBusy(false); }
  }

  async function downloadPng(scale: 1 | 2 | 3) {
    setBusy(true);
    try {
      await api.downloadSignaturePng({ language: lang, scale });
    } catch (err) {
      reportActionError(err);
    } finally { setBusy(false); }
  }

  return (
    <section className={pageShell.reading}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={t("mail.signatureTitle")}
        description={t("mail.signatureDesc")}
      />

      {error && <ErrorState message={error} />}

      <div className="lux-card space-y-4 p-4">
        <p className="text-sm font-medium">
          {person.employee_full_name || person.user_full_name || "—"}
          {person.job_title ? <span className="text-muted-foreground"> · {person.job_title}</span> : null}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("mail.deskPhone")}>
            <Input
              defaultValue={profile.phone_desk || ""}
              onBlur={(e) => e.target.value !== (profile.phone_desk || "") && save({ phone_desk: e.target.value || null })}
            />
          </Field>
          <Field label={t("mail.mobilePhone")}>
            <Input
              defaultValue={profile.phone_mobile || ""}
              onBlur={(e) => e.target.value !== (profile.phone_mobile || "") && save({ phone_mobile: e.target.value || null })}
            />
          </Field>
          <Field label="WhatsApp">
            <Input
              defaultValue={profile.whatsapp || ""}
              onBlur={(e) => e.target.value !== (profile.whatsapp || "") && save({ whatsapp: e.target.value || null })}
            />
          </Field>
          <Field label="Pronouns">
            <Input
              defaultValue={profile.pronouns || ""}
              onBlur={(e) => e.target.value !== (profile.pronouns || "") && save({ pronouns: e.target.value || null })}
            />
          </Field>
        </div>
        {saved && <p className="text-xs text-muted-foreground">{t("common.save")} ✓</p>}
      </div>

      <div className="lux-card mt-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={lang === "en" ? "default" : "outline"} onClick={() => setLang("en")}>{t("mail.previewEn")}</Button>
          <Button size="sm" variant={lang === "fr" ? "default" : "outline"} onClick={() => setLang("fr")}>{t("mail.previewFr")}</Button>
          <span className="ml-auto flex gap-1">
            {([1, 2, 3] as const).map((s) => (
              <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => downloadPng(s)}>
                {t("mail.downloadPng")} {s}×
              </Button>
            ))}
          </span>
        </div>
        {preview?.html ? (
          <div
            className="overflow-x-auto rounded-md border border-border bg-white p-3"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No preview yet.</p>
        )}
      </div>

      {templates.length > 0 && (
        <div className="lux-card mt-4 space-y-2 p-4">
          <h2 className="text-sm font-semibold">{t("mail.templatesTitle")}</h2>
          <ul className="space-y-2">
            {templates.map((tpl) => (
              <li key={tpl.signature_template_id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {tpl.name}
                  {tpl.is_system && <Pill tone="mute" className="ml-2">seeded</Pill>}
                  {tpl.is_default && <Pill tone="blue" className="ml-2">default</Pill>}
                </span>
                <span className="text-xs text-muted-foreground">{tpl.scope_kind}{tpl.scope_value ? ` · ${tpl.scope_value}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default EmailSignaturesPage;
