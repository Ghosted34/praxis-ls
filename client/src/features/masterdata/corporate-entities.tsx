/**
 * Master data — corporate entities: the legal companies the tenant invoices as.
 *
 * Split out of `features/masterdata/pages.tsx` in Phase 4 (audit F7).
 *
 * This is the LIST. Clicking a row opens the dossier at
 * /master/corporate-entities/:id (features/masterdata/entity-360.tsx), which is
 * where everything about an entity lives — registrations, people and
 * shareholding, addresses, group structure, treasury.
 *
 * The form here stays deliberately narrow. Creating an entity asks for what is
 * needed to open the file (code, legal name, country, prefix) plus the document
 * and fiscal defaults; the statutory detail is gathered on the dossier over
 * several sittings, which is why an entity can be created as a DRAFT.
 */

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { CountrySelect } from "@/components/country-select";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { useList, errMsg } from "@/lib/use-resource";
import { num, enumLabel } from "@/lib/format";
import { entityCommon } from "@shared";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";

const LIFECYCLE_TONE: Record<string, Tone> = {
  DRAFT: "mute", PENDING_REVIEW: "blue", ACTIVE: "ok",
  SUSPENDED: "orange", DEACTIVATED: "mute", ARCHIVED: "mute",
};

const FRAMEWORKS: { value: api.AccountingFramework; label: string }[] = [
  { value: "OHADA", label: "OHADA (SYSCOHADA révisé)" },
  { value: "IFRS", label: "IFRS" },
  { value: "IFRS_SME", label: "IFRS for SMEs" },
  { value: "US_GAAP", label: "US GAAP" },
  { value: "FR_PCG", label: "France — Plan Comptable Général" },
  { value: "UK_GAAP", label: "UK GAAP" },
  { value: "LOCAL_OTHER", label: "Other local framework" },
];

