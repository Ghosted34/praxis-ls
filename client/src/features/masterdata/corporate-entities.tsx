/**
 * Master data — corporate entities: the legal companies the tenant invoices as.
 *
 * Split out of `features/masterdata/pages.tsx` in Phase 4 (audit F7).
 *
 * A master–detail screen: a searchable list of entities on the left, the full
 * dossier inline on the right (features/masterdata/entity-360.tsx, EntityDossier)
 * — the same shape as the client and supplier masters. Everything about an entity
 * lives on the dossier: registrations, people and shareholding, addresses, group
 * structure, treasury. It stays deep-linkable on its own route
 * (/master/corporate-entities/:id) for links from payroll, invoices and alerts.
 *
 * The form here stays deliberately narrow. Creating an entity asks for what is
 * needed to open the file (code, legal name, country, prefix) plus the document
 * and fiscal defaults; the statutory detail is gathered on the dossier over
 * several sittings, which is why an entity can be created as a DRAFT.
 */

import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { CountrySelect } from "@/components/country-select";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import { entityCommon } from "@shared";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";
import { EntityDossier } from "./entity-360";

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
  const [params, setParams] = useSearchParams();
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<api.Entity | "new" | null>(null);
  const entities = React.useMemo(() => rows || [], [rows]);

  const statusOf = (r: api.Entity) => r.registration_status || (r.is_active ? "ACTIVE" : "DEACTIVATED");
  const filtered = q ? entities.filter((e) => `${e.code} ${e.legal_name}`.toLowerCase().includes(q.toLowerCase())) : entities;
  const selected = entities.find((e) => e.entity_id === selId) || null;
  React.useEffect(() => { if (!selId && entities.length) setSelId(entities[0].entity_id); }, [entities, selId]);

  // The dossier's "Edit details" links back here with ?edit=<id> — used by the
  // deep-link page. One form, reachable from both places: open it and select
  // that entity in the list.
  const editId = params.get("edit");
  React.useEffect(() => {
    if (!editId) return;
    const found = entities.find((e) => e.entity_id === editId);
    if (found) {
      setEditing(found);
      setSelId(found.entity_id);
      params.delete("edit");
      setParams(params, { replace: true });
    }
  }, [editId, entities, params, setParams]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Corporate entities"
        description="The legal entities we bill and report from — registrations, shareholders, addresses and group structure, per entity."
        action={<Button onClick={() => setEditing("new")}>New entity</Button>}
      />
      <HubTabs />
      {error ? <ErrorState message={error} /> : (
        <SplitPane storageKey="master.corporate-entities" label="Entity list width" defaultSize={280} min={220} max={480}>
          <div className="space-y-2">
            <Input placeholder="Search entity…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {loading ? <LoadingRow label="Loading entities…" /> : filtered.length === 0 ? <div className="px-3 py-4 micro">No entities.</div> : filtered.map((en) => (
                <button key={en.entity_id} onClick={() => setSelId(en.entity_id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${en.entity_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                  <span className="min-w-0 truncate"><span className="num font-medium">{en.code}</span> · {en.legal_name}</span>
                  <Pill tone={LIFECYCLE_TONE[statusOf(en)] || "mute"}>{enumLabel(statusOf(en))}</Pill>
                </button>
              ))}
            </div>
          </div>
          {selected
            ? <EntityDossier entityId={selected.entity_id} onEdit={() => setEditing(selected)} onChanged={reload} />
            : <EmptyState title="No entity selected" hint="Choose an entity from the list." />}
        </SplitPane>
      )}
      {editing !== null && (
        <EntityForm
          row={editing === "new" ? null : editing}
          entities={entities}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            reload();
            // A brand-new entity is selected straight away: the readiness
            // checklist on its dossier is what says what is still missing.
            if (saved?.entity_id) setSelId(saved.entity_id);
          }}
        />
      )}
      <ScreenAi path="master/corporate-entities" />
    </section>
  );
}
