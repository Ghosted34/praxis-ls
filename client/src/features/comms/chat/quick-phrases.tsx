import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/smartcomm-api";

export function QuickPhrases({
  onInsert,
}: {
  onInsert: (body: string) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = React.useState<api.QuickPhrase[]>([]);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<Partial<api.QuickPhrase> | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await api.listQuickPhrases());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    if (!editing?.label?.trim() || !editing.body?.trim() || busy) return;
    setBusy(true);
    try {
      await api.saveQuickPhrase(
        { label: editing.label.trim(), body: editing.body.trim() },
        editing.quick_reply_id,
      );
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteQuickPhrase(id);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <div className="space-y-3 p-3">
        <Field label={tr("Phrase name")}>
          <Input
            value={editing.label || ""}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setEditing({ ...editing, label: e.target.value })}
          />
        </Field>
        <Field label={tr("Phrase text")}>
          <Textarea
            value={editing.body || ""}
            maxLength={10000}
            rows={4}
            disabled={busy}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            {tr("Cancel")}
          </Button>
          <Button
            size="sm"
            loading={busy}
            disabled={!editing.label?.trim() || !editing.body?.trim()}
            onClick={save}
          >
            {tr("Save phrase")}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{tr("My quick phrases")}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing({})}>
          {tr("Add phrase")}
        </Button>
      </div>
      <Input
        aria-label={tr("Search phrases")}
        placeholder={tr("Search phrases…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? (
        <p className="micro">{tr("Loading…")}</p>
      ) : error ? (
        <div role="alert">
          {error}
          <Button size="sm" onClick={load}>
            {tr("Retry")}
          </Button>
        </div>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {rows
            .filter((r) =>
              `${r.label} ${r.body}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((r) => (
              <div
                key={r.quick_reply_id}
                className="rounded-lg border border-border p-2"
              >
                <button
                  type="button"
                  className="w-full text-left hover:text-primary-ink"
                  onClick={() => onInsert(r.body)}
                >
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {r.body}
                  </span>
                </button>
                <div className="mt-1 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditing(r)}
                  >
                    {tr("Edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDeleting(r.quick_reply_id)}
                  >
                    {tr("Delete")}
                  </Button>
                </div>
                {deleting === r.quick_reply_id && (
                  <div className="mt-2 space-y-1 border-t border-border pt-2">
                    <p className="text-xs">{tr("Delete this saved phrase?")}</p>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDeleting(null)}
                      >
                        {tr("Keep phrase")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => remove(r.quick_reply_id)}
                      >
                        {tr("Confirm delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          {!!rows.length &&
            !rows.some((r) =>
              `${r.label} ${r.body}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ) && <p className="micro">{tr("No phrases match your search.")}</p>}
          {!rows.length && (
            <p className="micro">
              {tr("No quick phrases yet. Add your first reusable message.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
