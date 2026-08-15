/**
 * Milestone template editor — the screen a forwarder writes their operating
 * procedure in.
 *
 * WHAT CHANGED, and why the old version could not stay. It edited four fields
 * per stage (code, two labels, an offset in days) and offered three five-stage
 * presets. The engine now schedules on WEIGHTS over a working-time horizon,
 * with per-stage compression floors, an owner tier that delay is attributed to,
 * an anchor, and a locked SLA date — none of which were reachable from the UI.
 * A tenant could see the shipped 14-stage chain and not change the one number
 * (weight) that decides when anything is due.
 *
 * THE SHAPE. One row per stage, compact: sequence, code, label, weight, owner,
 * and the flags as icons. Expanding a row reveals the rest (floor, EN label,
 * evidence, auto-advance, segment/cadence). Fourteen rows of ten fields laid
 * out flat is a wall; the summary line is what a user scans, and the detail is
 * what they occasionally edit.
 *
 * THE WEIGHT METER IS THE POINT. Weights are a share of the horizon and must
 * sum to 100 PER SEGMENT — a segment summing to 97 silently shortens every
 * forecast on that service by 3%, forever, with no error anywhere. So the sum
 * is shown live, per segment, and publishing is blocked until it balances.
 * That is the one invariant a user cannot be trusted to hold in their head
 * while dragging fourteen numbers around.
 *
 * DRIFT, NOT LOCK-IN. Stages ship as system defaults (9091) and are ordinary
 * editable rows. The header says how far the current chain has drifted from
 * what shipped, and "Restore the default" puts it back — the financial
 * dictionary's contract, applied to milestones.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { errMsg, useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

/** A stage row in the editor. Numbers are strings while being typed. */
type Row = {
  code: string;
  label_fr: string;
  label_en: string;
  weight: string;
  min_duration_hours: string;
  owner_tier: api.OwnerTier;
  is_anchor: boolean;
  is_target_lock: boolean;
  is_client_visible: boolean;
  is_optional: boolean;
  chain_segment: string;
  cadence: string;
  required_evidence_doc_type: string;
  auto_advance_on_event: string;
};

const BLANK: Row = {
  code: "",
  label_fr: "",
  label_en: "",
  weight: "0",
  min_duration_hours: "0",
  owner_tier: "INTERNAL",
  is_anchor: false,
  is_target_lock: false,
  is_client_visible: true,
  is_optional: false,
  chain_segment: "MAIN",
  cadence: "",
  required_evidence_doc_type: "",
  auto_advance_on_event: "",
};

/** Bounds mirror milestone.validator.js and the 0650 trigger. */
const MIN_STAGES = 3;
const MAX_STAGES = 15;

const toRow = (s: api.MilestoneStage): Row => ({
  code: s.code || "",
  label_fr: s.label_fr || "",
  label_en: s.label_en || "",
  weight: String(s.weight ?? 0),
  min_duration_hours: String(s.min_duration_hours ?? 0),
  owner_tier: (s.owner_tier as api.OwnerTier) || "INTERNAL",
  is_anchor: !!s.is_anchor,
  is_target_lock: !!s.is_target_lock,
  is_client_visible: s.is_client_visible !== false,
  is_optional: !!s.is_optional,
  chain_segment: s.chain_segment || "MAIN",
  cadence: s.cadence || "",
  required_evidence_doc_type: s.required_evidence_doc_type || "",
  auto_advance_on_event: s.auto_advance_on_event || "",
});

/** Weight totals per chain segment — the invariant publishing is gated on. */
function segmentTotals(rows: Row[]) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const seg = r.chain_segment || "MAIN";
    out.set(seg, (out.get(seg) || 0) + (Number(r.weight) || 0));
  }
  return [...out.entries()];
}

/** A segment is balanced at 100, except cadence-driven STEADY which carries none. */
const segmentOk = (seg: string, total: number) =>
  seg === "STEADY" ? total === 0 : total === 100;

/** How far this chain has moved from what shipped — counted, not guessed. */
function driftCount(rows: Row[], shipped: api.MilestoneStage[]) {
  if (!shipped.length) return 0;
  const byCode = new Map(shipped.map((s) => [s.code, s]));
  let n = 0;
  if (rows.length !== shipped.length)
    n += Math.abs(rows.length - shipped.length);
  for (const r of rows) {
    const s = byCode.get(r.code);
    if (!s) {
      n += 1;
      continue;
    }
    if (
      (s.label_fr || "") !== r.label_fr ||
      String(s.weight ?? 0) !== r.weight ||
      String(s.min_duration_hours ?? 0) !== r.min_duration_hours ||
      (s.owner_tier || "INTERNAL") !== r.owner_tier ||
      !!s.is_target_lock !== r.is_target_lock ||
      !!s.is_anchor !== r.is_anchor
    )
      n += 1;
  }
  return n;
}

