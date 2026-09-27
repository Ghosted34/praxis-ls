/**
 * Sign out — one confirm, one checkbox.
 *
 * The device stores the account it belongs to, so the sign-in screen opens with
 * a greeting and a Quick PIN / passkey instead of an email box. That means
 * "sign out" no longer implies the machine forgets you, and on a SHARED
 * workstation the person leaving may want it to. So the choice is offered here,
 * the only moment anyone knows the answer — but as a single ticked checkbox,
 * not three buttons and a paragraph each: nobody read the paragraphs.
 *
 * "Remember me on this device" starts TICKED every time the dialog opens. Keeping
 * the identity is what almost everyone wants and it is the reversible choice;
 * unticking it is a deliberate act, which is what a shared-PC sign-out should be.
 * It is deliberately not remembered between openings — one person unticking it
 * must not make the next person's sign-out forget them.
 *
 * WHAT "FORGET" ACTUALLY REMOVES is in `onSignOutAndForget`'s caller
 * (`forgetDeviceAccount()` in lib/device-account.ts), not here.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

export function SignOutDialog({
  open,
  onClose,
  onSignOut,
  onSignOutAndForget,
  busy,
  /** Whose account is being signed out, so the dialog can name them. */
  email,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onSignOutAndForget: () => void;
  busy?: boolean;
  email?: string | null;
}) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(true);

  // Re-tick on every opening — see the header.
  useEffect(() => {
    if (open) setRemember(true);
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("shell.signOutTitle")}
      description={email?.trim() || undefined}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-outline h-9 rounded-md px-3 text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={remember ? onSignOut : onSignOutAndForget}
            disabled={busy}
            className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("shell.signOut")}
          </button>
        </>
      }
    >
      <Checkbox
        checked={remember}
        onCheckedChange={setRemember}
        disabled={busy}
        label={t("shell.signOutRemember")}
        hint={t("shell.signOutRememberHint")}
      />
    </Dialog>
  );
}
