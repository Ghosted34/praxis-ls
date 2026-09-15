/**
 * Settings — email signatures (PR-2).
 *
 * Two audiences on one screen, because that is how people already find it:
 *   - the caller's own typed fields + live preview + PNG download (1×/2×/3×)
 *   - template list for MOD-70 holders
 *
 * Name and title are not editable here. They come from HR, so a promotion
 * shows up on the next send without anyone remembering this page.
 *
 * Loading / error / empty are real states — the axe gate scans all four, and
 * a form that paints before the profile arrives looks ready when it is not.
 *
 * THE PREVIEW SHOWS THE CARD, NOT THE EMAIL BODY, and that is a correction.
 *
 * This screen used to render `preview.html` — the thing that is pasted into an
 * outbound message, which for the card template is an `<img>` of the rendered
 * PNG with live text underneath it (signature.html.js explains why both). Two
 * problems followed from that. The `<img>` points at an absolute
 * `https://<tenant>/media/...` URL meant for a recipient's mail client, and when
 * the app is not served from that host the browser cannot fetch it — so the
 * screen showed a broken image icon above the fallback text and nothing said
 * which of the two you were looking at. And even when the image did load, a
 * 650px PNG plus a text block is not what the Download PNG buttons give you,
 * so the preview and the download disagreed on a screen whose whole job is to
 * show you what you are about to download.
 *
 * `/mail/signature/card` returns the exact document the PNG renderer
 * screenshots, so `<CardPreview>` and the download are now the same picture by
 * construction. The email body is still here, below, labelled as what it is —
 * the version a recipient sees with images turned off.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { useTranslation } from "react-i18next";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { CardPreview } from "@/features/comms/signatures/card-preview";
import { AccentRoles } from "@/features/comms/signatures/accent-roles";

export function EmailSignaturesPage() {
  const { t } = useTranslation();
  const {
    data: me,
    error,
    reload,
  } = useResource(() => api.getSignatureProfile(), []);
  const { data: templates } = useResource(
    () =>
      api
        .listSignatureTemplates()
        .catch(() => [] as api.SignatureTemplate[]),
    [],
  );
  const [lang, setLang] = React.useState<"en" | "fr">("en");
  const {
    data: card,
    error: cardError,
    reload: reloadCard,
  } = useResource(() => api.getSignatureCard(lang), [lang]);
  /**
   * Whether to offer the colour mapping at all. MOD-70, like the template list
   * above it — and asked for rather than inferred from the template list being
   * non-empty, because that list is fetched with a `.catch` and an empty array
   * is indistinguishable from a tenant with no templates.
   */
  const { data: caps } = useResource(() => api.mailCapabilities(), []);
  const canAdminister = caps && !Array.isArray(caps) && caps.can_administer === true;
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const profile = (me && !Array.isArray(me) ? me.profile : null) || {};
  const person = (me && !Array.isArray(me) ? me.person : null) || {};
  const preview = me && !Array.isArray(me) ? me.preview : null;
  // A card we could not fetch is not an error on this screen: the email body
  // below is a working preview of the same signature, so the fallback IS the
  // handling. It only becomes an error when there is no fallback either.
  const cardDoc = !cardError && card && !Array.isArray(card) ? card : null;
  const tplList = Array.isArray(templates) ? templates : [];

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.saveSignatureProfile(patch);
      setSaved(true);
      reload();
      // The card is drawn by the server, so a saved field only appears once it
      // has been asked for again.
      reloadCard();
    } catch (err) {
      reportActionError(err);
      setSaveError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPng(scale: 1 | 2 | 3) {
    setBusy(true);
    try {
      await api.downloadSignaturePng({ language: lang, scale });
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={pageShell.reading}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={t("mail.signatureTitle")}
        description={t("mail.signatureDesc")}
      />

      {error ? (
        <ErrorState message={error} />
      ) : me === null ? (
        <SkeletonTable />
      ) : (
        <>
          {saveError && <ErrorState message={saveError} />}
          <div className="lux-card space-y-4 p-4">
            <p className="text-sm font-medium">
              {person.employee_full_name || person.user_full_name || "—"}
              {person.job_title ? (
                <span className="text-muted-foreground"> · {person.job_title}</span>
              ) : null}
            </p>
            <div
              key={`${profile.phone_desk}|${profile.phone_mobile}|${profile.whatsapp}|${profile.pronouns}`}
              className="grid gap-3 sm:grid-cols-2"
            >
              <Field label={t("mail.deskPhone")}>
                <Input
                  defaultValue={profile.phone_desk || ""}
                  onBlur={(e) =>
                    e.target.value !== (profile.phone_desk || "") &&
                    save({ phone_desk: e.target.value || null })
                  }
                />
              </Field>
              <Field label={t("mail.mobilePhone")}>
                <Input
                  defaultValue={profile.phone_mobile || ""}
                  onBlur={(e) =>
                    e.target.value !== (profile.phone_mobile || "") &&
                    save({ phone_mobile: e.target.value || null })
                  }
                />
              </Field>
              <Field label="WhatsApp">
                <Input
                  defaultValue={profile.whatsapp || ""}
                  onBlur={(e) =>
                    e.target.value !== (profile.whatsapp || "") &&
                    save({ whatsapp: e.target.value || null })
                  }
                />
              </Field>
              <Field label="Pronouns">
                <Input
                  defaultValue={profile.pronouns || ""}
                  onBlur={(e) =>
                    e.target.value !== (profile.pronouns || "") &&
                    save({ pronouns: e.target.value || null })
                  }
                />
              </Field>
            </div>
            {saved && (
              <p className="text-xs text-muted-foreground">{t("common.save")} ✓</p>
            )}
          </div>

          <div className="lux-card mt-4 space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={lang === "en" ? "default" : "outline"}
                onClick={() => setLang("en")}
              >
                {t("mail.previewEn")}
              </Button>
              <Button
                size="sm"
                variant={lang === "fr" ? "default" : "outline"}
                onClick={() => setLang("fr")}
              >
                {t("mail.previewFr")}
              </Button>
              <span className="ml-auto flex gap-1">
                {([1, 2, 3] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => downloadPng(s)}
                  >
                    {t("mail.downloadPng")} {s}×
                  </Button>
                ))}
              </span>
            </div>

            {cardDoc?.document ? (
              <>
                {/* Scaled to fit the reading column, which is narrower than the
                    card. `CardPreview` transforms rather than resizing — the
                    card's geometry is fixed, so laying it out narrower would
                    clip it rather than shrink it. */}
                <div className="overflow-x-auto">
                  <CardPreview
                    document={cardDoc.document}
                    width={cardDoc.width}
                    height={cardDoc.height}
                    scale={0.9}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {tr("This is exactly what the PNG buttons download.")}
                </p>
              </>
            ) : preview?.html ? (
              /* Not the card — one of the table layouts, where the email body
                 IS the signature and there is no separate document. */
              <div
                className="overflow-x-auto rounded-md border border-border bg-background p-3"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            ) : cardError ? (
              <ErrorState message={cardError} />
            ) : (
              <p className="text-sm text-muted-foreground">No preview yet.</p>
            )}

            {cardDoc?.document && preview?.html && (
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  {tr("What a recipient sees with images turned off")}
                </summary>
                <div className="space-y-2 border-t border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "Outlook and Gmail block remote images from senders they do not know yet. Your mail carries the card as a picture AND as live text, so this is what arrives until the recipient allows images — and it is what a screen reader reads either way.",
                    )}
                  </p>
                  {/* The broken image icon in here is the card PNG, which only
                      a mail client can fetch — it is not a fault on this page. */}
                  <div
                    className="overflow-x-auto rounded-md bg-background p-3"
                    dangerouslySetInnerHTML={{ __html: preview.html }}
                  />
                </div>
              </details>
            )}
          </div>

          {canAdminister && (
            <div className="mt-4">
              <AccentRoles onSaved={reloadCard} />
            </div>
          )}

          {tplList.length > 0 && (
            <div className="lux-card mt-4 space-y-2 p-4">
              <h2 className="text-sm font-semibold">{t("mail.templatesTitle")}</h2>
              <ul className="space-y-2">
                {tplList.map((tpl) => (
                  <li
                    key={tpl.signature_template_id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {tpl.name}
                      {tpl.is_system && (
                        <Pill tone="mute" className="ml-2">
                          seeded
                        </Pill>
                      )}
                      {tpl.is_default && (
                        <Pill tone="blue" className="ml-2">
                          default
                        </Pill>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tpl.scope_kind}
                      {tpl.scope_value ? ` · ${tpl.scope_value}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default EmailSignaturesPage;
