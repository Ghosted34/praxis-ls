/**
 * Drop-in mail icon for any 360 / list row: opens the Master Composer —
 * via NewMessageDialog, the only compose wrapper in the product — prefilled
 * to an address and sending from the user's default mailbox.
 * e.g. <ComposeIconButton to={client.email} />
 *
 * The To is prefilled and stays EDITABLE: the operator may add colleagues to
 * the mail. The old legacy wrapper locked the field; that behaviour was
 * dropped by design and must not come back.
 */
import * as React from "react";
import { NewMessageDialog } from "./new-message";
import { tr } from "@/lib/i18n";

export function ComposeIconButton({
  to,
  entityRef,
  className,
}: {
  to?: string;
  entityRef?: string | null;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tr("Compose email")}
        title={tr("Compose email")}
        className={
          className ||
          "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        }
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none"
             stroke="currentColor" strokeWidth={1.8}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </button>
      {open && (
        <NewMessageDialog
          open
          onClose={() => setOpen(false)}
          to={to ? [to] : []}
          entityRef={entityRef ?? null}
        />
      )}
    </>
  );
}
