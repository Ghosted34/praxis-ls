/**
 * Quote request — write surfaces.
 *
 * Two modals:
 *   - QuoteRequestForm: create / edit. All logistics-scope fields. The
 *     `incoterm` field is required at the validator level (matches the
 *     legacy drawer's required mark). A converted or closed request
 *     cannot be edited — the service rejects it and the form just won't
 *     be openable from the list (the row hides the Edit button).
 *   - ConvertToOpportunityModal: opens a pipeline opportunity from a
 *     QUOTED request. The opportunity starts in NEW — staff move it
 *     through the pipeline from there.
 *
 * Plus AttachmentsPanel, which only appears once the request has been saved:
 * an attachment is linked to a row, and there is nothing to link it to while
 * the form is still a draft in the browser. The upload posts the file itself,
 * not a vault id — the server stores the bytes and writes the link in one
 * transaction, and deletes the stored object if that transaction rolls back,
 * so a failed upload leaves nothing behind on either side.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";

const INTAKE_CHANNELS = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];
const SERVICE_CATEGORIES = [
  "SEA_FREIGHT_IMPORT",
  "SEA_FREIGHT_EXPORT",
  "AIR_FREIGHT_IMPORT",
  "AIR_FREIGHT_EXPORT",
  "HINTERLAND_TRANSIT",
  "INLAND_TRANSPORTATION",
  "END_TO_END_AIR_FREIGHT",
  "WAREHOUSING",
  "END_TO_END_SEA_FREIGHT",
  "BUSINESS_REPRESENTATION",
];
const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const WAREHOUSE_DURATIONS = [
  { value: "", label: "Select…" },
  { value: "LESS_THAN_7_DAYS", label: "Less than 7 days" },
  { value: "DAYS_7_TO_14", label: "7–14 days" },
  { value: "DAYS_15_TO_30", label: "15–30 days" },
  { value: "OVER_30_DAYS", label: "Over 30 days" },
  { value: "UNKNOWN", label: "Unknown" },
];

export function QuoteRequestForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [requesterName, setRequesterName] = React.useState("");
  const [requesterCompany, setRequesterCompany] = React.useState("");
  const [requesterEmail, setRequesterEmail] = React.useState("");
  const [requesterPhone, setRequesterPhone] = React.useState("");
  const [intakeChannel, setIntakeChannel] = React.useState("MANUAL");
  const [serviceCategory, setServiceCategory] = React.useState("");
  const [serviceType, setServiceType] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [warehouseLocation, setWarehouseLocation] = React.useState("");
  const [warehouseDuration, setWarehouseDuration] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [projectCargo, setProjectCargo] = React.useState(false);
  const [cargo, setCargo] = React.useState("");
  const [incoterm, setIncoterm] = React.useState("FOB");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRequesterName(editing?.requester_name ? String(editing.requester_name) : "");
    setRequesterCompany(editing?.requester_company ? String(editing.requester_company) : "");
    setRequesterEmail(editing?.requester_email ? String(editing.requester_email) : "");
    setRequesterPhone(editing?.requester_phone ? String(editing.requester_phone) : "");
    setIntakeChannel(editing?.intake_channel ? String(editing.intake_channel) : "MANUAL");
    setServiceCategory(editing?.service_category ? String(editing.service_category) : "");
    setServiceType(editing?.service_type ? String(editing.service_type) : "");
    setOrigin(editing?.origin_location ? String(editing.origin_location) : "");
    setDestination(editing?.destination_location ? String(editing.destination_location) : "");
    setWarehouseLocation(editing?.warehouse_location ? String(editing.warehouse_location) : "");
    setWarehouseDuration(editing?.warehouse_duration ? String(editing.warehouse_duration) : "");
    setWeight(editing?.estimated_weight != null ? String(editing.estimated_weight) : "");
    setProjectCargo(Boolean(editing?.project_cargo_flag));
    setCargo(editing?.cargo_description ? String(editing.cargo_description) : "");
    setIncoterm(editing?.incoterm ? String(editing.incoterm) : "FOB");
    setError(null);
  }, [open, editing]);

  async function save() {
    if (!incoterm.trim()) {
      setError("Incoterm is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        requester_name: requesterName || undefined,
        requester_company: requesterCompany || undefined,
        requester_email: requesterEmail || undefined,
        requester_phone: requesterPhone || undefined,
        intake_channel: intakeChannel,
        service_category: serviceCategory || undefined,
        service_type: serviceType || undefined,
        origin_location: origin || undefined,
        destination_location: destination || undefined,
        warehouse_location: warehouseLocation || undefined,
        warehouse_duration: warehouseDuration || undefined,
        estimated_weight: weight ? Number(weight) : undefined,
        project_cargo_flag: projectCargo,
        cargo_description: cargo || undefined,
        incoterm,
      };
      if (editing?.quote_request_id) {
        await tenant(`/quote-requests/${editing.quote_request_id}`, { method: "PATCH", body: payload });
      } else {
        await tenant(`/quote-requests`, { method: "POST", body: payload });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.public_ref || "request"}` : "Capture quote request"}
      description="The logistics scope of a request for a quote. Incoterm is required."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {editing ? "Save changes" : "Capture request"}
          </Button>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Requester name">
          <Input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
        </Field>
        <Field label="Requester company">
          <Input value={requesterCompany} onChange={(e) => setRequesterCompany(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={requesterEmail}
            onChange={(e) => setRequesterEmail(e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <Input value={requesterPhone} onChange={(e) => setRequesterPhone(e.target.value)} />
        </Field>
        <Field label="Intake channel">
          <Select value={intakeChannel} onChange={(e) => setIntakeChannel(e.target.value)}>
            {INTAKE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Service category">
          <Select value={serviceCategory} onChange={(e) => setServiceCategory(e.target.value)}>
            <option value="">Select…</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Incoterm" required>
          <Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
            {INCOTERMS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Origin">
          <Input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="City, Country"
          />
        </Field>
        <Field label="Destination">
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="City, Country"
          />
        </Field>
        <Field label="Warehouse location">
          <Input value={warehouseLocation} onChange={(e) => setWarehouseLocation(e.target.value)} />
        </Field>
        <Field label="Warehouse duration">
          <Select value={warehouseDuration} onChange={(e) => setWarehouseDuration(e.target.value)}>
            {WAREHOUSE_DURATIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated weight (kg)">
          <Input
            type="number"
            step="0.01"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </Field>
        <Field label="Project cargo">
          <Select
            value={projectCargo ? "yes" : "no"}
            onChange={(e) => setProjectCargo(e.target.value === "yes")}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Cargo description" hint="Up to 5000 characters.">
            <Textarea
              rows={3}
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {editing ? <AttachmentsPanel requestId={String(editing.quote_request_id)} /> : null}
    </Modal>
  );
}

/** 10 MB, and the types the vault accepts for an enquiry attachment. Kept in
 *  step with service.ATTACHMENT_MAX_BYTES / ATTACHMENT_TYPES — the server is
 *  the enforcer; these exist so a 40 MB file is refused before it is read and
 *  base64-expanded in the browser. */
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("That file could not be read"));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

