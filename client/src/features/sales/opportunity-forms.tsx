/**
 * Opportunities — the write surfaces.
 *
 * Split out of `features/sales/opportunities.tsx` in Phase 4 (audit F7).
 * `WinModal` is the one that matters: winning a deal is what creates the
 * downstream commercial record, so it collects the entity the work will be
 * booked against rather than just flipping a status.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, money } from "@/lib/format";
import { SearchSelect } from "@/components/ui/search-select";

/** Mirrors opportunity.rules.SOURCES (and the ck_opportunity_source CHECK). */
const SOURCES = [
  { value: "MANUAL", label: "Manual entry" },
  { value: "QUOTE_REQUEST", label: "Quote request" },
  { value: "WEBSITE", label: "Website" },
  { value: "REFERRAL", label: "Referral" },
  { value: "CAMPAIGN", label: "Campaign" },
  { value: "LEAD_CONVERSION", label: "Lead conversion" },
  { value: "PARTNER", label: "Partner" },
  { value: "OTHER", label: "Other" },
];

export function OpportunityForm({
  open,
  editing,
  stages,
  leads,
  clients,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  stages: Row[] | null;
  leads: Row[] | null;
  clients: Row[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [withKind, setWithKind] = React.useState<"none" | "lead" | "client">(
    "none",
  );
  const [withId, setWithId] = React.useState("");
  const [stageId, setStageId] = React.useState("");
  const [value, setValue] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [probability, setProbability] = React.useState("");
  // F7: where the deal came from, and what it is for. The board renders both
  // on the card; the legacy reads them off the originating quote request and
  // this system had nowhere to keep them.
  const [source, setSource] = React.useState("MANUAL");
  const [sourceRef, setSourceRef] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const openStages = React.useMemo(
    () => (stages || []).filter((s) => !s.is_won && !s.is_lost),
    [stages],
  );
  /** The probability the chosen stage would give this deal, for the placeholder. */
  const stageProbability = React.useMemo(() => {
    const st = (stages || []).find(
      (s) => String(s.pipeline_stage_id) === stageId,
    );
    return st && st.default_probability != null
      ? Number(st.default_probability)
      : null;
  }, [stages, stageId]);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ? String(editing.name) : "");
    setWithKind(
      editing?.client_id ? "client" : editing?.lead_id ? "lead" : "none",
    );
    setWithId(
      editing?.client_id
        ? String(editing.client_id)
        : editing?.lead_id
          ? String(editing.lead_id)
          : "",
    );
    setStageId(
      editing?.pipeline_stage_id
        ? String(editing.pipeline_stage_id)
        : String(openStages[0]?.pipeline_stage_id ?? ""),
    );
    setValue(
      editing?.estimated_value != null ? String(editing.estimated_value) : "",
    );
    setCurrency(editing?.currency ? String(editing.currency) : "XAF");
    setProbability(
      editing?.probability != null ? String(editing.probability) : "",
    );
    setSource(editing?.source ? String(editing.source) : "MANUAL");
    setSourceRef(editing?.source_ref ? String(editing.source_ref) : "");
    setScope(editing?.scope_summary ? String(editing.scope_summary) : "");
    setError(null);
  }, [open, editing, openStages]);

  async function submit() {
    setBusy(true);
    setError(null);
    const common: Record<string, unknown> = {
      name: name.trim(),
      estimated_value: value === "" ? undefined : Number(value),
      currency: currency.trim().toUpperCase() || "XAF",
      // "" clears the override and hands the probability back to the stage —
      // null is meaningful to the API, undefined means "don't touch".
      probability:
        probability === ""
          ? editing
            ? null
            : undefined
          : Number(probability),
      source: source || "MANUAL",
      source_ref: sourceRef.trim() || null,
      scope_summary: scope.trim() || null,
    };
    try {
      if (editing) {
        await tenant(`/opportunities/${String(editing.opportunity_id)}`, {
          method: "PATCH",
          body: common,
        });
      } else {
        await tenant("/opportunities", {
          method: "POST",
          body: {
            ...common,
            pipeline_stage_id: stageId || undefined,
            lead_id: withKind === "lead" && withId ? withId : undefined,
            client_id: withKind === "client" && withId ? withId : undefined,
          },
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const selLead = (leads || []).find((l) => String(l.lead_id) === withId);
  const selClient = (clients || []).find((c) => String(c.client_id) === withId);
  const withLabel = !withId
    ? null
    : withKind === "lead"
      ? String(selLead?.company_name ?? "")
      : String(selClient?.name ?? selClient?.legal_name ?? "");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit opportunity" : "New opportunity"}
      description="A deal in the sales pipeline — value × probability drives the weighted forecast."
      size="lg"
    >
      <div className="space-y-4">
        <Field label={tr("Name")} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme — Q3 freight contract"
          />
        </Field>
        {!editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("With")}>
              <Select
                value={withKind}
                onChange={(e) => {
                  setWithKind(e.target.value as "none" | "lead" | "client");
                  setWithId("");
                }}
              >
                <option value="none">{tr("— none —")}</option>
                <option value="lead">{tr("Lead")}</option>
                <option value="client">{tr("Client")}</option>
              </Select>
            </Field>
            {withKind !== "none" ? (
              <Field label={withKind === "lead" ? "Lead" : "Client"}>
                <SearchSelect
                  path={withKind === "lead" ? "/leads" : "/clients"}
                  value={withLabel}
                  placeholder={
                    withKind === "lead" ? "Search leads…" : "Search clients…"
                  }
                  getLabel={(r) =>
                    withKind === "lead"
                      ? String(r.company_name ?? "")
                      : String(r.name ?? r.legal_name ?? "")
                  }
                  getKey={(r) =>
                    String(withKind === "lead" ? r.lead_id : r.client_id)
                  }
                  onSelect={(r) =>
                    setWithId(
                      String(withKind === "lead" ? r.lead_id : r.client_id),
                    )
                  }
                />
              </Field>
            ) : (
              <Field label={tr("Stage")}>
                <Select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                >
                  {openStages.map((s) => (
                    <option
                      key={String(s.pipeline_stage_id)}
                      value={String(s.pipeline_stage_id)}
                    >
                      {cell(s.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {withKind !== "none" && (
              <Field label={tr("Stage")} className="sm:col-span-2">
                <Select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                >
                  {openStages.map((s) => (
                    <option
                      key={String(s.pipeline_stage_id)}
                      value={String(s.pipeline_stage_id)}
                    >
                      {cell(s.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Estimated value">
            <Input
              type="number"
              min="0"
              step="1"
              className="num text-right"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="5000000"
            />
          </Field>
          <Field label={tr("Currency")}>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder={tr("XAF")}
              maxLength={3}
            />
          </Field>
          <Field
            label="Probability %"
            hint="Leave blank to follow the stage"
          >
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              className="num text-right"
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              placeholder={
                stageProbability === null ? "40" : String(stageProbability)
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Source")} hint="Where the deal came from">
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {SOURCES.map((sc) => (
                <option key={sc.value} value={sc.value}>
                  {sc.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Source reference"
            hint="The intake or campaign reference this came in on"
          >
            <Input
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="SQ-2026-0042"
            />
          </Field>
        </div>
        <Field label={tr("Scope")} hint="What the deal is for — shown on the board card">
          <Textarea
            rows={3}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="2 × 40ft reefer, Douala → N'Djamena, monthly"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!name.trim() || busy}
          >
            {editing ? "Save changes" : "Create opportunity"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function WinModal({
  opp,
  entities,
  onClose,
  onDone,
}: {
  opp: Row | null;
  entities: Row[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const open = !!opp;
  const [createDossier, setCreateDossier] = React.useState(false);
  const [entityId, setEntityId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!opp) return;
    setCreateDossier(false);
    setEntityId("");
    setError(null);
  }, [opp]);

  async function submit() {
    if (!opp) return;
    if (createDossier && !entityId) {
      setError("Choose the entity to open the dossier under.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant(`/opportunities/${String(opp.opportunity_id)}/win`, {
        method: "POST",
        body: {
          create_dossier: createDossier,
          entity_id: createDossier ? entityId : undefined,
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

  const winEntity = (entities || []).find(
    (e) => String(e.entity_id) === entityId,
  );
  const entityLabel = winEntity
    ? winEntity.code
      ? `${cell(winEntity.code)} · ${cell(winEntity.legal_name)}`
      : cell(winEntity.legal_name)
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark opportunity won"
      description="Settle this deal — optionally open the delivery dossier and link it(→)."
    >
      <div className="space-y-4">
        {opp && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{cell(opp.name)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {money(opp.estimated_value, opp.currency)}
            </p>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={createDossier}
            onChange={(e) => setCreateDossier(e.target.checked)}
          />
          Open a delivery dossier now
        </label>
        {createDossier && (
          <Field
            label={tr("Entity")}
            hint="Which legal entity delivers this"
            required
          >
            <SearchSelect
              path="/entities"
              value={entityLabel}
              placeholder={tr("Search entities…")}
              getLabel={(en) =>
                en.code
                  ? `${cell(en.code)} · ${cell(en.legal_name)}`
                  : cell(en.legal_name)
              }
              getKey={(en) => String(en.entity_id)}
              onSelect={(en) => setEntityId(String(en.entity_id))}
            />
          </Field>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Mark won
          </Button>
        </div>
      </div>
    </Modal>
  );
}
