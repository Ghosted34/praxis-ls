/**
 * Proposals — the line/narrative editor and the detail drawer.
 *
 * Split out of `features/sales/proposals.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, money } from "@/lib/format";
import { SearchSelect } from "@/components/ui/search-select";

export type LineRow = { label: string; qty: string; unit_price: string };
export type NarrRow = { section: string; body: string };

export function lineTotal(l: { qty?: unknown; unit_price?: unknown }): number {
  return (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
}

export function ProposalForm({ open, editing, leads, clients, opportunities, onClose, onSaved }: { open: boolean; editing: Row | null; leads: Row[] | null; clients: Row[] | null; opportunities: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = React.useState("");
  const [withKind, setWithKind] = React.useState<"none" | "lead" | "client">("none");
  const [withId, setWithId] = React.useState("");
  const [opportunityId, setOpportunityId] = React.useState("");
  const [aiGenerated, setAiGenerated] = React.useState(false);
  const [lines, setLines] = React.useState<LineRow[]>([]);
  const [narratives, setNarratives] = React.useState<NarrRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ? String(editing.title) : "");
    setWithKind(editing?.client_id ? "client" : editing?.lead_id ? "lead" : "none");
    setWithId(editing?.client_id ? String(editing.client_id) : editing?.lead_id ? String(editing.lead_id) : "");
    setOpportunityId(editing?.opportunity_id ? String(editing.opportunity_id) : "");
    setAiGenerated(editing?.ai_generated === true);
    const el = (editing?.lines as Row[] | undefined) || [];
    setLines(el.length ? el.map((l) => ({ label: cell(l.label) === "—" ? "" : String(l.label), qty: l.qty != null ? String(l.qty) : "1", unit_price: l.unit_price != null ? String(l.unit_price) : "0" })) : [{ label: "", qty: "1", unit_price: "0" }]);
    const en = (editing?.narratives as Row[] | undefined) || [];
    setNarratives(en.length ? en.map((n) => ({ section: String(n.section ?? ""), body: String(n.body ?? "") })) : [{ section: "Overview", body: "" }]);
    setError(null);
  }, [open, editing]);

  function setLine(i: number, patch: Partial<LineRow>) {
    setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function setNarr(i: number, patch: Partial<NarrRow>) {
    setNarratives((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const total = lines.reduce((a, l) => a + lineTotal(l), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    const cleanLines = lines.filter((l) => l.label.trim()).map((l) => ({ label: l.label.trim(), qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0 }));
    const cleanNarr = narratives.filter((n) => n.section.trim()).map((n, i) => ({ section: n.section.trim(), body: n.body, sort_order: i }));
    try {
      if (editing) {
        await tenant(`/proposals/${String(editing.proposal_id)}`, {
          method: "PATCH",
          body: { title: title.trim(), opportunity_id: opportunityId || null, lines: cleanLines, narratives: cleanNarr },
        });
      } else {
        await tenant("/proposals", {
          method: "POST",
          body: {
            title: title.trim(),
            lead_id: withKind === "lead" && withId ? withId : undefined,
            client_id: withKind === "client" && withId ? withId : undefined,
            opportunity_id: opportunityId || undefined,
            ai_generated: aiGenerated,
            lines: cleanLines,
            narratives: cleanNarr,
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
  const withLabel = !withId ? null : withKind === "lead" ? String(selLead?.company_name ?? "") : String(selClient?.name ?? selClient?.legal_name ?? "");

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit proposal" : "New proposal"} description="Narrative sections + priced line items — drafted, reviewed, then sent." size="xl">
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Freight & customs — Acme 2026" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {editing ? (
            <Field label="With">
              <Input value={withKind === "none" ? "—" : `${withKind === "lead" ? "Lead" : "Client"} (linked)`} disabled />
            </Field>
          ) : (
            <>
              <Field label="With">
                <Select
                  value={withKind}
                  onChange={(e) => {
                    setWithKind(e.target.value as "none" | "lead" | "client");
                    setWithId("");
                  }}
                >
                  <option value="none">— none —</option>
                  <option value="lead">Lead</option>
                  <option value="client">Client</option>
                </Select>
              </Field>
              {withKind !== "none" && (
                <Field label={withKind === "lead" ? "Lead" : "Client"}>
                  <SearchSelect
                    path={withKind === "lead" ? "/leads" : "/clients"}
                    value={withLabel}
                    placeholder={withKind === "lead" ? "Search leads…" : "Search clients…"}
                    getLabel={(r) => (withKind === "lead" ? String(r.company_name ?? "") : String(r.name ?? r.legal_name ?? ""))}
                    getKey={(r) => String(withKind === "lead" ? r.lead_id : r.client_id)}
                    onSelect={(r) => setWithId(String(withKind === "lead" ? r.lead_id : r.client_id))}
                  />
                </Field>
              )}
            </>
          )}
          <Field label="Opportunity" hint="Optional — link to a pipeline deal">
            <Select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">— none —</option>
              {(opportunities || []).map((o) => (
                <option key={String(o.opportunity_id)} value={String(o.opportunity_id)}>
                  {cell(o.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Narrative sections */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Narrative sections</p>
            <Button size="sm" variant="ghost" onClick={() => setNarratives((n) => [...n, { section: "", body: "" }])}>
              + Section
            </Button>
          </div>
          {narratives.map((n, i) => (
            <div key={i} className="rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <Input value={n.section} onChange={(e) => setNarr(i, { section: e.target.value })} placeholder="Section heading (e.g. Scope)" />
                <Button size="sm" variant="ghost" onClick={() => setNarratives((rs) => rs.filter((_, idx) => idx !== i))}>
                  ✕
                </Button>
              </div>
              <Textarea value={n.body}
                onChange={(e) => setNarr(i, { body: e.target.value })}
                rows={2}
                className="mt-2 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                placeholder="Section body…"
              />
            </div>
          ))}
        </div>

        {/* Line items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Line items</p>
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", qty: "1", unit_price: "0" }])}>
              + Line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Service / description" className="flex-1" />
              <Input type="number" min="0" step="1" className="num w-20 text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="qty" />
              <Input type="number" min="0" step="1" className="num w-28 text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="unit price" />
              <span className="w-28 text-right text-sm text-muted-foreground">{money(lineTotal(l))}</span>
              <Button size="sm" variant="ghost" onClick={() => setLines((rs) => rs.filter((_, idx) => idx !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <div className="flex justify-end pr-10 text-sm font-semibold">Total (HT): {money(total)}</div>
        </div>

        {!editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aiGenerated} onChange={(e) => setAiGenerated(e.target.checked)} />
            Mark as AI-drafted (for the record)
          </label>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || busy}>
            {editing ? "Save changes" : "Create draft"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