export function TemplateForm({
  svc,
  onClose,
  onSaved,
}: {
  svc: api.ServiceType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const shipped = useResource(
    () => api.milestoneSystemDefault(svc.service_type_id),
    [svc.service_type_id],
  );
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Start from what shipped. A tenant editing their chain almost always wants
  // the real 14 stages in front of them, not a blank row — and the previous
  // version's five-stage presets are exactly the "one company's chain as
  // everyone's default" this seed replaced.
  React.useEffect(() => {
    if (rows || !shipped.data) return;
    setRows(shipped.data.length ? shipped.data.map(toRow) : [{ ...BLANK }]);
  }, [shipped.data, rows]);

  const list = rows || [];
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((s) =>
      (s || []).map((r, ix) => (ix === i ? { ...r, ...patch } : r)),
    );
  const addRow = () => setRows((s) => [...(s || []), { ...BLANK }]);
  const removeRow = (i: number) =>
    setRows((s) => (s || []).filter((_, ix) => ix !== i));
  const move = (i: number, by: number) =>
    setRows((s) => {
      const next = [...(s || [])];
      const j = i + by;
      if (j < 0 || j >= next.length) return next;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const totals = segmentTotals(list);
  const balanced = totals.every(([seg, total]) => segmentOk(seg, total));
  const named = list.every((r) => r.code.trim() && r.label_fr.trim());
  const counted = list.length >= MIN_STAGES && list.length <= MAX_STAGES;
  const locks = list.filter((r) => r.is_target_lock).length;
  const drift = driftCount(list, shipped.data || []);

  const canPublish = balanced && named && counted && locks >= 1 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.publishMilestoneTemplate({
        service_type_id: svc.service_type_id,
        stages: list.map((s, i) => ({
          stage_seq: i + 1,
          code: s.code.trim().toUpperCase(),
          label_fr: s.label_fr.trim(),
          label_en: s.label_en.trim() || undefined,
          weight: Number(s.weight) || 0,
          min_duration_hours: Number(s.min_duration_hours) || 0,
          owner_tier: s.owner_tier,
          is_anchor: s.is_anchor,
          is_target_lock: s.is_target_lock,
          is_client_visible: s.is_client_visible,
          is_optional: s.is_optional,
          chain_segment: s.chain_segment || "MAIN",
          cadence: (s.cadence || undefined) as api.Cadence | undefined,
          required_evidence_doc_type:
            s.required_evidence_doc_type.trim() || undefined,
          auto_advance_on_event: s.auto_advance_on_event.trim() || undefined,
        })),
      });
      onSaved();
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
      size="xl"
      title={`Milestone chain — ${svc.name_en || svc.name_fr}`}
      description="The stages every new dossier of this service type starts with. Publishing creates a new active version; dossiers already open keep the stages they were given."
      headerRight={
        drift > 0 ? (
          <Pill tone="warn">
            {drift === 1
              ? "1 change from default"
              : `${drift} changes from default`}
          </Pill>
        ) : shipped.data?.length ? (
          <Pill tone="ok">Matches the shipped default</Pill>
        ) : null
      }
    >
      {shipped.loading && !rows ? (
        <p className="micro">Loading the shipped chain…</p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {/* The weight meter. Publishing is gated on this, so it leads. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
            <span className="micro">Weight per segment</span>
            {totals.map(([seg, total]) => (
              <Pill key={seg} tone={segmentOk(seg, total) ? "ok" : "bad"}>
                {seg === "MAIN" ? "" : `${seg} `}
                {total}
                {seg === "STEADY" ? " (cadence)" : " / 100"}
              </Pill>
            ))}
            <span className="ml-auto micro">
              {list.length} {list.length === 1 ? "stage" : "stages"} (allowed{" "}
              {MIN_STAGES}–{MAX_STAGES})
            </span>
          </div>

          <div className="space-y-1">
            {list.map((r, i) => (
              <div key={i} className="rounded-lg border border-border">
                {/* Summary line — what a user scans. */}
                <div className="grid items-center gap-2 px-2 py-1.5 sm:grid-cols-[auto_2fr_3fr_auto_auto_auto]">
                  <span className="num micro w-6 text-right">{i + 1}</span>
                  <Input
                    value={r.code}
                    onChange={(e) =>
                      setRow(i, { code: e.target.value.toUpperCase() })
                    }
                    placeholder="VESSEL_ARRIVED"
                    aria-label={`Stage ${i + 1} code`}
                  />
                  <Input
                    value={r.label_fr}
                    onChange={(e) => setRow(i, { label_fr: e.target.value })}
                    placeholder="Navire arrivé"
                    aria-label={`Stage ${i + 1} label (French)`}
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      value={r.weight}
                      onChange={(e) =>
                        setRow(i, {
                          weight: e.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                      className="num w-14"
                      aria-label={`Stage ${i + 1} weight`}
                    />
                    <span className="micro">%</span>
                  </div>
                  <Select
                    value={r.owner_tier}
                    onChange={(e) =>
                      setRow(i, { owner_tier: e.target.value as api.OwnerTier })
                    }
                    aria-label={`Stage ${i + 1} owner`}
                    className="max-w-[11rem]"
                  >
                    {api.OWNER_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {api.OWNER_TIER_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center justify-end gap-0.5">
                    {r.is_anchor && <Pill tone="blue">anchor</Pill>}
                    {r.is_target_lock && <Pill tone="orange">SLA</Pill>}
                    {!r.is_client_visible && <Pill tone="mute">internal</Pill>}
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.code || `stage ${i + 1}`} earlier`}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === list.length - 1}
                      aria-label={`Move ${r.code || `stage ${i + 1}`} later`}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(open === i ? null : i)}
                      aria-expanded={open === i}
                      aria-label={`${open === i ? "Hide" : "Show"} details for ${r.code || `stage ${i + 1}`}`}
                      className="px-1 text-muted-foreground hover:text-foreground"
                    >
                      {open === i ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={list.length <= MIN_STAGES}
                      aria-label={`Remove ${r.code || `stage ${i + 1}`}`}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {open === i && (
                  <div className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Label (English)">
                      <Input
                        value={r.label_en}
                        onChange={(e) =>
                          setRow(i, { label_en: e.target.value })
                        }
                        placeholder="Vessel arrived"
                      />
                    </Field>
                    <Field
                      label="Minimum duration (hours)"
                      hint="The floor this stage can never be compressed below, however late the file runs."
                    >
                      <Input
                        value={r.min_duration_hours}
                        onChange={(e) =>
                          setRow(i, {
                            min_duration_hours: e.target.value.replace(
                              /[^0-9]/g,
                              "",
                            ),
                          })
                        }
                        className="num"
                      />
                    </Field>
                    <Field
                      label="Segment"
                      hint="MAIN for a normal chain; INBOUND / STEADY / OUTBOUND for open-ended services."
                    >
                      <Input
                        value={r.chain_segment}
                        onChange={(e) =>
                          setRow(i, {
                            chain_segment: e.target.value.toUpperCase(),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Cadence"
                      hint="Set only for steady-state stages, which run on a rhythm and are never overdue."
                    >
                      <Select
                        value={r.cadence}
                        onChange={(e) => setRow(i, { cadence: e.target.value })}
                      >
                        <option value="">None — scheduled normally</option>
                        {api.CADENCES.map((c) => (
                          <option key={c} value={c}>
                            {c.charAt(0) + c.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Required evidence"
                      hint="Document type that proves this stage happened."
                    >
                      <Input
                        value={r.required_evidence_doc_type}
                        onChange={(e) =>
                          setRow(i, {
                            required_evidence_doc_type:
                              e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="POD"
                      />
                    </Field>
                    <Field
                      label="Completed automatically by"
                      hint="An event key that completes this stage when it fires, e.g. delivery_note.created."
                    >
                      <Input
                        value={r.auto_advance_on_event}
                        onChange={(e) =>
                          setRow(i, { auto_advance_on_event: e.target.value })
                        }
                        placeholder="delivery_note.created"
                      />
                    </Field>
                    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                      <Checkbox
                        checked={r.is_anchor}
                        onCheckedChange={(v) => setRow(i, { is_anchor: v })}
                        label="Anchor — the schedule stays provisional until this happens"
                      />
                      <Checkbox
                        checked={r.is_target_lock}
                        onCheckedChange={(v) =>
                          setRow(i, { is_target_lock: v })
                        }
                        label="SLA date — hold this commitment and compress what remains instead of moving it"
                      />
                      <Checkbox
                        checked={r.is_client_visible}
                        onCheckedChange={(v) =>
                          setRow(i, { is_client_visible: v })
                        }
                        label="Visible to the client on the portal"
                      />
                      <Checkbox
                        checked={r.is_optional}
                        onCheckedChange={(v) => setRow(i, { is_optional: v })}
                        label="Optional — may be skipped without blocking the chain"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={list.length >= MAX_STAGES}
            >
              Add stage
            </Button>
            {shipped.data?.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows(shipped.data!.map(toRow))}
                disabled={drift === 0}
              >
                Restore the default
              </Button>
            ) : null}
          </div>

          {/* Why publishing is blocked, said plainly rather than as a dead button. */}
          {!canPublish && (
            <ul className="space-y-1 micro">
              {!balanced && (
                <li>
                  Each segment&apos;s weights must total 100 — they are the
                  share of the file&apos;s time each stage gets.
                </li>
              )}
              {!named && <li>Every stage needs a code and a French label.</li>}
              {!counted && (
                <li>
                  A chain must have between {MIN_STAGES} and {MAX_STAGES}{" "}
                  stages.
                </li>
              )}
              {locks === 0 && (
                <li>
                  Mark one stage as the SLA date, so there is a commitment to
                  protect.
                </li>
              )}
            </ul>
          )}

          {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!canPublish}>
              Publish new version
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
