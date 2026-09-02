/**
 * Signatures → Batch. Render one PNG per selected member of staff and hand back
 * a single ZIP.
 *
 * WHY THE LIST IS STAFF AND NOT A TYPING GRID. The generator this replaces had
 * an editable table you typed names and titles into, which meant a batch could
 * carry a spelling nobody at the company had ever approved, and had to be
 * retyped every time someone was promoted. Selecting real people means the
 * titles are HR's, the phone numbers are each person's own, and the second run
 * is a re-select rather than a re-type.
 *
 * WHY THERE IS NO PROGRESS BAR. The request renders every card server-side and
 * returns one file; there is no per-person event to report. A 40-person batch
 * is a few seconds. A spinner that cannot say which person it is on is just a
 * spinner, and the button already says the work is happening.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";

type Lang = "en" | "fr";

/** Matches the server's cap (signature.validator.batch) so the UI refuses
 *  before the request does, and can say why. */
const MAX = 200;

export function BatchTab() {
  const toast = useToast();
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [lang, setLang] = React.useState<Lang>("en");
  const [busy, setBusy] = React.useState(false);

  const { data: staff, error } = useResource(() => api.listSignatureStaff(), []);
  const rows = React.useMemo(() => {
    const all = Array.isArray(staff) ? staff : [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        (s.job_title || "").toLowerCase().includes(q) ||
        (s.department || "").toLowerCase().includes(q),
    );
  }, [staff, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Selects/clears only what is VISIBLE. Selecting people hidden behind a
  // filter is how someone ends up exporting a department they did not mean to.
  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.user_id));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) rows.forEach((r) => next.delete(r.user_id));
      else rows.forEach((r) => next.add(r.user_id));
      return next;
    });

  async function exportZip() {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      await api.downloadSignatureBatch({ user_ids: ids, language: lang, scale: 2 });
      toast.success(
        tr("Exported {n} signatures").replace("{n}", String(ids.length)),
      );
    } catch (err) {
      reportActionError(err);
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (staff === null) return <SkeletonTable />;

  return (
    <div className="space-y-4">
      <div className="lux-card space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              value={search}
              placeholder={tr("Search staff by name, title or department")}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Segmented
            label={tr("Signature language")}
            value={lang}
            onChange={(v) => setLang(v)}
            options={[
              { value: "en", label: tr("English") },
              { value: "fr", label: tr("French") },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleAllVisible}
            label={tr("Select all shown")}
            disabled={rows.length === 0}
          />
          <span className="text-sm text-muted-foreground">
            {tr("{n} selected").replace("{n}", String(selected.size))}
          </span>
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {tr("Clear")}
            </Button>
          )}
          <Button
            className="ml-auto"
            size="sm"
            disabled={busy || selected.size === 0 || selected.size > MAX}
            onClick={exportZip}
          >
            {busy ? tr("Generating…") : tr("Export selected as ZIP")}
          </Button>
        </div>

        {selected.size > MAX && (
          <Callout tone="warn" title={tr("Too many at once")}>
            {tr(
              "Export up to 200 people in one go. Narrow the selection and run it twice.",
            )}
          </Callout>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={tr("Nobody matches")}
          hint={tr("Only active staff with an HR record can have a signature rendered.")}
        />
      ) : (
        <div className="lux-card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">{tr("Staff available for signature export")}</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th scope="col" className="w-10 p-3" />
                <th scope="col" className="p-3">{tr("Name")}</th>
                <th scope="col" className="p-3">{tr("Job title")}</th>
                <th scope="col" className="p-3">{tr("Department")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.user_id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(s.user_id)}
                      onCheckedChange={() => toggle(s.user_id)}
                      label={
                        <span className="sr-only">
                          {tr("Include {name}").replace("{name}", s.full_name)}
                        </span>
                      }
                    />
                  </td>
                  <td className="p-3 font-medium">
                    {s.full_name}
                    {!s.has_profile && (
                      <Pill tone="mute" className="ml-2">
                        {tr("no phone set")}
                      </Pill>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{s.job_title || "—"}</td>
                  <td className="p-3 text-muted-foreground">{s.department || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BatchTab;
