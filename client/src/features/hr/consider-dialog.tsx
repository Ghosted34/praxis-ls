/**
 * "Consider for a vacancy" — the action the talent pool never had (0703).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * 0525 made past candidates findable: skills, an AI score, the CV, the vacancy
 * they came through. A recruiter could search the pool, read that Marie scored
 * 84 on last year's Customs Officer role — and then had nothing to press. To put
 * her in front of the open role they retyped her name, re-uploaded her CV, and
 * lost the assessment and the fact that she had ever been seen.
 *
 * ── WHAT IT SAYS OUT LOUD ──────────────────────────────────────────────────
 *
 * That the previous score does NOT come with her. A score is measured against a
 * job description, so last year's Customs Officer number on a Finance Manager
 * vacancy is meaningless — and it would sort, putting a number that means
 * nothing at the top of a shortlist. The new row is scored against the new role
 * like everybody else's. A recruiter who expects the 84 to follow and finds a
 * dash instead will assume the feature is broken, so the dialog tells them
 * before they press it rather than leaving them to notice.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/hr-api";

/** Who is being put forward — a past applicant, or a hand-entered bench row. */
export type ConsiderSource =
  | { kind: "applicant"; id: string; name: string; from?: string | null }
  | { kind: "bench"; id: string; name: string };

export function ConsiderDialog({
  source,
  onClose,
  onDone,
}: {
  source: ConsiderSource;
  onClose: () => void;
  onDone?: (vacancyId: string) => void;
}) {
  const vacancies = useResource(() => api.listVacancies(), []);
  const [vacancyId, setVacancyId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  // A closed role cannot take candidates, and offering one only to have the
  // server refuse is a worse experience than not offering it. The server checks
  // too — this is the courtesy, not the guard.
  const open = (vacancies.data || []).filter((v) => v.status !== "CLOSED");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vacancyId) return;
    setBusy(true);
    setError(null);
    try {
      const row = await api.considerForVacancy(
        vacancyId,
        source.kind === "applicant" ? { applicant_id: source.id } : { talent_pool_id: source.id },
      );
      // Idempotent server-side: somebody already on this pipeline comes back as
      // the row they are already on rather than as an error. Say which happened.
      setDone(row.already_on_vacancy ? "already" : "added");
      onDone?.(vacancyId);
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
      title={`Consider ${source.name}`}
      description={
        source.kind === "applicant" && source.from
          ? `Previously applied for ${source.from}.`
          : "From the candidate bench."
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        {done ? (
          <Callout tone={done === "already" ? "info" : "ok"} title={done === "already" ? "Already on that pipeline" : "Added to the pipeline"}>
            {done === "already"
              ? `${source.name} is already a candidate on that vacancy — nothing was duplicated.`
              : `${source.name} is now a candidate on that vacancy, with their CV and skills. Score them against this role from the vacancy's pipeline.`}
          </Callout>
        ) : (
          <>
            <Field label="Vacancy" required>
              <Select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)}>
                <option value="">
                  {vacancies.loading ? "Loading…" : "Choose an open role…"}
                </option>
                {open.map((v) => (
                  <option key={v.vacancy_id} value={v.vacancy_id}>
                    {v.title}
                    {v.department ? ` — ${v.department}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {!vacancies.loading && open.length === 0 && (
              <Callout tone="warn" title="No open vacancies">
                Every role is closed. Open one first, or reopen the role you want
                to put this candidate forward for.
              </Callout>
            )}
            {/* See the header: the recruiter has to know the number does not
                travel, or they will read the dash as a bug. */}
            <p className="text-xs text-muted-foreground">
              Their CV, skills and contact details come across. The previous
              assessment does not — a score is measured against one job
              description, so it would mean nothing here. Score them against this
              role from the pipeline.
            </p>
          </>
        )}
        {vacancies.error && <ErrorState message={vacancies.error} />}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && (
            <Button type="submit" loading={busy} disabled={!vacancyId || busy}>
              Put forward
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export default ConsiderDialog;
