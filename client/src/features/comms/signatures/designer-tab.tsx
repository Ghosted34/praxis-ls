/**
 * Signatures → Designer. One person's own signature: the fields they type, a
 * live card, and the PNG download.
 *
 * WHAT IS NOT EDITABLE HERE, AND WHY. Name, job title, company, address, P.O.
 * Box, website and the motto are all derived — from HR, from `corporate_entity`
 * and from the template. They are shown, greyed, with where they come from,
 * rather than hidden: someone whose title is wrong needs to know the fix is a
 * word with HR, not a box on this page they cannot find. It also means a
 * promotion reaches every future signature with nobody remembering to come here
 * — the property the whole engine exists for.
 *
 * The standalone generator this replaces had all nine fields typed by hand,
 * which is exactly why a stale job title could sit in someone's signature for a
 * year.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { useFieldHighlight } from "@/lib/use-url-tab";
import { reportActionError } from "@/lib/action-error";
import { CardPreview } from "./card-preview";
import { GapsPanel } from "./gaps-panel";

type Lang = "en" | "fr";

/**
 * TWO STORES, and which field goes where.
 *
 * Phones now live on the EMPLOYEE record (`12759`) — HR master data, written
 * here through `/employees/mine`, which is scoped to the caller and takes no
 * MOD-02 grant. Editing them here and in the staff directory changes the same
 * row, which is the point: one number, one place, and payroll or a contract can
 * read it too.
 *
 * WhatsApp and pronouns have no employee column and are signature-only
 * preferences, so they stay on `user_signature_profile`.
 */
type PhoneKey = "phone_desk" | "phone_mobile";
type ProfileKey = "whatsapp" | "pronouns";

const PHONES: { key: PhoneKey; label: string }[] = [
  { key: "phone_desk", label: "Desk phone" },
  { key: "phone_mobile", label: "Mobile" },
];

const PROFILE_ONLY: { key: ProfileKey; label: string; hint: string }[] = [
  { key: "whatsapp", label: "WhatsApp", hint: "Shown only if the template asks for it" },
  { key: "pronouns", label: "Pronouns", hint: "Shown only if the template asks for it" },
];

