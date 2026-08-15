/**
 * Settings — outbound email signatures.
 *
 * Split out of `features/settings/store-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Field } from "@/components/ui/modal";
import { errMsg, useList } from "@/lib/use-resource";
import { entryValue } from "./store-shared";

export function EmailSignaturesPage() {
  const { rows, error, reload } = useList("/settings/email_signature");
  const [html, setHtml] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!rows) return;
    const tpl = rows.find((r) => String(r.key) === "template");
    const v = tpl ? entryValue(tpl) : {};
    setHtml(v.html ? String(v.html) : "");
  }, [rows]);

  async function save() {
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      await tenant("/settings/email_signature/template", {
        method: "PUT",
        body: { value: { html } },
      });
      setSaved(true);
      reload();
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={pageShell.reading}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Email signatures"
        description="The tenant-wide brand signature template. Per-staff rendering is managed on each user's profile."
      />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : (
        <div className="lux-card space-y-4 p-4">
          <Field
            label="Signature template (HTML)"
            hint="Use tokens like {{user.full_name}}, {{user.email}}, {{tenant.name}}"
          >
            <Textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={10}
              placeholder="<p>{{user.full_name}}<br/>{{tenant.name}}</p>"
            />
          </Field>
          {saveError && <ErrorState message={saveError} />}
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="text-sm text-muted-foreground">Saved.</span>
            )}
            <Button onClick={save} loading={busy}>
              Save signature
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════ Business policies ═══════════════════════════════ */
