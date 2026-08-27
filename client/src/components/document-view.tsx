/**
 * DocumentPage — a record shown as its OWN page (route `/documents/:docType/:id`),
 * rendered **natively in the app theme** (cards, dark UI) so it blends — NOT the
 * white print sheet, which is what Download/Send produce as the PDF. Data comes
 * from the template preview endpoint (`data`); reports (which have no record
 * shape) fall back to the paper preview.
 *
 * The generic card view below serves most families (finance / procurement / HR /
 * fleet / WMS). The operations documents — DELIVERY_NOTE and TRANSIT_ORDER —
 * render through bespoke native bodies (DeliveryNoteBody / TransitOrderBody)
 * that lay out the SAME preview data block-for-block with the registry
 * template, so the on-screen snapshot and the printed/PDF document tell the
 * same story without importing the white sheet into the dark UI.
 */
import { pageShell } from "@/lib/layout";
import { tr, currentLocale } from "@/lib/i18n";
import * as React from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { tenant } from "@/lib/api-client";
import { downloadVaultDoc } from "@/lib/vault-file";
import { errMsg } from "@/lib/use-resource";
import { num, money, dateFmt, enumLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { LoadingRow } from "@/components/ui/states";
import { NewMessageDialog } from "@/features/comms/inbox/composer/new-message";

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
type Container = {
  container_no?: string | null;
  seal_no?: string | null;
  gross_weight_kg?: number | null;
  /** 10708 — the GROUPED shape: equipment the file states as a quantity
   *  because the B/L has not numbered the boxes yet. */
  container_type_code?: string | null;
  qty?: number | null;
  /** Why a box another signed note already covers is going out again. */
  redelivery_reason?: string | null;
};

/**
 * Where this delivery sits on its file, derived from the other notes.
 *
 * Null for a file with no containers — a non-containerised note says nothing
 * about container counts, and "0 of 0" is not an improvement on silence.
 */
type DeliveryPosition = {
  sequence?: number | null;
  of_notes?: number | null;
  total: number;
  delivered: number;
  in_transit: number;
  outstanding: number;
};
type Regime = { code: string; on?: boolean };
/**
 * A checklist row. `label` is a {fr,en} PAIR, not a string.
 *
 * It used to arrive pre-joined as "Facture / Invoice", which is exactly why the
 * printed transit order was bilingual on every line however the tenant had
 * configured it — the projection had already picked both. The pair is resolved
 * here, and on the PDF, against the language of the render.
 */
type LangPair = { fr?: string; en?: string };
type DocChecklistItem = { code: string; label: string | LangPair; on?: boolean };

/** One side of a {fr,en} pair, for the operator's own UI language. A plain
 *  string is passed through — some projections still emit one. */
const pick = (v?: string | LangPair | null): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  const fr = currentLocale().startsWith("fr");
  return String((fr ? v.fr : v.en) ?? v.en ?? v.fr ?? "");
};
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
  /* a vaulted generated PDF (e.g. the default-language PDF produced when a
     proposal was sent) — download that instead of re-rendering one */
  pdf_vault_id?: string | null;
  currency?: string;
  /* delivery note (operations/delivery_note) */
  delivery_date?: string;
  dossier_ref?: string;
  reservations?: string;
  received_by_name?: string;
  received_at?: string;
  issued_by_name?: string;
  containers?: Container[];
  position?: DeliveryPosition | null;
  /* transit order (operations/transit_order) */
  /** The lifecycle in the reader's language. Replaced `status_label`, which the
   *  projection used to emit pre-joined as "Émis / Issued". */
  status_words?: LangPair;
  direction?: string;
  client?: string;
  conveyance?: string;
  transport_ref?: string;
  arrival_date?: string;
  departure_date?: string;
  place_of_delivery?: string;
  declared_value_text?: string;
  declared_value_xaf_text?: string;
  regimes?: Regime[];
  customs_regime_other?: string;
  insurance_type?: string;
  surveyor_party?: string;
  documents?: DocChecklistItem[];
  instructions?: string;
  issued_date?: string;
  signed_date?: string;
  lodged_date?: string;
  signed_by_name?: string;
  [k: string]: unknown;
};

