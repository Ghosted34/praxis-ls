import * as React from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/careers-api";
import { withScheme } from "@/lib/format";
import { useIntake } from "@/lib/use-intake";
import { FileInput, type Attachment } from "@/components/ui/file-input";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
// Registers `site.careers.*`, which lives in this chunk rather than in the
// entry dictionary. Imported for the side effect; see careers-i18n.ts.
import "./careers-i18n";

/**
 * The one form a stranger fills in about themselves — used twice.
 *
 * ── WHY IT IS ONE COMPONENT AND NOT TWO ───────────────────────────────────
 *
 * 13792 added a second way to send a CV: an application with no role attached,
 * for the far commoner state where the tenant is not hiring. It asks the SAME
 * questions. Copying the 200 lines below would have meant two file pickers, two
 * compression calls, two honeypots and two sets of field-error wiring — and the
 * copy would have been the one that stopped getting the fixes, because it is
 * the one on the page nobody demos.
 *
 * What actually differs is three strings and where the body is posted, so those
 * are the props. `requireCover` / `requirePortfolio` come from a vacancy's
 * `apply_config` on the role path and are simply false on the open one, because
 * a tenant cannot make a demand of an application they did not advertise.
 *
 * Everything load-bearing is unchanged from the form this was lifted out of:
 * the 8 MB check before the file is read, the compression before the bytes
 * leave the device, the preview from the moment the picker closes, and the
 * receipt that says whether the CV actually landed.
 */

export type CandidateFormProps = {
  /** Where the body goes. The two callers differ in exactly this and the copy. */
  send: (body: api.ApplyInput) => Promise<api.ApplyResult>;
  /** From the vacancy's `apply_config`; both false for an open application. */
  requireCover?: boolean;
  requirePortfolio?: boolean;
  /** The free-text box means something different on each path: "why you are
   *  writing" against a role, "what you are looking for" without one. */
  coverLabel: string;
  coverHint: string;
  submitLabel: string;
  /** The confirmation. A render prop rather than a fixed block, because what a
   *  candidate should be told next is the one genuinely different thing: a role
   *  application has a pipeline behind it, an open one has a file. */
  renderSent: (result: api.ApplyResult) => React.ReactNode;
};

