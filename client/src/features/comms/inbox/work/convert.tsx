/**
 * TURNING AN EMAIL INTO A RECORD (§7.7).
 *
 * "This is a new enquiry" → a lead, a quote request, a ticket, a task, a
 * purchase requisition. Six targets, each owned by a different module.
 *
 * ── THIS DIALOG PREVIEWS. IT DOES NOT CREATE. ───────────────────────────────
 *
 * Q23 = B: always confirm. `POST /threads/:id/convert` returns a PREFILL and a
 * duplicate list and writes nothing. The record is created by the target module,
 * under its own rights, from a form the operator reviewed. `target_module` comes
 * back so this dialog can say whose rights govern — a warehouse operator who
 * cannot create a supplier requisition should learn that here, not after
 * filling in a form.
 *
 * ── DUPLICATES LEAD, AND ATTACHING IS THE PRIMARY ACTION ────────────────────
 *
 * §7.7: when something already matches, the dialog "leads with 'already a lead
 * — attach this email to it?' and makes Create new the SECONDARY action."
 *
 * The reason is that the failure this prevents is silent. Nobody notices they
 * created the fourth record for Camrail; they notice six weeks later when the
 * pipeline is wrong and three salespeople have been calling the same company.
 * By then the merge is manual. So the button order is the control, and the
 * server decides it — `primary_action` is read here, not inferred from
 * `duplicates.length`, because the rule about which signals count as "the same
 * company" belongs to Master Data's detector rather than to this file.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/modal";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { reportActionError } from "@/lib/action-error";
import { fieldLabel, smartCell } from "@/lib/format";
import * as api from "@/lib/mail-api";

const TARGETS: { value: api.ConvertTarget; label: string }[] = [
  { value: "lead", label: "A new lead" },
  { value: "quote_request", label: "A quote request" },
  { value: "enquiry", label: "An enquiry" },
  { value: "ticket", label: "A support ticket" },
  { value: "task", label: "A task" },
  { value: "purchase_requisition", label: "A purchase requisition" },
];

/** Where the operator lands to actually create it, carrying the prefill. */
function createHref(preview: api.ConvertPreview): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(preview.prefill || {})) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  q.set("from_mail", "1");
  const sep = preview.target_route.includes("?") ? "&" : "?";
  return `${preview.target_route}${sep}${q.toString()}`;
}

export function ConvertDialog({
  threadId,
  onClose,
  onConverted,
}: {
  threadId: string;
  onClose: () => void;
  /** Fires after the thread has been told what it became, so the chip refreshes. */
  onConverted: () => void;
}) {
  const [target, setTarget] = React.useState<api.ConvertTarget>("lead");
  const [preview, setPreview] = React.useState<api.ConvertPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .convertPreview(threadId, target)
      .then((p) => { if (live) setPreview(p); })
      .catch((err) => { if (live) setError((err as { message?: string })?.message || "Could not preview that."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [threadId, target]);

  async function attach(id: string) {
    try {
      await api.recordConverted(threadId, `${target}:${id}`);
      onConverted();
      onClose();
    } catch (err) {
      reportActionError(err);
    }
  }

  const attachFirst = preview?.primary_action === "ATTACH_EXISTING";

  // The thread learns what it became when the target module reports back.
  // Recording it optimistically here would leave a thread claiming a lead that
  // the operator abandoned on the next screen.
  const createButton = preview ? (
    <Link to={createHref(preview)} onClick={onClose}>
      <Button size="sm" variant={attachFirst ? "outline" : "default"}>
        Create a new one
      </Button>
    </Link>
  ) : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Turn this into a record"
      description="This opens the owning module with the details filled in. Nothing is created until you save it there."
    >
      <div className="space-y-3">
        <Select
          value={target}
          onChange={(e) => setTarget(e.target.value as api.ConvertTarget)}
          aria-label="What this should become"
        >
          {TARGETS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>

        {loading && <LoadingRow label="Reading the thread…" />}
        {error && <ErrorState message={error} />}

        {preview && !loading && (
          <>
            <p className="text-xs text-muted-foreground">
              Created in <span className="font-medium">{preview.target_module}</span>, under that
              module's rights and numbering.
            </p>

            {/* Duplicates FIRST when the server says so. The order is the
                control — see the header. */}
            {attachFirst && preview.duplicates.length > 0 && (
              <Callout tone="warn" title="This may already exist.">
                {preview.hint || "Attach this email to the existing record instead of making another."}
              </Callout>
            )}

            {preview.duplicates.length > 0 && (
              <ul className="space-y-1">
                {preview.duplicates.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {d.name || d.id}
                      {typeof d.score === "number" && (
                        <Pill tone={d.score >= 85 ? "ok" : "warn"}>{Math.round(d.score)}% match</Pill>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant={attachFirst ? "default" : "outline"}
                      onClick={() => attach(d.id)}
                    >
                      Attach to this
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-lg border border-border px-3 py-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                What will be filled in
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(preview.prefill || {})
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="text-muted-foreground">{fieldLabel(k)}</dt>
                      <dd className="num text-right">{smartCell(v)}</dd>
                    </React.Fragment>
                  ))}
              </dl>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
              {createButton}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
