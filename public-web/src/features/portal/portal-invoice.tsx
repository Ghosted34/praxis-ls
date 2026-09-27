/**
 * One invoice row in the client portal, with what it was FOR behind a toggle.
 *
 * Meeting 5 (21 Sep 2026): the portal showed an invoice's number, due date and
 * total, and nothing about what had been billed. The lines come from
 * `/client/invoice/:id`, grouped by family exactly as the printed invoice groups
 * them — "Customs Formalities", "Freight & Carrier Charges" — so the client
 * reads the same breakdown on the screen as on the PDF, never the costing
 * detail behind it. Loaded on first open; most visits never expand a row.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { num, dateFmt } from "@/lib/format";
import { ErrorState } from "@/components/state";
import {
  portalClientInvoice,
  type PortalInvoice,
  type PortalInvoiceDetail,
} from "@/lib/portal-api";
import { label } from "./portal-auth";

export function PortalInvoiceRow({ invoice }: { invoice: PortalInvoice }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<PortalInvoiceDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open || detail) return;
    let live = true;
    setError(null);
    portalClientInvoice(invoice.invoice_id, i18n.language)
      .then((d) => live && setDetail(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [open, detail, invoice.invoice_id, i18n.language]);

  const inv = detail?.invoice;
  const ccy = inv?.currency || invoice.currency || "";

  return (
    <li className="py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{invoice.doc_number || "—"}</p>
          <p className="text-xs text-muted-foreground">Due {dateFmt(invoice.payment_due_on)}</p>
        </div>
        <div className="text-right">
          <p className="num text-sm text-foreground">{num(invoice.total_ttc)}</p>
          <span className="status">{label(invoice.status)}</span>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 text-xs font-medium text-primary-ink underline underline-offset-2 hover:opacity-80"
      >
        {open ? t("portal.invoiceHideLines") : t("portal.invoiceShowLines")}
      </button>
      {open && (
        <div id={panelId} className="mt-2 rounded-md border p-3">
          {error ? (
            <ErrorState message={error} />
          ) : !detail ? (
            <p className="text-xs text-muted-foreground">{t("portal.invoiceLinesLoading")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-2 text-foreground">
                      {l.label}
                      {l.is_disbursement && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({t("portal.invoiceDisbursement")})
                        </span>
                      )}
                    </td>
                    <td className="num py-1.5 text-right text-foreground">{num(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {inv && (
                <tfoot className="text-xs text-muted-foreground">
                  <tr>
                    <td className="pt-2">{t("portal.invoiceSubtotal")}</td>
                    <td className="num pt-2 text-right">{num(inv.service_ht)}</td>
                  </tr>
                  {inv.disbursement_total > 0 && (
                    <tr>
                      <td>{t("portal.invoiceDisbursements")}</td>
                      <td className="num text-right">{num(inv.disbursement_total)}</td>
                    </tr>
                  )}
                  <tr>
                    <td>{t("portal.invoiceVat")}</td>
                    <td className="num text-right">{num(inv.vat_total)}</td>
                  </tr>
                  <tr className="text-sm font-semibold text-foreground">
                    <td className="pt-1">{t("portal.invoiceTotal")}</td>
                    <td className="num pt-1 text-right">
                      {num(inv.total_ttc)} {ccy}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}
    </li>
  );
}
