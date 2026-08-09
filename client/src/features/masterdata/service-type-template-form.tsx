/**
 * Milestone template editor — one modal, one publish call.
 *
 * Extracted from the (formerly monolithic) service-types.tsx. Publishing creates
 * a NEW active version (`milestone.service.publishTemplate` supersedes older
 * versions via `deactivateOthers`); dossiers already instantiated keep the
 * stages they were given, so this is a safe forward-only edit.
 *
 * `stage_seq` is 1..n in listed order; the backend accepts fractional values so
 * a stage can later be inserted between two without a renumber
 * (0310_operations.sql:59). The PRESETS below match the seed-sandbox chains so
 * a tenant recognises something workable, but every stage stays editable — a
 * forwarder's chain IS their operating procedure, and shipping one company's
 * chain as everyone's default is the thing this screen exists to stop.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

/** A stage row in the template editor. */
type Stage = { code: string; label_fr: string; label_en: string; default_offset_days: string };

const BLANK: Stage = { code: "", label_fr: "", label_en: "", default_offset_days: "0" };

const PRESETS: Record<string, Stage[]> = {
  Sea: [
    { code: "BOOKING", label_fr: "Réservation", label_en: "Booking", default_offset_days: "0" },
    { code: "DEPARTURE", label_fr: "Départ navire", label_en: "Vessel departure", default_offset_days: "5" },
    { code: "ARRIVAL", label_fr: "Arrivée port", label_en: "Port arrival", default_offset_days: "30" },
    { code: "CUSTOMS", label_fr: "Dédouanement", label_en: "Customs clearance", default_offset_days: "33" },
    { code: "DELIVERY", label_fr: "Livraison finale", label_en: "Final delivery", default_offset_days: "37" },
  ],
  Air: [
    { code: "BOOKING", label_fr: "Réservation", label_en: "Booking", default_offset_days: "0" },
    { code: "DEPARTURE", label_fr: "Départ vol", label_en: "Flight departure", default_offset_days: "2" },
    { code: "ARRIVAL", label_fr: "Arrivée aéroport", label_en: "Airport arrival", default_offset_days: "4" },
    { code: "CUSTOMS", label_fr: "Dédouanement", label_en: "Customs clearance", default_offset_days: "6" },
    { code: "DELIVERY", label_fr: "Livraison finale", label_en: "Final delivery", default_offset_days: "8" },
  ],
  Transit: [
    { code: "T1_LODGED", label_fr: "Déclaration T1 déposée", label_en: "T1 lodged", default_offset_days: "0" },
    { code: "ESCORT", label_fr: "Escorte douanière", label_en: "Customs escort", default_offset_days: "2" },
    { code: "BORDER", label_fr: "Passage frontière", label_en: "Border crossing", default_offset_days: "5" },
    { code: "ARRIVAL", label_fr: "Arrivée destination", label_en: "Destination arrival", default_offset_days: "8" },
    { code: "DISCHARGE", label_fr: "Déchargement", label_en: "Discharge", default_offset_days: "9" },
  ],
};

export function TemplateForm({
  svc,
  onClose,
  onSaved,
}: {
  svc: api.ServiceType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stages, setStages] = React.useState<Stage[]>([{ ...BLANK }]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const setStage = (i: number, k: keyof Stage, v: string) =>
    setStages((s) => s.map((st, ix) => (ix === i ? { ...st, [k]: v } : st)));
  const addStage = () => setStages((s) => [...s, { ...BLANK }]);
  const removeStage = (i: number) => setStages((s) => (s.length === 1 ? s : s.filter((_, ix) => ix !== i)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.publishMilestoneTemplate({
        service_type_id: svc.service_type_id,
        stages: stages.map((s, i) => ({
          stage_seq: i + 1,
          code: s.code.trim().toUpperCase(),
          label_fr: s.label_fr.trim(),
          label_en: s.label_en.trim() || undefined,
          default_offset_days: Number(s.default_offset_days) || 0,
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

  const valid = stages.every((s) => s.code.trim() && s.label_fr.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={`Milestone template — ${svc.name_en || svc.name_fr}`}
      description="The stages every new dossier of this service type starts with. Publishing creates a new active version; dossiers already created keep the stages they were given."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro">Start from:</span>
          {Object.keys(PRESETS).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setStages(PRESETS[p].map((s) => ({ ...s })))}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary-ink"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="hidden gap-2 px-1 sm:grid sm:grid-cols-[2fr_3fr_3fr_1.2fr_auto]">
            <span className="micro">Code</span>
            <span className="micro">Label (FR)</span>
            <span className="micro">Label (EN)</span>
            <span className="micro">Offset (days)</span>
            <span />
          </div>
          {stages.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_3fr_3fr_1.2fr_auto]">
              <Input value={s.code} onChange={(e) => setStage(i, "code", e.target.value.toUpperCase())} placeholder="BOOKING" />
              <Input value={s.label_fr} onChange={(e) => setStage(i, "label_fr", e.target.value)} placeholder="Réservation" />
              <Input value={s.label_en} onChange={(e) => setStage(i, "label_en", e.target.value)} placeholder="Booking" />
              <Input
                value={s.default_offset_days}
                onChange={(e) => setStage(i, "default_offset_days", e.target.value.replace(/[^0-9-]/g, ""))}
                className="num"
              />
              <button
                type="button"
                onClick={() => removeStage(i)}
                disabled={stages.length === 1}
                aria-label="Remove stage"
                className="px-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addStage}>Add stage</Button>
          <p className="micro">
            Offset is days from the dossier&apos;s start — the due date of each stage. They should increase down the list.
          </p>
        </div>

        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !valid}>Publish template</Button>
        </div>
      </form>
    </Modal>
  );
}