function EntityForm({ row, entities, onClose, onSaved }: {
  row: api.Entity | null;
  entities: api.Entity[];
  onClose: () => void;
  onSaved: (saved: api.Entity) => void;
}) {
  const isNew = row === null;
  const [code, setCode] = React.useState(row?.code ?? "");
  const [legalName, setLegalName] = React.useState(row?.legal_name ?? "");
  const [tradingName, setTradingName] = React.useState(row?.trading_name ?? "");
  const [legalForm, setLegalForm] = React.useState(row?.legal_form ?? "");
  const [country, setCountry] = React.useState(row?.country_code ?? "CM");
  const [docPrefix, setDocPrefix] = React.useState(row?.doc_prefix ?? "");
  const [lang, setLang] = React.useState(row?.default_language ?? "fr");
  const [fyStart, setFyStart] = React.useState(row?.fiscal_year_start_month != null ? String(row.fiscal_year_start_month) : "1");
  const [framework, setFramework] = React.useState<string>(row?.accounting_framework ?? "OHADA");
  const [incorporated, setIncorporated] = React.useState(row?.incorporation_date ?? "");
  const [description, setDescription] = React.useState(row?.description ?? "");
  const [parentId, setParentId] = React.useState(row?.parent_entity_id ?? "");
  const [relationship, setRelationship] = React.useState<string>(row?.relationship_type ?? "");
  const [logoLight, setLogoLight] = React.useState(row?.logo_light_ref ?? "");
  const [logoBusy, setLogoBusy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A subsidiary's parent can be any other entity — never itself, which the API
  // rejects anyway (rules.assertNoCycle), but offering it would be a trap.
  const parentOptions = entities.filter((x) => x.entity_id !== row?.entity_id);

  /** Entities must exist before a logo can be attached (the upload is keyed by id). */
  async function pickLogo(file: File | null) {
    if (!file || isNew || !row) return;
    setLogoBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const updated = await api.uploadEntityLogo(row.entity_id, dataUrl, "light");
      setLogoLight(updated.logo_light_ref ?? "");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLogoBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.EntityInput = {
      code,
      legal_name: legalName,
      trading_name: tradingName.trim() || null,
      legal_form: legalForm.trim() || null,
      country_code: country || undefined,
      doc_prefix: docPrefix || undefined,
      default_language: lang || undefined,
      fiscal_year_start_month: fyStart === "" ? undefined : Number(fyStart),
      accounting_framework: (framework || null) as api.AccountingFramework | null,
      incorporation_date: incorporated || null,
      description: description.trim() || null,
      parent_entity_id: parentId || null,
      relationship_type: (relationship || null) as api.EntityRelationship | null,
    };
    try {
      const saved = isNew ? await api.createEntity(body) : await api.updateEntity(row!.entity_id, body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "New corporate entity" : "Edit corporate entity"}
      description="A legal entity we bill and report from. The rest of its file — registrations, shareholders, addresses — is on the entity's own page."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required hint="Short unique key"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SLAS" disabled={!isNew} /></Field>
          <Field label="Legal name" required><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Smart Logistics and Services Ltd" /></Field>
          <Field label="Trading name" hint="If it trades under a different name"><Input value={tradingName ?? ""} onChange={(e) => setTradingName(e.target.value)} /></Field>
          <Field label="Legal form" hint="SARL, SA, SAS, Ltd, GmbH…"><Input value={legalForm ?? ""} onChange={(e) => setLegalForm(e.target.value)} placeholder="SARL" /></Field>
          <Field label="Country"><CountrySelect value={country} onChange={setCountry} allowEmpty={false} /></Field>
          <Field label="Date of incorporation"><Input type="date" value={incorporated ?? ""} onChange={(e) => setIncorporated(e.target.value)} /></Field>
          <Field label="Document prefix" hint="Leads this entity's invoice numbers"><Input value={docPrefix ?? ""} onChange={(e) => setDocPrefix(e.target.value)} placeholder="SLAS" /></Field>
          <Field label="Default language">
            <Select value={lang ?? "fr"} onChange={(e) => setLang(e.target.value)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Fiscal year start month">
            <Select value={fyStart} onChange={(e) => setFyStart(e.target.value)}>
              {Array.from({ length: 12 }).map((_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>)}
            </Select>
          </Field>
          {/* Per ENTITY, not per tenant: a Cameroon parent on OHADA can hold a
              France subsidiary reporting under IFRS, and consolidation needs to
              know which is which. */}
          <Field label="Accounting framework" hint="What this entity reports under">
            <Select value={framework} onChange={(e) => setFramework(e.target.value)}>
              {FRAMEWORKS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <Field label="Parent entity" hint="Leave blank for a standalone or top-level company" className="sm:col-span-2">
            <Select value={parentId ?? ""} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— none —</option>
              {parentOptions.map((p) => <option key={p.entity_id} value={p.entity_id}>{p.code} — {p.legal_name}</option>)}
            </Select>
          </Field>
          {parentId && (
            <Field label="Relationship to parent">
              <Select value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                <option value="">—</option>
                {entityCommon.RELATIONSHIP_TYPES.filter((r) => r !== "HEADQUARTERS").map((r) => (
                  <option key={r} value={r}>{enumLabel(r)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Description" hint="Shown on the entity picker and internal directories" className="sm:col-span-2">
            <Input value={description ?? ""} onChange={(e) => setDescription(e.target.value)} placeholder="Handles European clients and EU customs clearance." />
          </Field>
        </div>

        {!isNew && (
          <Field label="Letterhead logo" hint="PNG/JPG/WebP/SVG, max 512 KB — used on this entity's documents">
            <div className="flex items-center gap-3">
              {logoLight ? <img src={logoLight} alt="" className="h-10 w-auto rounded border bg-background object-contain p-1" /> : null}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={logoBusy}
                onChange={(e) => pickLogo(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
              />
            </div>
          </Field>
        )}

        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!code || !legalName || busy} onCancel={onClose} saveLabel={isNew ? "Create entity" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function CorporateEntitiesPage() {
  const { rows, error, loading, reload } = useList<api.Entity>("/entities");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = React.useState<api.Entity | "new" | null>(null);
  const entities = React.useMemo(() => rows || [], [rows]);

  // The dossier's "Edit details" button links back here with ?edit=<id> — one
  // form, reachable from both places, rather than a second copy on the dossier.
  const editId = params.get("edit");
  React.useEffect(() => {
    if (!editId) return;
    const found = entities.find((e) => e.entity_id === editId);
    if (found) {
      setEditing(found);
      params.delete("edit");
      setParams(params, { replace: true });
    }
  }, [editId, entities, params, setParams]);

  const statusOf = (r: api.Entity) => r.registration_status || (r.is_active ? "ACTIVE" : "DEACTIVATED");

  const columns: Column<api.Entity>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-foreground">{r.code}</span> },
    {
      key: "legal_name", label: "Legal name",
      render: (r) => (
        <span>
          <span className="text-foreground">{r.legal_name}</span>
          {r.parent_entity_id && <> <Pill tone="mute">{r.relationship_type ? enumLabel(r.relationship_type) : "Subsidiary"}</Pill></>}
        </span>
      ),
    },
    { key: "country_code", label: "Country" },
    { key: "legal_form", label: "Form", render: (r) => r.legal_form || "—" },
    { key: "accounting_framework", label: "Framework", render: (r) => (r.accounting_framework ? enumLabel(r.accounting_framework) : "—") },
    { key: "doc_prefix", label: "Doc prefix" },
    { key: "fiscal_year_start_month", label: "FY start", render: (r) => (r.fiscal_year_start_month ? new Date(2000, r.fiscal_year_start_month - 1, 1).toLocaleString("en", { month: "short" }) : "—") },
    { key: "registration_status", label: "Status", render: (r) => <Pill tone={LIFECYCLE_TONE[statusOf(r)] || "mute"}>{enumLabel(statusOf(r))}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <RowActions>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/master/corporate-entities/${r.entity_id}`)}>Open</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Corporate entities"
        description="The legal entities we bill and report from. Open one for its registrations, shareholders, addresses and group structure."
        action={<Button onClick={() => setEditing("new")}>New entity</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Entities" value={num(entities.length)} />
        <KpiTile label="Active" value={num(entities.filter((e) => statusOf(e) === "ACTIVE").length)} />
        <KpiTile label="Countries" value={num(new Set(entities.map((e) => e.country_code).filter(Boolean)).size)} />
        <KpiTile label="Subsidiaries" value={num(entities.filter((e) => e.parent_entity_id).length)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.entity_id}
        onRowClick={(r) => navigate(`/master/corporate-entities/${r.entity_id}`)}
        empty={{ title: "No entities yet", hint: "Add the legal entity that issues your documents." }}
      />
      {editing !== null && (
        <EntityForm
          row={editing === "new" ? null : editing}
          entities={entities}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            reload();
            // A brand-new entity opens straight into its dossier: the readiness
            // checklist there is what tells the operator what is still missing.
            if (editing === "new" && saved?.entity_id) navigate(`/master/corporate-entities/${saved.entity_id}`);
          }}
        />
      )}
      <ScreenAi path="master/corporate-entities" />
    </section>
  );
}
