/**
 * The published assumptions register — what a schedule DEPENDS ON, in writing.
 *
 * WHY THIS EXISTS AT ALL. Every date the engine computes rests on
 * counterparties whose hours nobody here controls: customs opens at 07:30 and
 * stops assessing at 14:00, the terminal gate shuts on Sundays, the shipping
 * line's release counter keeps banking hours, and a red-channel declaration
 * costs a day. A schedule that hides those conditions is a schedule that looks
 * like a promise about things we cannot promise — and the first missed date
 * becomes an argument about what was meant rather than a conversation about
 * what happened.
 *
 * So the conditions are published beside the chain. The client-visible ones
 * render on the portal; the rest are internal notes. The force-majeure entries
 * do double duty: they are the exclusions a client reads, and the vocabulary
 * ops picks from when overriding delay attribution, so what we promised and
 * what we excused are written in one language.
 *
 * These ship seeded per service type (9091) and are ordinary editable rows.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { errMsg, useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";

export type Assumption = {
  service_type_assumption_id?: string;
  code: string;
  text_fr: string;
  text_en?: string | null;
  is_client_visible?: boolean;
  is_system?: boolean;
};

const getAssumptions = (serviceTypeId: string) =>
  tenant<Assumption[]>(`/milestones/assumptions/${serviceTypeId}`);
const putAssumptions = (serviceTypeId: string, assumptions: Assumption[]) =>
  tenant<Assumption[]>(`/milestones/assumptions/${serviceTypeId}`, {
    method: "PUT",
    body: { assumptions },
  });

const BLANK: Assumption = {
  code: "",
  text_fr: "",
  text_en: "",
  is_client_visible: true,
};

export function ServiceTypeAssumptions({
  serviceTypeId,
}: {
  serviceTypeId: string;
}) {
  const loaded = useResource<Assumption[]>(
    () => getAssumptions(serviceTypeId),
    [serviceTypeId],
  );
  const [rows, setRows] = React.useState<Assumption[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (loaded.data)
      setRows(loaded.data.map((a) => ({ ...a, text_en: a.text_en || "" })));
  }, [loaded.data]);

  if (loaded.error) return <ErrorState message={loaded.error} />;
  if (!rows) return <p className="micro">Loading the register…</p>;

  const set = (i: number, patch: Partial<Assumption>) =>
    setRows((s) =>
      (s || []).map((r, ix) => (ix === i ? { ...r, ...patch } : r)),
    );
  const add = () => setRows((s) => [...(s || []), { ...BLANK }]);
  const remove = (i: number) =>
    setRows((s) => (s || []).filter((_, ix) => ix !== i));

  const codes = rows.map((r) => r.code.trim().toUpperCase());
  const duplicate = codes.find((c, i) => c && codes.indexOf(c) !== i);
  const complete = rows.every((r) => r.code.trim() && r.text_fr.trim());
  const canSave = complete && !duplicate && !busy;
  const visible = rows.filter((r) => r.is_client_visible !== false).length;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await putAssumptions(
        serviceTypeId,
        (rows || []).map((r) => ({
          code: r.code.trim().toUpperCase(),
          text_fr: r.text_fr.trim(),
          text_en: r.text_en?.trim() || undefined,
          is_client_visible: r.is_client_visible !== false,
        })),
      );
      loaded.reload();
      setSaved(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro max-w-3xl">
          What this service&apos;s schedule depends on — the hours of the
          customs office, the terminal and the carrier, the free time that is
          not a commitment, and what is excluded as force majeure. The
          client-visible ones are shown beside the milestone chain on the
          portal, so a missed date is read together with the conditions it
          rested on.
        </p>
        <Pill tone="mute">
          {visible} of {rows.length} shown to clients
        </Pill>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing published"
          hint="Without a register, every date on this service reads as an unconditional promise."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((a, i) => (
            <div
              key={a.service_type_assumption_id || i}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={a.code}
                  onChange={(e) =>
                    set(i, {
                      code: e.target.value.toUpperCase().replace(/\s+/g, "_"),
                    })
                  }
                  placeholder="CUSTOMS_HOURS"
                  className="num max-w-[16rem]"
                  aria-label={`Assumption ${i + 1} code`}
                />
                {a.is_system && <Pill tone="mute">shipped</Pill>}
                <div className="ml-auto flex items-center gap-2">
                  <Checkbox
                    checked={a.is_client_visible !== false}
                    onCheckedChange={(v) => set(i, { is_client_visible: v })}
                    label="Show to the client"
                  />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${a.code || `assumption ${i + 1}`}`}
                    className="px-2 text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                <Field label="French" required>
                  <Textarea
                    value={a.text_fr}
                    onChange={(e) => set(i, { text_fr: e.target.value })}
                    rows={2}
                    placeholder="La douane traite du lundi au vendredi, 07h30–15h30."
                  />
                </Field>
                <Field label="English">
                  <Textarea
                    value={a.text_en || ""}
                    onChange={(e) => set(i, { text_en: e.target.value })}
                    rows={2}
                    placeholder="Customs processes Mon–Fri, 07:30–15:30."
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={add}>
          Add an assumption
        </Button>
        {duplicate && (
          <span className="text-sm text-[rgb(var(--bad))]">
            Two entries share the code {duplicate}.
          </span>
        )}
        {!complete && rows.length > 0 && (
          <span className="micro">
            Every entry needs a code and French text.
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {saved && <Pill tone="ok">Saved</Pill>}
          <Button onClick={save} loading={busy} disabled={!canSave}>
            Publish register
          </Button>
        </div>
      </div>

      {error && <ErrorState message={error} />}
    </div>
  );
}