export function DesignerTab() {
  // The two phone inputs already carry `data-field`; nothing ran the
  // highlight, so `?field=phone_desk` landed on the tab and stopped there.
  useFieldHighlight();
  const toast = useToast();
  const [lang, setLang] = React.useState<Lang>("en");
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const { data: me, error, reload } = useResource(() => api.getSignatureProfile(), []);
  const { data: mine, reload: reloadMine } = useResource(
    () => api.getMyEmployee().catch(() => ({ linked: false, employee: null })),
    [],
  );
  const {
    data: card,
    error: cardError,
    reload: reloadCard,
  } = useResource(() => api.getSignatureCard(lang), [lang]);

  const profile = ((me && !Array.isArray(me) ? me.profile : null) ||
    {}) as Partial<Record<ProfileKey | PhoneKey, string | null>>;
  const person = ((me && !Array.isArray(me) ? me.person : null) ||
    {}) as Partial<Record<"employee_full_name" | "user_full_name" | "job_title", string | null>>;
  const staff = (mine && !Array.isArray(mine) ? mine.employee : null) || null;
  const linked = Boolean(mine && !Array.isArray(mine) && mine.linked);
  const gaps = (card && !Array.isArray(card) && card.gaps) || [];

  /**
   * A phone typed into `user_signature_profile` before `12759` still wins over
   * the staff record — that is the documented precedence, and silently ignoring
   * it would change what someone's signature says without telling them. So it
   * is surfaced instead: the person can see the override and drop it.
   */
  const overridden = PHONES.filter(
    (f) => profile[f.key] && profile[f.key] !== (staff ? staff[f.key] : null),
  );

  async function saveProfile(patch: Record<string, unknown>) {
    setBusy(true);
    setSaveError(null);
    try {
      await api.saveSignatureProfile(patch);
      toast.success(tr("Signature updated"));
      reload();
      // The card is server-rendered, so a saved field only shows once it is
      // re-fetched. Without this the person edits a field and watches nothing
      // happen.
      reloadCard();
    } catch (err) {
      reportActionError(err);
      setSaveError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  /** Writes the STAFF record, through the caller-scoped `/employees/mine`. */
  async function savePhone(patch: { phone_desk?: string | null; phone_mobile?: string | null }) {
    setBusy(true);
    setSaveError(null);
    try {
      await api.updateMyEmployee(patch);
      toast.success(tr("Staff record updated"));
      reloadMine();
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
      toast.success(tr("Signature downloaded"));
    } catch (err) {
      reportActionError(err);
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (me === null) return <SkeletonTable />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="lux-card space-y-3 p-4">
          <h2 className="text-sm font-semibold">{tr("Your details")}</h2>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{tr("Name")}</dt>
              <dd className="text-right font-medium">
                {person.employee_full_name || person.user_full_name || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{tr("Job title")}</dt>
              <dd className="text-right font-medium">{person.job_title || "—"}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {tr(
              "Name and job title come from HR. A change there reaches your next email on its own.",
            )}
          </p>
        </div>

        <div className="lux-card space-y-3 p-4">
          <h2 className="text-sm font-semibold">{tr("What you can set")}</h2>
          {saveError && <ErrorState message={saveError} />}

          {linked ? (
            <div
              key={PHONES.map((f) => (staff ? staff[f.key] : "") || "").join("|")}
              className="grid gap-3"
            >
              {PHONES.map((f) => (
                <Field
                  key={f.key}
                  label={tr(f.label)}
                  hint={tr("Saved to your staff record")}
                >
                  <Input
                    data-field={f.key}
                    defaultValue={(staff ? staff[f.key] : "") || ""}
                    disabled={busy}
                    onBlur={(e) =>
                      e.target.value !== ((staff ? staff[f.key] : "") || "") &&
                      savePhone({ [f.key]: e.target.value || null })
                    }
                  />
                </Field>
              ))}
            </div>
          ) : (
            <Callout tone="info" title={tr("No staff record linked")}>
              {tr(
                "Your account is not linked to a staff record, so phone numbers cannot be saved. An administrator can link it.",
              )}
            </Callout>
          )}

          {overridden.length > 0 && (
            <Callout tone="warn" title={tr("A different number is on your signature")}>
              {tr(
                "These were set on your signature before staff records carried phone numbers, and still take precedence:",
              )}
              <ul className="mt-1 space-y-1">
                {overridden.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{tr(f.label)}</span>
                    <span className="text-muted-foreground">{profile[f.key]}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => saveProfile({ [f.key]: null })}
                    >
                      {tr("Use my staff record")}
                    </Button>
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <div
            key={PROFILE_ONLY.map((f) => profile[f.key] || "").join("|")}
            className="grid gap-3"
          >
            {PROFILE_ONLY.map((f) => (
              <Field key={f.key} label={tr(f.label)} hint={tr(f.hint)}>
                <Input
                  data-field={f.key}
                  defaultValue={profile[f.key] || ""}
                  disabled={busy}
                  onBlur={(e) =>
                    e.target.value !== (profile[f.key] || "") &&
                    saveProfile({ [f.key]: e.target.value || null })
                  }
                />
              </Field>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {gaps.length > 0 && <GapsPanel gaps={gaps} />}

        <div className="lux-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{tr("Live preview")}</h2>
            <Segmented
              label={tr("Signature language")}
              value={lang}
              onChange={(v) => setLang(v)}
              options={[
                { value: "en", label: tr("English") },
                { value: "fr", label: tr("French") },
              ]}
            />
          </div>

          {cardError ? (
            <ErrorState message={cardError} />
          ) : (
            <div className="overflow-x-auto">
              <CardPreview
                loading={card === null}
                document={card?.document ?? null}
                width={card?.width ?? 650}
                height={card?.height ?? 325}
              />
            </div>
          )}
        </div>

        <div className="lux-card space-y-3 p-4">
          <h2 className="text-sm font-semibold">{tr("Download as an image")}</h2>
          <p className="text-sm text-muted-foreground">
            {tr(
              "Paste into Outlook, Gmail or webmail. 2× is the right choice for most screens.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === 2 ? "default" : "outline"}
                disabled={busy}
                onClick={() => downloadPng(s)}
              >
                {tr("Download PNG")} {s}×
              </Button>
            ))}
          </div>
          <Callout tone="info" title={tr("Your emails already carry this")}>
            {tr(
              "Mail sent from Praxis adds this signature on its own. The download is for mail clients you use outside the system.",
            )}
          </Callout>
        </div>
      </div>
    </div>
  );
}

export default DesignerTab;