const PARTY_LABEL: Record<string, string> = {
  PURCHASE_ORDER: "Supplier",
  SUPPLIER_INVOICE: "Supplier",
  EMPLOYMENT_CONTRACT: "Employee",
  PAYSLIP: "Employee",
  DELIVERY_NOTE: "Consignee",
  TRIP_SHEET: "Vehicle",
  PURCHASE_REQUEST: "Requested by",
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
  report?: boolean;
  /** The language this render came out in — the tenant's configured default
   *  until the operator picks otherwise. "bilingual" is a real, chosen value. */
  language?: string;
};

/**
 * What the server hands back when Send is pressed: the vaulted PDF, who it goes
 * to, and the covering note — all in the language the operator picked.
 */
type ComposePrefill = {
  doc_type: string;
  record_id: string;
  language: string;
  vault_id: string;
  filename: string;
  to: string | null;
  subject: string;
  body: string;
  counterparty: {
    party_id: string;
    party_name: string;
    contacts: { name: string | null; email: string; role: string | null; source_ref: string }[];
  } | null;
};

/** A language the operator can pick for one render. */
type DocLang = "fr" | "en";

/** The issuing entity renders as the "From" party. The preview returns it as
 *  { legal_name, niu, rccm } — map those onto the Party shape PartyCol expects
 *  (name/lines), otherwise "From" shows "—" while the PDF template shows it. */
const fromParty = (e?: Entity): Party | undefined =>
  e
    ? {
        name: e.legal_name,
        lines: [e.niu && `NIU ${e.niu}`, e.rccm && `RCCM ${e.rccm}`].filter(
          Boolean,
        ) as string[],
      }
    : undefined;

const STATUS_TONE = (s?: string): Tone => {
  const u = String(s || "").toUpperCase();
  if (/PAID|APPLIED|VALIDATED|SIGNED|DONE|DELIVERED|ACCEPTED|LOCKED/.test(u))
    return "ok";
  if (/SENT|ISSUED|OUT|OPEN|IN_PROGRESS|SUBMITTED/.test(u)) return "blue";
  if (/REJECT|CANCEL|REVERSED|OVERDUE|FAIL/.test(u)) return "bad";
  if (/DRAFT|HOLD|PENDING/.test(u)) return "mute";
  return "mute";
};

const Card: React.FC<{
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, children, action }) => (
  <div className="lux-card p-5">
    {(title || action) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        {title && <div className="micro">{title}</div>}
        {action}
      </div>
    )}
    {children}
  </div>
);
const KV: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <div className="micro mb-0.5">{label}</div>
    <div className="text-sm text-foreground">{children || "—"}</div>
  </div>
);
const PartyCol: React.FC<{ label: string; p?: Party }> = ({ label, p }) => (
  <div>
    <div className="micro mb-1">{label}</div>
    <div className="font-medium text-foreground">{(p && p.name) || "—"}</div>
    <div className="text-sm text-muted-foreground">
      {(p && p.lines ? p.lines.filter(Boolean) : []).join(" · ")}
    </div>
  </div>
);

