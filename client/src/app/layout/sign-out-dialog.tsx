/**
 * Sign out — one confirm, and nothing on this device is forgotten.
 *
 * Signing out ends the SESSION. It does not touch what the device knows about
 * its person: the greeting, and the passkey that lives here. Owner decision,
 * 29 Sep 2026: "the only way a passkey is taken off a device is if the user
 * explicitly removes it." There used to be a "Remember me on this device"
 * checkbox here; unticking it erased the device's record of the passkey — the
 * one credential that signs documents — as a side effect of signing out. It is
 * gone, and so is the code path behind it (auth-context's logout removes
 * session keys only; lib/device-keys.ts lists what it never touches).
 *
 * The line under the title says so, because people sign out expecting to be
 * forgotten and then wonder why the screen still greets them. Removing a
 * passkey is in My security, where it is a deliberate, audited act.
 */
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";

export function SignOutDialog({
  open,
  onClose,
  onSignOut,
  busy,
  /** Whose account is being signed out, so the dialog can name them. */
  email,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  busy?: boolean;
  email?: string | null;
}) {
  const { t } = useTranslation();

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
            onClick={onSignOut}
            disabled={busy}
            className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("shell.signOut")}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("shell.signOutKeeps")}</p>
    </Dialog>
  );
}