export function CandidateForm({
  send,
  requireCover = false,
  requirePortfolio = false,
  coverLabel,
  coverHint,
  submitLabel,
  renderSent,
}: CandidateFormProps) {
  const { t } = useTranslation();
  /* One piece of state where there were four (`file`, `preview`, `fileError`,
     `cvDataUrl`) and no revoke effect: `FileInput` owns the object URL's
     lifetime along with everything else it owns. */
  const [cv, setCv] = React.useState<Attachment | null>(null);
  const [f, setF] = React.useState({
    full_name: "",
    email: "",
    phone: "",
    address: "",
    experience_years: "",
    expected_salary: "",
    portfolio_url: "",
    cover_note: "",
  });
  const set = (k: keyof typeof f, val: string) =>
    setF((s) => ({ ...s, [k]: val }));

  const intake = useIntake<api.ApplyResult>({
    send: (body) => send(body as api.ApplyInput),
    onRateLimited: t("site.careers.limited"),
    onFailed: t("site.careers.err"),
  });

  const canSend =
    f.full_name.trim().length > 1 &&
    /.+@.+\..+/.test(f.email.trim()) &&
    (!requireCover || f.cover_note.trim().length > 0) &&
    (!requirePortfolio || f.portfolio_url.trim().length > 0) &&
    !intake.busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    await intake.submit({
      full_name: f.full_name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim() || undefined,
      address: f.address.trim() || undefined,
      // NO `skills`. The schema accepts them and the record stores them, but the
      // form does not ask the candidate for a skill list, and copying
      // `skills_required` in would write the job's own requirements into the
      // applicant's profile — where this product's CV scorer will read them back
      // as a match the person never claimed. A scaffold that inflates a score to
      // fill a column is worse than a null column.
      experience_years: f.experience_years
        ? Number(f.experience_years)
        : undefined,
      expected_salary: f.expected_salary
        ? Number(f.expected_salary)
        : undefined,
      portfolio_url: f.portfolio_url
        ? withScheme(f.portfolio_url.trim())
        : undefined,
      cover_note: f.cover_note.trim() || undefined,
      cv_data_url: cv?.dataUrl,
      cv_filename: cv?.filename,
    });
  }

  if (intake.result) return <>{renderSent(intake.result)}</>;

  return (
    <form onSubmit={submit} className="relative mt-4 space-y-3.5">
      {intake.error && (
        <p
          role="alert"
          className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
        >
          {intake.error}
        </p>
      )}
      <Input
        label={t("site.careers.fullName")}
        required
        autoComplete="name"
        value={f.full_name}
        error={intake.fields.full_name}
        onChange={(e) => set("full_name", e.target.value)}
      />
      <Input
        label={t("site.careers.email")}
        type="email"
        required
        autoComplete="email"
        value={f.email}
        error={intake.fields.email}
        onChange={(e) => set("email", e.target.value)}
      />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Input
          label={`${t("site.careers.phone")} (${t("site.careers.optional")})`}
          type="tel"
          autoComplete="tel"
          value={f.phone}
          error={intake.fields.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
        <Input
          label={`${t("site.careers.address")} (${t("site.careers.optional")})`}
          autoComplete="street-address"
          value={f.address}
          error={intake.fields.address}
          onChange={(e) => set("address", e.target.value)}
        />
        <Input
          label={`${t("site.careers.experience")} (${t("site.careers.optional")})`}
          type="number"
          min={0}
          max={70}
          inputMode="numeric"
          value={f.experience_years}
          error={intake.fields.experience_years}
          onChange={(e) => set("experience_years", e.target.value)}
        />
        <Input
          label={`${t("site.careers.expectedSalary")} (${t("site.careers.optional")})`}
          type="number"
          min={0}
          step="1000"
          inputMode="numeric"
          value={f.expected_salary}
          error={intake.fields.expected_salary}
          onChange={(e) => set("expected_salary", e.target.value)}
        />
      </div>
      <Input
        label={
          requirePortfolio
            ? t("site.careers.portfolio")
            : `${t("site.careers.portfolio")} (${t("site.careers.optional")})`
        }
        required={requirePortfolio}
        inputMode="url"
        placeholder="https://"
        value={f.portfolio_url}
        error={intake.fields.portfolio_url}
        onChange={(e) => set("portfolio_url", e.target.value)}
      />
      <Textarea
        label={
          requireCover ? coverLabel : `${coverLabel} (${t("site.careers.optional")})`
        }
        required={requireCover}
        hint={coverHint}
        rows={5}
        maxLength={5000}
        value={f.cover_note}
        error={intake.fields.cover_note}
        onChange={(e) => set("cover_note", e.target.value)}
      />

      {/*
        The shared control, not a second copy of it.

        This form used to hand-roll the whole engine beside `FilePicker`: its own
        compression call, its own size check, its own object-URL lifetime, its
        own preview `<img>` and its own filename-and-bytes chip. `FileInput`
        already does every one of those things — its preview carries the comment
        "Same guard as the careers form", which is how long the duplication has
        been visible — so what was here was a THIRD copy of the upload engine in
        a repo whose CLAUDE.md §3.13 says to keep the two it already has in step.

        Two things improve by deleting it rather than merely moving it:

          · THE SIZE CHECK NOW RUNS ON THE COMPRESSED BYTES. This form refused a
            file over 8 MB before compressing it (`fileToDataUrl`), so a CV
            photographed on a phone — routinely 8–12 MB and well under the limit
            once resized — was a dead end for somebody with no account and no
            support channel. `FileInput` compresses first and checks after, which
            is what its own header argues for.
          · THE TYPE IS CHECKED BEFORE ANY WORK. `ATTACHMENT_TYPES` is refused up
            front with a sentence naming the formats, instead of the vault
            refusing the bytes a minute later.

        The 8 MB ceiling and the accepted types are the same values on both
        paths (`ATTACHMENT_MAX_BYTES` / `ATTACHMENT_TYPES` against `CV_MAX_BYTES`
        / `CV_TYPES`), and the server still sniffs the bytes regardless.
      */}
      <div>
        <FileInput
          id="careers-cv"
          label={t("site.careers.cv")}
          hint={t("site.careers.cvHint")}
          value={cv}
          onChange={setCv}
        />
        {/* The SERVER's verdict on the file, which `FileInput` cannot know: the
            vault sniffs the bytes and can refuse a .exe renamed .pdf that passed
            every check on this side. */}
        {intake.fields.cv_data_url && (
          <p role="alert" className="mt-1.5 text-xs text-bad">
            {intake.fields.cv_data_url}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full justify-center"
        loading={intake.busy}
        disabled={!canSend}
      >
        {intake.busy ? t("site.careers.sending") : submitLabel}
      </Button>
    </form>
  );
}