function LineTable({
  cols,
  rows,
}: {
  cols: { key: string; label: string; num?: boolean }[];
  rows: Line[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 font-medium ${c.num ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-3 py-4 text-center micro">
                No lines
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${c.num ? "num text-right" : ""}`}
                  >
                    {String(r[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Bespoke native bodies ─────────────────────────────────────────────────
 * The generic card view below serves the finance/procurement/HR/fleet family
 * fine, but operations documents carry fields it has no vocabulary for:
 * a delivery note is containers + reservations + who signed; a transit order
 * is vessel/BL/ports + regime + insurance + a document checklist. The white
 * print sheet cannot be shown in-app (it does not blend with the dark UI), so
 * these render the SAME preview data natively, block for block with the PDF.
 */

/**
 * DELIVERY_NOTE — proof of delivery. Block-for-block with the registry
 * template (head meta, consignee, cargo lines, container manifest, the
 * client's reservations, and the named received-by) so the on-screen snapshot
 * and the printed note tell the same story.
 */
function DeliveryNoteBody({ d, entity }: { d: DocData; entity?: Entity }) {
  const party = d.party;
  const lines = (d.lines || []) as Line[];
  const containers = d.containers || [];
  const pos = d.position || null;
  return (
    <div className={cn(pageShell.reading, "space-y-4 pb-10")}>
      <Card>
        <div className="grid gap-5 sm:grid-cols-2">
          <PartyCol label="From" p={fromParty(entity)} />
          <PartyCol label="Consignee" p={party} />
        </div>
      </Card>

      <Card title="Delivery details">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {d.date && <KV label="Date">{dateFmt(d.date)}</KV>}
          {d.delivery_date && (
            <KV label="Delivery date">{dateFmt(d.delivery_date)}</KV>
          )}
          {d.dossier_ref && <KV label="File">{d.dossier_ref}</KV>}
          {/* The lifecycle in the reader's language — the same {fr,en} pair the
              printed sheet resolves, never a pre-joined "Émis / Issued". */}
          {d.status_words && <KV label="Status">{pick(d.status_words)}</KV>}
          {d.issued_by_name && (
            <KV label="Issued by">{d.issued_by_name}</KV>
          )}
        </div>
        {party && party.lines && party.lines.filter(Boolean).length > 0 && (
          <div className="mt-4 border-t border-line pt-3 text-sm text-muted-foreground">
            {(party.lines as string[]).filter(Boolean).join(" · ")}
          </div>
        )}
      </Card>

      {/*
        * WHERE THIS DELIVERY SITS IN THE FILE — the band the printed sheet
        * carries, on screen for the same reason: the driver and the client's
        * gatekeeper both need to know whether more is coming.
        *
        * Only when the file has more than one box. "Delivery 1 of 1, 0
        * remaining" is noise, and the template omits it on the same test.
        */}
      {pos && pos.total > 1 && (
        <Card title="Delivery progress">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <KV label="Delivery">
              {pos.sequence ? `${pos.sequence}${pos.of_notes ? ` / ${pos.of_notes}` : ""}` : "—"}
            </KV>
            <KV label="Containers delivered">
              {pos.delivered} / {pos.total}
            </KV>
            {/* In transit is its OWN figure: a box on another issued note is
                neither delivered nor waiting to be sent, and "0 still to come"
                while four are on a truck is how a second truck gets sent. */}
            <KV label={pos.in_transit ? "Out for delivery" : "Still to come"}>
              {pos.in_transit || pos.outstanding}
              {pos.in_transit && pos.outstanding ? (
                <span className="text-muted-foreground"> · {pos.outstanding} to come</span>
              ) : null}
            </KV>
          </div>
        </Card>
      )}

      <Card title={`Containers (${containers.length})`}>
        {containers.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {containers.map((c, i) => (
              <li key={c.container_no || i} className="text-sm">
                {c.container_type_code ? (
                  // The GROUPED shape: the manifest states the equipment the
                  // way the file does, before any box has a number.
                  <span className="font-medium">
                    {c.qty ?? 1} × {c.container_type_code}
                    <span className="text-muted"> — numbers not yet on file</span>
                  </span>
                ) : (
                  <>
                    <span className="num font-medium">{c.container_no || "—"}</span>
                    {c.seal_no && (
                      <span className="text-muted"> · seal {c.seal_no}</span>
                    )}
                    {c.gross_weight_kg != null && (
                      <span className="text-muted">
                        {" "}
                        · {num(c.gross_weight_kg)} kg
                      </span>
                    )}
                  </>
                )}
                {c.redelivery_reason && (
                  <span className="block text-xs text-muted-foreground">
                    ↻ {c.redelivery_reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No containers on this note.</p>
        )}
      </Card>

      {lines.length > 0 && (
        <Card title="Cargo">
          <LineTable
            cols={[
              { key: "label", label: "Description" },
              { key: "qty", label: "Qty", num: true },
            ]}
            rows={lines.map((l) => ({
              label: l.label ?? "",
              qty: num(Number(l.qty ?? 0)),
            }))}
          />
        </Card>
      )}

      {d.reservations && (
        <Card title="Reservations">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {d.reservations}
          </p>
        </Card>
      )}

      {d.received_by_name && (
        <Card title="Received by">
          <div className="font-medium text-foreground">{d.received_by_name}</div>
          {d.received_at && (
            <div className="text-sm text-muted-foreground">
              {dateFmt(d.received_at)}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * TRANSIT_ORDER — the client's authorisation to declare. Block-for-block with
 * the registry template: shipment facts, the five-column cargo table with the
 * declared value, the regime tick-row, the insurance/surveyor elections and
 * the attached-documents checklist.
 */
function TransitOrderBody({ d, entity }: { d: DocData; entity?: Entity }) {
  const lines = (d.lines || []) as Line[];
  const isImport = String(d.direction || "").toUpperCase() === "IMPORT";
  const insuredByUs = String(d.insurance_type || "CLIENT").toUpperCase() === "COMPANY";
  const surveyorUs = String(d.surveyor_party || "CLIENT").toUpperCase() === "COMPANY";
  return (
    <div className={cn(pageShell.reading, "space-y-4 pb-10")}>
      <Card>
        <div className="grid gap-5 sm:grid-cols-2">
          <PartyCol label="From" p={fromParty(entity)} />
          <div>
            <div className="micro mb-1">Client</div>
            <div className="font-medium text-foreground">{d.client || "—"}</div>
            {d.dossier_ref && (
              <div className="text-sm text-muted-foreground">
                {d.dossier_ref}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title="Shipment">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {d.direction && (
            <KV label="Direction">
              <Pill tone={isImport ? "blue" : "warn"}>
                {String(d.direction).toUpperCase()}
              </Pill>
            </KV>
          )}
          {d.conveyance && <KV label="Vessel">{d.conveyance}</KV>}
          {d.transport_ref && <KV label="Bill of lading">{d.transport_ref}</KV>}
          {d.origin && <KV label="Origin">{d.origin}</KV>}
          {d.arrival_date && (
            <KV label="Arrival date">{dateFmt(d.arrival_date)}</KV>
          )}
          {d.destination && <KV label="Destination">{d.destination}</KV>}
          {d.departure_date && (
            <KV label="Departure date">{dateFmt(d.departure_date)}</KV>
          )}
          {d.place_of_delivery && (
            <KV label="Place of delivery">{d.place_of_delivery}</KV>
          )}
        </div>
      </Card>

      {lines.length > 0 && (
        <Card title="Cargo">
          <LineTable
            cols={[
              { key: "marks", label: "Marks" },
              { key: "packages", label: "Packages", num: true },
              { key: "label", label: "Description" },
              { key: "weight", label: "Weight", num: true },
              { key: "value", label: "Value", num: true },
            ]}
            rows={lines.map((l) => ({
              marks: l.marks ?? "",
              packages: num(Number(l.packages ?? 0)),
              label: l.label ?? "",
              weight: l.weight ?? "",
              value: l.value ?? "",
            }))}
          />
          {(d.declared_value_text || d.declared_value_xaf_text) && (
            <div className="ml-auto mt-3 w-full max-w-xs space-y-1.5 text-sm">
              {d.declared_value_text && (
                <Row label="Declared value" value={d.declared_value_text} />
              )}
              {d.declared_value_xaf_text && (
                <Row label="Equivalent" value={d.declared_value_xaf_text} />
              )}
            </div>
          )}
        </Card>
      )}

      {(d.regimes || []).length > 0 || d.customs_regime_other ? (
        <Card title="Customs regime">
          <div className="flex flex-wrap gap-2">
            {(d.regimes || []).map((r) => (
              <Pill key={r.code} tone={r.on ? "ok" : "mute"}>
                {r.on ? "✓ " : ""}
                {r.code}
              </Pill>
            ))}
            {d.customs_regime_other && (
              <Pill tone="ok">✓ {d.customs_regime_other}</Pill>
            )}
          </div>
        </Card>
      ) : null}

      <Card title="Insurance & damage">
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={insuredByUs ? "text-[rgb(var(--ok))]" : "text-muted"}
            >
              {insuredByUs ? "✓" : "○"}
            </span>
            <span>
              {insuredByUs
                ? "Insurance covered by us"
                : "Insurance carried by the client"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={surveyorUs ? "text-[rgb(var(--ok))]" : "text-muted"}
            >
              {surveyorUs ? "✓" : "○"}
            </span>
            <span>
              {surveyorUs
                ? "Damage surveyor appointed by us"
                : "Damage surveyor appointed by the client"}
            </span>
          </div>
        </div>
      </Card>

      {(d.documents || []).length > 0 && (
        <Card title="Attached documents">
          <ul className="grid gap-1 sm:grid-cols-2">
            {(d.documents || []).map((doc) => (
              <li key={doc.code} className="flex items-center gap-2 text-sm">
                <span
                  className={
                    doc.on
                      ? "text-[rgb(var(--ok))]"
                      : "text-muted"
                  }
                >
                  {doc.on ? "✓" : "○"}
                </span>
                <span className={doc.on ? "" : "text-muted"}>
                  {pick(doc.label)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d.instructions && (
        <Card title="Instructions">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {d.instructions}
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * FR / EN, for one document, at the moment it is produced.
 *
 * Two buttons rather than a select: there are exactly two, the current one has
 * to be readable at a glance beside Download, and a two-option dropdown costs a
 * click to tell you what it already knows. Neither reads active when the tenant
 * has configured "bilingual" — that is a third, deliberate state, and lighting
 * one of these would misreport what the page is showing.
 */
function LangPick({
  value,
  onChange,
}: {
  value?: DocLang;
  onChange: (l: DocLang) => void;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-md border border-[rgb(var(--ink)/0.14)]"
      role="group"
      aria-label={tr("Document language")}
    >
      {(["fr", "en"] as DocLang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={value === l}
          title={l === "fr" ? tr("Print this document in French") : tr("Print this document in English")}
          className={cn(
            "px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
            value === l
              ? "bg-[rgb(var(--accent))] text-white"
              : "text-muted-foreground hover:bg-[rgb(var(--ink)/0.06)]",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

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
  /**
   * The language THIS operator wants THIS document in.
   *
   * `null` means "whatever the tenant configured for this doc type" — the
   * common case, and the one that must not require a click. A pick is deliberately
   * per-render and not persisted: it is a property of who this copy is going to,
   * not of the tenant, and the operator is the only one who knows that. It rides
   * on the preview, the PDF and the email alike, so the copy on screen is the
   * copy that gets sent.
   */
  const [lang, setLang] = React.useState<DocLang | null>(null);

  /** The prefill the composer opens on — null until Send has fetched it. */
  const [compose, setCompose] = React.useState<ComposePrefill | null>(null);

  React.useEffect(() => {
    let live = true;
    setError(null);
    setPv(null);
    tenant<Preview>(`/document-templates/${docType}/preview`, {
      method: "POST",
      body: { record_id: id, ...(lang ? { language: lang } : {}) },
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
  }, [docType, id, lang]);

  async function download() {
    setBusy("dl");
    setError(null);
    setNote(null);
    try {
      const d = pv?.data;
      // A readable filename: the doc number when there is one, else the title,
      // else the doc type — never a bare UUID.
      const base = String(
        d?.number || (pv?.title && (pv.title.en || pv.title.fr)) || docType,
      )
        .replace(/[^\w.-]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const filename = `${base || docType.toLowerCase()}.pdf`;
      // 1. An uploaded signed copy (e.g. a countersigned contract) is the
      //    authoritative file — prefer it over any re-render.
      const signed = d?.signed_vault_id;
      if (signed) {
        await downloadVaultDoc(String(signed), filename);
        return;
      }
      // 2. A vaulted PDF already produced for this record (e.g. a SENT
      //    proposal) — reuse it rather than rendering a new one.
      const vaulted = d?.pdf_vault_id;
      if (vaulted) {
        await downloadVaultDoc(String(vaulted), filename);
        return;
      }
      // 3. Nothing on file yet: render and vault a fresh PDF, then download
      //    the vaulted copy. It is deliberately NOT opened via `public_url` —
      //    generated documents are private, so `/media/<key>` answers 404 for
      //    them (media-guard allow-list); the auth-gated vault download is the
      //    only route that serves them.
      const out = await tenant<{ doc_id?: string }>(
        `/document-templates/${docType}/generate`,
        { method: "POST", body: { record_id: id, ...(lang ? { language: lang } : {}) } },
      );
      if (out.doc_id) await downloadVaultDoc(String(out.doc_id), filename);
      else setNote("Generated and stored in the document vault.");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  /**
   * Open the composer on this document.
   *
   * ── What this replaced ────────────────────────────────────────────────────
   * `window.prompt("Send document to (email):")`. One address, typed from
   * memory; no cc, no subject, no body, and no sight of what was about to leave
   * the building. It fired a transactional system email that never appeared in
   * the sender's own Sent folder, so the record of what a client had been told
   * lived nowhere a human could find it.
   *
   * The server does the work that has to happen before a composer can open:
   * renders and vaults the PDF in the chosen language, resolves the client the
   * document is addressed to, and returns the subject and body written beside
   * the template that produced the sheet. One round trip, because a compose
   * window that opens empty and fills in piecemeal invites somebody to start
   * typing into a form that is still moving.
   */
  async function send() {
    setBusy("send");
    setError(null);
    setNote(null);
    try {
      const p = await tenant<ComposePrefill>(
        `/document-templates/${docType}/${id}/compose`,
        { method: "POST", body: { ...(lang ? { language: lang } : {}) } },
      );
      setCompose(p);
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
  const ccy = (d && d.currency) || "XAF";

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
        <div className="flex items-center gap-2">
          <LangPick value={lang ?? (pv?.language as DocLang | undefined)} onChange={setLang} />
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

      {/*
        * The composer, opened on this document.
        *
        * `recipientExtras` carries the client THIS document is addressed to,
        * resolved from the record rather than from the address-book search —
        * which is gated on the party registers (MOD-03 / MOD-04 / MOD-02 /
        * MOD-20). An operations clerk who may raise a transit order and may not
        * browse the client register still has to be able to email it to the
        * client it names.
        */}
      {compose && (
        <NewMessageDialog
          open
          title={`${tr("Send")} ${heading}`}
          onClose={() => setCompose(null)}
          onSent={() => setNote(tr("Sent — it is in your Sent folder and on the record."))}
          to={compose.to ? [compose.to] : []}
          subject={compose.subject}
          bodyText={compose.body}
          vaultAttachments={[{ vault_id: compose.vault_id, filename: compose.filename }]}
          recipientExtras={(compose.counterparty?.contacts || []).map((c) => ({
            name: c.name || compose.counterparty?.party_name || c.email,
            email: c.email,
            note: c.role || compose.counterparty?.party_name || null,
          }))}
          entityRef={`${compose.doc_type.toLowerCase()}:${compose.record_id}`}
          languageNote={`${
            compose.language === "fr" ? tr("French") : compose.language === "en" ? tr("English") : tr("Bilingual")
          } — ${tr("the attached document and this note are both in that language.")}`}
        />
      )}

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
      ) : pv.report || !d ? (
        /* Reports have no record shape → show the branded paper preview. */
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
      ) : docType === "DELIVERY_NOTE" ? (
        /* Native, app-themed — block-for-block with the printed note. */
        <DeliveryNoteBody d={d} entity={pv.entity} />
      ) : docType === "TRANSIT_ORDER" ? (
        /* Native, app-themed — block-for-block with the printed order. */
        <TransitOrderBody d={d} entity={pv.entity} />
      ) : (
        /* Native, app-themed detail — blends with the dark UI. */
        <div className={cn(pageShell.reading, "space-y-4 pb-10")}>
          <Card>
            <div className="grid gap-5 sm:grid-cols-2">
              <PartyCol label="From" p={fromParty(pv.entity)} />
              {(d.party || (d.parties && d.parties[1])) && (
                <PartyCol
                  label={PARTY_LABEL[docType] || "Client"}
                  p={d.party || (d.parties && d.parties[1])}
                />
              )}
            </div>
          </Card>

          {(d.date ||
            d.due ||
            d.valid_until ||
            d.period ||
            d.method ||
            d.po_ref ||
            d.original_ref ||
            d.reason ||
            d.supplier ||
            d.vehicle ||
            d.driver ||
            d.location ||
            d.staff_no ||
            d.kind ||
            d.effective_on ||
            d.end_on ||
            d.qa_status ||
            d.department ||
            d.odometer_out != null ||
            d.odometer_in != null ||
            d.distance != null ||
            d.origin ||
            d.destination) && (
            <Card>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {d.date && <KV label="Date">{dateFmt(d.date)}</KV>}
                {d.due && <KV label="Due">{dateFmt(d.due)}</KV>}
                {d.valid_until && (
                  <KV label="Valid until">{dateFmt(d.valid_until)}</KV>
                )}
                {d.kind && <KV label="Type">{enumLabel(d.kind)}</KV>}
                {d.effective_on && (
                  <KV label="Effective">{dateFmt(d.effective_on)}</KV>
                )}
                {d.end_on && <KV label="Ends">{dateFmt(d.end_on)}</KV>}
                {d.period && <KV label="Period">{d.period}</KV>}
                {d.department && <KV label="Department">{d.department}</KV>}
                {d.method && <KV label="Method">{d.method}</KV>}
                {d.po_ref && <KV label="PO ref">{d.po_ref}</KV>}
                {d.qa_status && <KV label="QA">{enumLabel(d.qa_status)}</KV>}
                {d.original_ref && <KV label="Original">{d.original_ref}</KV>}
                {d.reason && <KV label="Reason">{d.reason}</KV>}
                {d.supplier && <KV label="Supplier">{d.supplier}</KV>}
                {d.vehicle && <KV label="Vehicle">{d.vehicle}</KV>}
                {d.driver && <KV label="Driver">{d.driver}</KV>}
                {d.location && <KV label="Location">{d.location}</KV>}
                {d.staff_no && <KV label="Staff no.">{d.staff_no}</KV>}
                {(d.origin || d.destination) && (
                  <KV label="Route">{`${d.origin || ""} → ${d.destination || ""}`}</KV>
                )}
                {d.odometer_out != null && (
                  <KV label="Odometer out">{`${num(d.odometer_out)} km`}</KV>
                )}
                {d.odometer_in != null && (
                  <KV label="Odometer in">{`${num(d.odometer_in)} km`}</KV>
                )}
                {d.distance != null && (
                  <KV label="Distance">{`${num(d.distance)} km`}</KV>
                )}
              </div>
            </Card>
          )}

          {d.description && (
            <Card title="Description">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {d.description}
              </p>
            </Card>
          )}
          {d.headline && (
            <Card>
              <div className="font-display text-xl">{d.headline}</div>
            </Card>
          )}
          {d.sections &&
            d.sections.map((s) => (
              <Card key={s.title} title={s.title}>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {s.body}
                </p>
              </Card>
            ))}
          {d.articles &&
            d.articles.map((s) => (
              <Card key={s.title} title={s.title}>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {s.body}
                </p>
              </Card>
            ))}
          {d.body && (
            <Card>
              <p className="whitespace-pre-wrap text-sm">{d.body}</p>
            </Card>
          )}

          {d.lines && (
            <Card title="Items">
              <LineTable
                cols={inferCols(d.lines[0], ccy)}
                rows={d.lines.map((l) => fmtRow(l, ccy))}
              />
            </Card>
          )}

          {d.parts && (
            <Card title="Parts & labour">
              <LineTable
                cols={[
                  { key: "label", label: "Part / labour" },
                  { key: "qty", label: "Qty", num: true },
                  { key: "unit_cost", label: "Unit cost", num: true },
                  { key: "total", label: "Total", num: true },
                ]}
                rows={d.parts.map((p) => ({
                  label: p.label,
                  qty: num(p.qty as number),
                  unit_cost: money(p.unit_cost, ccy),
                  total: money(
                    Number(p.qty || 0) * Number(p.unit_cost || 0),
                    ccy,
                  ),
                }))}
              />
            </Card>
          )}

          {d.earnings && (
            <Card title="Earnings">
              <LineTable
                cols={[
                  { key: "label", label: "Item" },
                  { key: "amount", label: "Amount", num: true },
                ]}
                rows={d.earnings.map((e) => ({
                  label: e.label,
                  amount: money(e.amount, ccy),
                }))}
              />
            </Card>
          )}
          {d.deductions && (
            <Card title="Deductions">
              <LineTable
                cols={[
                  { key: "label", label: "Item" },
                  { key: "amount", label: "Amount", num: true },
                ]}
                rows={d.deductions.map((e) => ({
                  label: e.label,
                  amount: money(e.amount, ccy),
                }))}
              />
            </Card>
          )}

          {(d.totals ||
            d.amount != null ||
            d.gross != null ||
            d.cost != null) && (
            <Card>
              <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
                {d.totals?.service_ht != null && (
                  <Row
                    label="Total HT"
                    value={money(d.totals.service_ht, ccy)}
                  />
                )}
                {d.totals?.disbursement_total != null && (
                  <Row
                    label="Disbursement"
                    value={money(d.totals.disbursement_total, ccy)}
                  />
                )}
                {d.totals?.vat_total != null && (
                  <Row label="TVA" value={money(d.totals.vat_total, ccy)} />
                )}
                {d.totals?.total_ttc != null && (
                  <Row
                    label="Total TTC"
                    value={money(d.totals.total_ttc, ccy)}
                    grand
                  />
                )}
                {d.cost != null && (
                  <Row label="Total cost" value={money(d.cost, ccy)} grand />
                )}
                {d.gross != null && (
                  <Row label="Gross" value={money(d.gross, ccy)} />
                )}
                {d.total_deductions != null && (
                  <Row
                    label="Deductions"
                    value={money(d.total_deductions, ccy)}
                  />
                )}
                {d.net != null && (
                  <Row label="Net pay" value={money(d.net, ccy)} grand />
                )}
                {d.amount != null && d.totals == null && d.gross == null && (
                  <Row label="Amount" value={money(d.amount, ccy)} grand />
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  grand,
}: {
  label: string;
  value: string;
  grand?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${grand ? "border-t border-primary pt-2 text-base font-semibold text-foreground" : "text-muted-foreground"}`}
    >
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
function inferCols(sample: Line | undefined, _ccy: string) {
  if (!sample) return [{ key: "label", label: "Item" }];
  const order = [
    "label",
    "item",
    "qty",
    "ordered",
    "received",
    "expected",
    "counted",
    "variance",
    "unit",
    "tax",
    "amount",
    "condition",
    "weight",
  ];
  const labels: Record<string, string> = {
    label: "Description",
    item: "Item",
    qty: "Qty",
    ordered: "Ordered",
    received: "Received",
    expected: "Expected",
    counted: "Counted",
    variance: "Variance",
    unit: "Unit",
    tax: "VAT",
    amount: "Amount",
    condition: "Condition",
    weight: "Weight",
  };
  const numeric = new Set([
    "qty",
    "ordered",
    "received",
    "expected",
    "counted",
    "variance",
    "unit",
    "amount",
    "weight",
  ]);
  return Object.keys(sample)
    .filter((kk) => order.includes(kk))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((kk) => ({ key: kk, label: labels[kk] || kk, num: numeric.has(kk) }));
}
function fmtRow(l: Line, ccy: string): Line {
  const o: Line = {};
  for (const [kk, v] of Object.entries(l)) {
    if (kk === "unit" || kk === "amount") o[kk] = money(v, ccy);
    else if (kk === "tax") o[kk] = v == null ? "" : `${v}%`;
    else if (kk === "qty") o[kk] = num(v as number);
    else o[kk] = v;
  }
  return o;
}

export default DocumentPage;
