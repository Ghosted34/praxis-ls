/**
 * DisconnectMailboxDialog — the confirmation for disconnecting a mailbox.
 *
 * WHY IT IS ITS OWN COMPONENT. Two screens ask this question (Setup → Mailboxes,
 * for any tenant address, and Setup → My mailbox, for your own), both asked it
 * with `window.confirm`, and both depended on the exact wording being read. A
 * native confirm renders in the BROWSER's chrome: no brand, no typography, no
 * red, an OS alert glyph, and "OK"/"Cancel" instead of naming the action. The
 * one property it had — that it cannot be dismissed by clicking away — is
 * reproduced here explicitly (`dismissible={false}`), so nothing is lost by
 * moving into the design system.
 *
 * WHY RED. This is destructive of a credential and it stops mail arriving, so
 * it carries the product's warning red (`--bad` / `--bad-fill`) on the top rule,
 * the header tint, the warning mark and the confirm button — not colour alone:
 * the glyph and the sentence both say what happens.
 *
 * The sentence is the feature. Most people read "disconnect" as "delete my
 * mail", and the difference matters the first time somebody needs last March's
 * bill of lading — so the consequences are laid out as three plain statements
 * rather than one paragraph a person skims.
 */
import { ConfirmDialog } from "@/components/ui/dialog";
import { tr } from "@/lib/i18n";

export function DisconnectMailboxDialog({
  open,
  address,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** The address being disconnected — named in the dialog, never just "this mailbox". */
  address: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      busy={busy}
      destructive
      dismissible={false}
      title={tr("Disconnect this mailbox?")}
      confirmLabel={tr("Disconnect mailbox")}
      cancelLabel={tr("Keep it connected")}
      body={
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            {tr("You are about to disconnect")}{" "}
            <span className="num font-medium">{address}</span>.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--bad-fill))]" />
              <span>{tr("New mail stops arriving.")}</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--bad-fill))]" />
              <span>{tr("The saved password is deleted.")}</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span>
                {tr("Everything already received stays here and stays readable. You can connect the address again later.")}
              </span>
            </li>
          </ul>
        </div>
      }
    />
  );
}