export function AttachmentsPanel({ requestId }: { requestId: string }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pendingRemove, setPendingRemove] = React.useState<Row | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res: any = await tenant(`/quote-requests/${requestId}/attachments`);
      setRows(Array.isArray(res) ? res : res?.data || []);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [requestId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File, kind: "PRIMARY" | "ADDITIONAL") {
    setError(null);
    if (file.size > ATTACH_MAX_BYTES) {
      setError(`${file.name} is larger than 10 MB.`);
      return;
    }
    setBusy(true);
    try {
      await tenant(`/quote-requests/${requestId}/attachments`, {
        method: "POST",
        body: { file: await readAsDataUrl(file), filename: file.name, kind },
      });
      await load();
    } catch (e) {
      // The server's own message is what the operator needs — "this file says
      // it is a PDF but its contents are image/png" is actionable; "Something
      // went wrong" is not.
      setError(errMsg(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(row: Row) {
    setBusy(true);
    setError(null);
    try {
      await tenant(`/quote-requests/${requestId}/attachments/${row.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      setPendingRemove(null);
    }
  }

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="micro">Attachments</p>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ATTACH_ACCEPT}
            className="sr-only"
            id={`qr-attach-${requestId}`}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) void upload(f, (rows || []).some((r) => String(r.kind) === "PRIMARY") ? "ADDITIONAL" : "PRIMARY");
            }}
          />
          <Button
            variant="outline"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            Attach a document
          </Button>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {rows === null ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing attached yet. PDF or image, up to 10 MB — a packing list, a photo of the cargo, a spec sheet.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {rows.map((r) => (
            <li key={String(r.id)} className="flex items-center justify-between py-2">
              <span className="truncate text-sm">
                {String(r.original_name || "document")}
                {String(r.kind) === "PRIMARY" ? <span className="micro ml-2">primary</span> : null}
              </span>
              <Button variant="ghost" onClick={() => setPendingRemove(r)}>
                Detach
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title="Detach this document?"
        body={`${String(pendingRemove?.original_name || "The document")} stays in the vault as a record of what the client sent — detaching only removes it from this request.`}
        confirmLabel="Detach document"
        busy={busy}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && void remove(pendingRemove)}
      />
    </div>
  );
}

export function ConvertToOpportunityModal({
  request,
  onClose,
  onDone,
}: {
  request: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [estimatedValue, setEstimatedValue] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!request) return;
    setName(String(request.requester_company || request.requester_name || "Opportunity"));
    setEstimatedValue("");
    setCurrency("XAF");
    setError(null);
  }, [request]);

  async function convert() {
    if (!request) return;
    if (!name.trim()) {
      setError("Opportunity name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant(`/quote-requests/${request.quote_request_id}/convert-to-opportunity`, {
        method: "POST",
        body: {
          opportunity: {
            name,
            estimated_value: estimatedValue ? Number(estimatedValue) : undefined,
            currency,
          },
        },
      });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Open opportunity from request"
      description="Creates a tracked opportunity in the pipeline. The opportunity starts in NEW — staff move it from there."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={convert} loading={busy}>
            Open opportunity
          </Button>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      {request && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Request">
              <p className="font-mono text-sm text-foreground">
                {String(request.public_ref || request.quote_request_id || "—")}
              </p>
              <p className="text-xs text-muted-foreground">
                {String(request.requester_company || "")}
                {request.service_category ? ` · ${String(request.service_category)}` : ""}
                {request.incoterm ? ` · ${String(request.incoterm)}` : ""}
              </p>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Opportunity name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Estimated value">
            <Input
              type="number"
              step="0.01"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
