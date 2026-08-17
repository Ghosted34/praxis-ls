/**
 * DocumentPage — a record shown as its OWN page (route `/documents/:docType/:id`),
 * rendered as the PAPER TEMPLATE itself: the `html` the preview endpoint
 * returns is the same HTML `generate` renders to PDF, so the on-screen view
 * can never drift from the printed document (this was the defect — a generic
 * FROM/DATE/ROUTE/ITEMS body that had nothing to do with the PDF). The
 * topbar (status, Send, Download PDF) stays native to the app; the document
 * body is the white sheet.
 *
 * Reports (which have no record shape) go through the same path: the preview
 * endpoint returns their branded statement as `html`.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { tenant } from "@/lib/api-client";
import { openVaultDoc } from "@/lib/vault-file";
import { errMsg } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import { LoadingRow } from "@/components/ui/states";

// The auth-gated fetch that serves a signed copy (uploaded, rather than
// regenerated) is `lib/vault-file.openVaultDoc` — shared with the scan
// attachments on every master-data register.

const SENDABLE = new Set([
  "FINAL_INVOICE",
  "PROFORMA_ADVANCE",
  "QUOTATION",
  "CREDIT_NOTE",
  "PAYMENT_RECEIPT",
  "PROPOSAL",
  "PURCHASE_ORDER",
  "DELIVERY_NOTE",
  "TRANSIT_ORDER",
  "PAYSLIP",
  "EMPLOYMENT_CONTRACT",
  "DUNNING_LETTER",
]);

type Party = { name?: string; lines?: string[] };
type Line = Record<string, unknown>;
type DocData = {
  number?: string;
  date?: string;
  due?: string;
  valid_until?: string;
  status?: string;
  period?: string;
  method?: string;
  po_ref?: string;
  original_ref?: string;
  reason?: string;
  staff_no?: string;
  supplier?: string;
  vehicle?: string;
  driver?: string;
  location?: string;
  kind?: string;
  effective_on?: string;
  end_on?: string;
  description?: string;
  qa_status?: string;
  department?: string;
  odometer_out?: number;
  odometer_in?: number;
  distance?: number | null;
  origin?: string;
  destination?: string;
  party?: Party;
  parties?: Party[];
  lines?: Line[];
  parts?: Line[];
  totals?: Record<string, number>;
  earnings?: Line[];
  deductions?: Line[];
  gross?: number;
  total_deductions?: number;
  net?: number;
  cost?: number;
  articles?: { title: string; body: string }[];
  amount?: number;
  sections?: { title: string; body: string }[];
  body?: string;
  headline?: string;
  signed_vault_id?: string | null;
  currency?: string;
  [k: string]: unknown;
};

type Entity = {
  legal_name?: string;
  niu?: string;
  rccm?: string;
  address?: string;
};
type Preview = {
  html: string;
  data?: DocData | null;
  title?: { fr?: string; en?: string };
  entity?: Entity;
  suggested_to?: string | null;
  report?: boolean;
};

const STATUS_TONE = (s?: string): Tone => {
  const u = String(s || "").toUpperCase();
  if (/PAID|APPLIED|VALIDATED|SIGNED|DONE|DELIVERED|ACCEPTED|LOCKED/.test(u))
    return "ok";
  if (/SENT|ISSUED|OUT|OPEN|IN_PROGRESS|SUBMITTED/.test(u)) return "blue";
  if (/REJECT|CANCEL|REVERSED|OVERDUE|FAIL/.test(u)) return "bad";
  if (/DRAFT|HOLD|PENDING/.test(u)) return "mute";
  return "mute";
};

export function DocumentPage() {
  const { docType = "", id = "" } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const paramTitle = sp.get("title");
  const sendable = SENDABLE.has(docType);

  const [pv, setPv] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(1100);

  React.useEffect(() => {
    let live = true;
    setError(null);
    setPv(null);
    tenant<Preview>(`/document-templates/${docType}/preview`, {
      method: "POST",
      body: { record_id: id },
    })
      .then((r) => {
        if (live) setPv(r);
      })
      .catch((e) => {
        if (live) setError(errMsg(e));
      });
    return () => {
      live = false;
    };
  }, [docType, id]);

  async function download() {
    setBusy("dl");
    setError(null);
    setNote(null);
    try {
      // Prefer an uploaded signed copy (e.g. a countersigned contract) over the
      // freshly-rendered template.
      const signed = pv?.data?.signed_vault_id;
      if (signed) {
        await openVaultDoc(String(signed));
        return;
      }
      const out = await tenant<{ public_url?: string }>(
        `/document-templates/${docType}/generate`,
        { method: "POST", body: { record_id: id } },
      );
      if (out.public_url) window.open(out.public_url, "_blank");
      else setNote("Generated and stored in the document vault.");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function send() {
    const to = window.prompt(
      "Send document to (email):",
      pv?.suggested_to || "",
    );
    if (!to) return;
    setBusy("send");
    setError(null);
    setNote(null);
    try {
      await tenant(`/document-templates/${docType}/${id}/send`, {
        method: "POST",
        body: { to },
      });
      setNote(`Sent to ${to}.`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const d = pv?.data || null;
  const title =
    paramTitle || (pv?.title && (pv.title.en || pv.title.fr)) || docType;
  const heading = d?.number ? d.number : title;

  return (
    <section className="animate-fade-in">
      <header className="lux-topbar sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:-mx-6 md:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            ← Back
          </Button>
          <h1 className="font-display text-xl tracking-tight">{heading}</h1>
          {d?.status && (
            <Pill tone={STATUS_TONE(d.status)}>{enumLabel(d.status)}</Pill>
          )}
          {d?.signed_vault_id && <Pill tone="ok">Signed copy on file</Pill>}
        </div>
        <div className="flex gap-2">
          {sendable && (
            <Button variant="outline" loading={busy === "send"} onClick={send}>
              Send
            </Button>
          )}
          <Button loading={busy === "dl"} onClick={download}>
            {d?.signed_vault_id ? "Download signed" : "Download PDF"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-auto mb-3 max-w-3xl">
          <ErrorState message={error} />
        </div>
      )}
      {note && (
        <div className="mx-auto mb-3 max-w-3xl rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.08)] px-3 py-2 text-sm">
          {note}
        </div>
      )}

      {!pv ? (
        <div className={pageShell.reading}>
          <LoadingRow label="Loading document…" />
        </div>
      ) : (
        /* The paper template — the exact HTML the PDF renders, so the view
           cannot drift from the printed document. */
        <div className="-mx-4 rounded-2xl bg-[rgb(var(--ink)_/_0.06)] px-4 py-6 md:-mx-6 md:px-6">
          {/* onLoad is a lifecycle event, not a user interaction — the rule
              matches the handler name and cannot make that distinction. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <iframe
            title="document"
            srcDoc={pv.html}
            sandbox="allow-same-origin"
            onLoad={(e) => {
              try {
                const doc = (e.target as HTMLIFrameElement).contentWindow
                  ?.document;
                if (doc && doc.body) setHeight(doc.body.scrollHeight + 48);
              } catch {
                /* blocked */
              }
            }}
            style={{ height }}
            className="mx-auto block w-full max-w-[860px] rounded-md border border-black/5 bg-white shadow-2xl"
          />
        </div>
      )}
    </section>
  );
}

export default DocumentPage;
