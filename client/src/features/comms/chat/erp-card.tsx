/**
 * An ERP record inside a bubble.
 *
 * The card is resolved LIVE on every thread read, against the reader's own
 * permissions — not the sender's, and never from a cached copy of the figures.
 * That is what makes "send me that invoice" age correctly: a bubble from three
 * weeks ago shows what the invoice says today, including that it has since been
 * paid. See src/modules/smartcomm/smartcomm.erp.service.js.
 *
 * ── THE RESTRICTED STATE IS A FIRST-CLASS RENDER, NOT AN ERROR ────────────
 *
 * A channel has members with different jobs. An ops coordinator and a finance
 * controller are both in the dossier channel and only one is supposed to see
 * what the client is being charged, so a reader without rights gets the
 * REFERENCE the sender saw and nothing with a number in it.
 *
 * It says so plainly rather than hiding the attachment. A conversation reading
 * "as discussed, attached" with nothing attached is unreadable, and the reader
 * would reasonably conclude the product had lost something. "INV-2026-0041 —
 * you don't have access to this record" is the true statement, and it is the
 * same thing the product tells them everywhere else.
 */
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import { money, dateDmy } from "@/lib/format";
import type { ErpCard, ErpKind } from "@/lib/smartcomm-api";

const KIND_LABEL: Record<ErpKind, string> = {
  INVOICE: "Invoice",
  DOSSIER: "File",
  CLIENT: "Client",
  PURCHASE_ORDER: "Purchase order",
  SUPPLIER_INVOICE: "Supplier invoice",
};

const KIND_GLYPH: Record<ErpKind, string> = {
  INVOICE: "🧾",
  DOSSIER: "📁",
  CLIENT: "🏢",
  PURCHASE_ORDER: "📋",
  SUPPLIER_INVOICE: "📑",
};

/**
 * Status tone.
 *
 * Token colours only — a raw palette class would stay emerald when the tenant's
 * brand is teal, which is the whole reason `check:palette` exists. The mapping
 * is by MEANING (settled / in flight / stopped), not by the literal string, so
 * a new status lands on neutral rather than on a wrong colour.
 */
function statusTone(status: string | null): string {
  const s = String(status || "").toUpperCase();
  if (/PAID|APPROVED|POSTED|COMPLETED|ACTIVE|RECEIVED|CLOSED/.test(s)) {
    return "border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok-fill)/0.12)] text-foreground";
  }
  if (/CANCELLED|REVERSED|INACTIVE/.test(s)) {
    return "border-[rgb(var(--bad))]/40 bg-[rgb(var(--bad-fill)/0.12)] text-foreground";
  }
  if (/DRAFT|SUBMITTED|MATCHED|OPEN|IN_PROGRESS/.test(s)) {
    return "border-border bg-muted text-muted-foreground";
  }
  return "border-border bg-muted text-muted-foreground";
}

/** ISO in, dd/mm/yyyy out. Never toLocaleDateString with no locale — on a
 *  US-configured workstation that renders month-first and the reader silently
 *  reads the wrong date. See CLAUDE.md and check:dates. */
const shownDate = (iso: string | null) => (iso ? dateDmy(iso) : "");

export function ErpCardView({
  card,
  label,
  className,
}: {
  card: ErpCard | null;
  /** The sender's caption, used when the card could not be resolved at all. */
  label?: string | null;
  className?: string;
}) {
  // No card AND no label means the reference was written before the label was
  // cached. Say something true rather than rendering an empty box.
  if (!card) {
    return (
      <div className={cn("max-w-[320px] rounded-lg border border-border bg-card px-3 py-2", className)}>
        <span className="text-sm text-muted-foreground">
          {label || tr("A record was shared here.")}
        </span>
      </div>
    );
  }

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="text-base leading-none">{KIND_GLYPH[card.kind] || "📄"}</span>
        <span className="text-micro uppercase tracking-wide text-muted-foreground">
          {tr(KIND_LABEL[card.kind] || card.kind)}
        </span>
        {card.status && !card.redacted && (
          <span className={cn("ml-auto rounded-full border px-1.5 py-0.5 text-[10px] leading-none", statusTone(card.status))}>
            {card.status.replace(/_/g, " ").toLowerCase()}
          </span>
        )}
      </div>

      <div className="mt-1 truncate text-sm font-semibold text-foreground">
        {card.title || card.ref || tr("Record")}
      </div>

      {card.redacted ? (
        <div className="mt-0.5 text-micro text-muted-foreground">
          {tr("You don't have access to this record.")}
        </div>
      ) : (
        <>
          {card.subtitle && (
            <div className="mt-0.5 truncate text-micro text-muted-foreground">{card.subtitle}</div>
          )}
          {(card.amount !== null || card.date) && (
            <div className="mt-1 flex items-baseline gap-2">
              {card.amount !== null && (
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {money(card.amount, card.currency)}
                </span>
              )}
              {card.date && (
                <span className="text-micro text-muted-foreground">{shownDate(card.date)}</span>
              )}
            </div>
          )}
        </>
      )}
    </>
  );

  const shell = cn(
    "block max-w-[320px] rounded-lg border border-border bg-card px-3 py-2",
    card.redacted ? "opacity-80" : "transition-colors hover:bg-accent/60",
    className,
  );

  // A redacted card is not a link. Offering one that leads to a 403 is worse
  // than offering none — it reads as a bug rather than as a permission.
  return card.url && !card.redacted ? (
    <Link to={card.url} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
