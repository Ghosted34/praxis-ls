/**
 * "Sending (SMTP) sign-in" — the choice a mailbox form has to offer, once.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * A mailbox can receive on one server and send through another. The hosts have
 * always been separate fields; the SIGN-IN was not, so a mailbox that reads from
 * cPanel and relays through SMTP2GO handed the cPanel password to the relay and
 * came back with "the mail server rejected the SMTP credentials for this
 * mailbox" — about a credential the operator had never been given a field for.
 *
 * ── WHY IT IS A VISIBLE RADIO AND NOT AN ADVANCED SECTION ───────────────────
 *
 * Two credentials is a fact about how the mailbox is set up, not a power-user
 * tweak. Hidden behind a disclosure it is only found by somebody who already
 * knows it exists — which is precisely not the person hitting the failure. Two
 * radios name both worlds up front, and the default is the one almost every
 * mailbox lives in, so the common path costs one glance and nothing else.
 *
 * ── WHY THE HOST AND PORT ARE NOT IN HERE ───────────────────────────────────
 *
 * `smtp_host` / `smtp_port` stay where each form already puts them, editable in
 * BOTH modes. They are independent of the sign-in and always have been: a tenant
 * can legitimately point sending at another host while sharing one password
 * (a smarthost on the same account), and moving those fields under the radio
 * would make that configuration unreachable.
 *
 * Every string goes through `tr()`; EN/FR live in lib/i18n-dict.ts.
 */
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/checkbox";
import { tr } from "@/lib/i18n";
import type { SmtpAuthMode } from "@/lib/mail-api";
import type { SmtpSignInValue } from "@/lib/smtp-sign-in";

export function SmtpSignInFields({
  value,
  onChange,
  hasStoredPassword = false,
  disabled,
}: {
  value: SmtpSignInValue;
  onChange: (next: SmtpSignInValue) => void;
  /** True when editing a mailbox that already has a separate password stored. */
  hasStoredPassword?: boolean;
  disabled?: boolean;
}) {
  const set = <K extends keyof SmtpSignInValue>(k: K, v: SmtpSignInValue[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-3">
      <Field
        label={tr("Sending (SMTP) sign-in")}
        hint={tr("Most mailboxes send with the same login they receive with.")}
      >
        <RadioGroup
          value={value.smtp_auth}
          disabled={disabled}
          onValueChange={(v) => set("smtp_auth", v as SmtpAuthMode)}
          options={[
            {
              value: "same",
              label: tr("Same as IMAP"),
              hint: tr("One username and password for receiving and sending."),
            },
            {
              value: "separate",
              label: tr("Use different credentials"),
              hint: tr(
                "The outgoing server has its own login — a relay such as SMTP2GO, SES or SendGrid.",
              ),
            },
          ]}
        />
      </Field>
      {value.smtp_auth === "separate" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={tr("SMTP username")}
            required
            hint={tr("The relay's own username — often not an email address.")}
          >
            <Input
              value={value.smtp_user}
              disabled={disabled}
              onChange={(e) => set("smtp_user", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label={tr("SMTP password")}
            required={!hasStoredPassword}
            hint={
              hasStoredPassword
                ? tr("Leave blank to keep the current SMTP password.")
                : undefined
            }
          >
            <Input
              type="password"
              value={value.smtp_password}
              disabled={disabled}
              onChange={(e) => set("smtp_password", e.target.value)}
              placeholder="••••••"
              autoComplete="off"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
