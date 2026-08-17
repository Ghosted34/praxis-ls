/**
 * Settings — business policies (credit terms, approval thresholds and the like).
 *
 * Split out of `features/settings/store-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { errMsg, useList } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { PageError } from "./shared";
import { type Entry, entryValue } from "./store-shared";
import { slug } from "./store-shared";

function PolicyForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Entry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const v = editing?.value ?? {};
    setName(v.name ? String(v.name) : "");
    setKey(editing?.key ?? "");
    setBody(v.body_html ? String(v.body_html) : "");
    setError(null);
  }, [open, editing]);

  const canSubmit = !!name.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const k = editing?.key || slug(key || name);
    try {
      await tenant(`/settings/policy/${encodeURIComponent(k)}`, {
        method: "PUT",
        body: { value: { name: name.trim(), body_html: body } },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit policy" : "New policy"}
      description="A named policy document — privacy, refund, QMS, terms and the like."
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Name")} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Privacy policy"
            />
          </Field>
          <Field
            label={tr("Key")}
            hint={
              editing ? "Locked after creation" : "e.g. privacy, refund, terms"
            }
          >
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="privacy"
              disabled={!!editing}
            />
          </Field>
        </div>
        <Field label="Body (HTML or text)">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder="Your policy text…"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save policy" : "Create policy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function BusinessPoliciesPage() {
  const { rows, error, reload } = useList("/settings/policy");
  const [editing, setEditing] = React.useState<Entry | null>(null);
  const [open, setOpen] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const edit = (e: Entry | null) => {
    setEditing(e);
    setOpen(true);
  };
  async function del(key: string) {
    setRowBusy(key);
    setRowError(null);
    try {
      await tenant(`/settings/policy/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Business policies"
        description="Named policy documents — privacy, refund, QMS, terms and more."
        action={<Button onClick={() => edit(null)}>New policy</Button>}
      />

      <PageError message={rowError} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No policies yet"
          hint="Add a privacy, refund or terms policy."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{tr("Name")}</TH>
              <TH>{tr("Key")}</TH>
              <TH>{tr("Actions")}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const key = String(r.key);
              const v = entryValue(r);
              return (
                <TR key={key}>
                  <TD className="text-sm font-medium">{cell(v.name)}</TD>
                  <TD className="num text-sm">{key}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => edit({ key, value: v })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={rowBusy === key}
                        onClick={() => del(key)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <PolicyForm
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={reload}
      />
    </section>
  );
}
