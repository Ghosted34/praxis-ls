/**
 * The "Sending (SMTP) sign-in" choice, as data.
 *
 * Split from the component that renders it because these four are pure — they
 * are the rules about what the mailbox forms SEND and when they may send it, and
 * three separate forms plus their tests need them without needing a radio group.
 * (The lint rule that insists on the split is right for a second reason: a file
 * exporting both a component and constants breaks fast refresh.)
 *
 * THE RULES, in one place because they are one rule seen from three sides:
 *
 *   · The mode follows the SECRET, never the username. A `smtp_user` left on a
 *     row whose password has been cleared is not a second sign-in, and pairing
 *     it with the IMAP password would offer one leg's user with the other leg's
 *     secret. The server derives the mode the same way; this must not disagree.
 *   · A blank SMTP password on an EDIT keeps the stored one — the same
 *     convention the mailbox password field has always had — and on a CREATE is
 *     a real gap, because there is nothing to keep.
 *   · Shared mode sends the MODE ALONE. The mode already tells the server to
 *     drop the stored secret; also sending a blank username would describe the
 *     same clearing twice and give the two halves a way to disagree.
 */
import type { SmtpAuthMode } from "@/lib/mail-api";

export type SmtpSignInValue = {
  smtp_auth: SmtpAuthMode;
  smtp_user: string;
  smtp_password: string;
};

export const BLANK_SMTP_SIGN_IN: SmtpSignInValue = {
  smtp_auth: "same",
  smtp_user: "",
  smtp_password: "",
};

/**
 * Reopen an existing mailbox in the mode it is actually in.
 *
 * The server derives `smtp_auth` from whether a separate secret exists, so this
 * needs no local guess. `has_smtp_credentials` is read as a fallback for a
 * response that carries only the boolean. The password is deliberately blank:
 * it is never sent to the client, and a blank one on save keeps the stored one.
 */
export function smtpSignInFrom(existing?: {
  smtp_auth?: SmtpAuthMode;
  has_smtp_credentials?: boolean;
  smtp_user?: string | null;
}): SmtpSignInValue {
  const separate = existing?.smtp_auth === "separate" || existing?.has_smtp_credentials === true;
  return {
    smtp_auth: separate ? "separate" : "same",
    smtp_user: existing?.smtp_user || "",
    smtp_password: "",
  };
}

/**
 * The fields to send, given the chosen mode.
 *
 * In "same" mode the two credential fields are NOT sent — sending a blank
 * username alongside `smtp_auth: "same"` would be describing the same clearing
 * twice, and the mode alone already tells the server to drop the stored secret.
 */
export function smtpSignInBody(v: SmtpSignInValue) {
  if (v.smtp_auth !== "separate") return { smtp_auth: "same" as const };
  return {
    smtp_auth: "separate" as const,
    smtp_user: v.smtp_user,
    ...(v.smtp_password ? { smtp_password: v.smtp_password } : {}),
  };
}

/**
 * Is the form complete enough to submit?
 *
 * `hasStoredPassword` is what makes a blank password legal on an EDIT — the
 * stored one is kept, exactly as the mailbox password field already behaves —
 * and illegal on a create, where there is nothing to keep.
 */
export function smtpSignInReady(v: SmtpSignInValue, hasStoredPassword = false) {
  if (v.smtp_auth !== "separate") return true;
  return Boolean(v.smtp_user) && (Boolean(v.smtp_password) || hasStoredPassword);
}
