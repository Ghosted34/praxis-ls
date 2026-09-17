/**
 * Sign out — the question, and the answer that decides whether this device
 * keeps remembering you.
 *
 * ── WHY A DIALOG AND NOT JUST A MENU ITEM ───────────────────────────────────
 *
 * The device now stores the account it belongs to, so the sign-in screen opens
 * with a greeting and a Quick PIN / passkey instead of an email box. That is a
 * deliberate feature and it has one consequence that has to be handled
 * somewhere: "sign out" no longer means the machine forgets you, and on a
 * SHARED workstation it is not obvious which of those two things the person
 * signing out actually wants. Guessing either way gets it wrong for half the
 * user base — silently keeping the identity looks like the app refusing to let
 * go of an account, and silently dropping it makes the next morning's sign-in
 * a password sign-in on a laptop that has a working Touch ID.
 *
 * So the choice is asked, once, at the only moment anyone knows the answer: the
 * moment they are leaving. Both options are named for their OUTCOME rather than
 * their mechanism, because "Sign out" and "Sign out and remove this account"
 * are two different promises about what the next person will see.
 *
 * WHAT "REMOVE" ACTUALLY REMOVES is in `onSignOutAndForget`'s caller, not here
 * — this component only asks the question. The card's body copy says what will
 * happen, so the sentence and the behaviour have to stay in step.
 */
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";
import { LogoutIcon } from "@/app/layout/nav-icons";

export function SignOutDialog({
  open,
  onClose,
  onSignOut,
  onSignOutAndForget,
  busy,
  /** Whose account is being released, so the sentence can name them. */
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
  const who = email?.trim() || null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("shell.signOutTitle")}
      description={t("shell.signOutDescription")}
      size="md"
      /*
        Three answers, not two, and the ORDER is the argument: the plain sign-out
        is first and primary because it is what almost everyone wants and it is
        reversible; removing the account is last and visually quieter because it
        is the one that changes what the next person sees, and it is not the
        button a hurried click should land on.
      */
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-outline h-9 rounded-md px-3 text-sm"
          >
            {t("shell.signOutStay")}
          </button>
          <button
            type="button"
            onClick={onSignOutAndForget}
            disabled={busy}
            className="h-9 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {t("shell.signOutForget")}
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
      <div className="flex flex-col gap-4">
        {who && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
              aria-hidden
            >
              {who.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{who}</p>
              <p className="micro text-muted-foreground">
                {t("shell.signOutStored")}
              </p>
            </div>
          </div>
        )}

        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-semibold">{t("shell.signOut")}</dt>
            <dd className="text-muted-foreground">{t("shell.signOutKeeps")}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t("shell.signOutForget")}</dt>
            <dd className="text-muted-foreground">
              {t("shell.signOutRemoves")}
            </dd>
          </div>
        </dl>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <LogoutIcon width={14} height={14} aria-hidden />
          {t("shell.signOutShared")}
        </p>
      </div>
    </Dialog>
  );
}
