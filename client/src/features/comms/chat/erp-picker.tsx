/**
 * "Attach a record" — one search box across every kind the reader may see.
 *
 * ── WHY THERE IS NO TYPE SELECTOR FIRST ───────────────────────────────────
 *
 * Somebody who types "SLAS-2026" does not necessarily know whether that is a
 * dossier ref or an invoice number, and making them choose before they search
 * is asking them to answer a question the product can answer for them. The
 * chips below FILTER an existing result set; they are not a required first
 * step.
 *
 * A kind the reader cannot see never appears — not as a greyed row, not as a
 * "restricted" placeholder. A picker is a list of things you may attach, and
 * offering a row that turns into "you don't have access" the moment it is sent
 * is a worse answer than not offering it.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import { money, dateDmy } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/smartcomm-api";
import type { ErpCard, ErpKind } from "@/lib/smartcomm-api";


/**
 * Focus this element once, on mount.
 *
 * Not the `autoFocus` attribute: that is banned by `jsx-a11y/no-autofocus`
 * because on a PAGE it yanks focus from wherever the reader was. Inside a panel
 * the reader has just opened by pressing a button, moving focus in is the
 * correct behaviour — and doing it in an effect makes that distinction explicit
 * rather than hiding it behind an attribute that means both things.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

const KINDS: { key: ErpKind; label: string }[] = [
  { key: "INVOICE", label: "Invoices" },
  { key: "DOSSIER", label: "Files" },
  { key: "CLIENT", label: "Clients" },
  { key: "PURCHASE_ORDER", label: "Purchase orders" },
  { key: "SUPPLIER_INVOICE", label: "Supplier invoices" },
];

export function ErpPicker({
  open,
  onClose,
  onPick,
  embedded = false,
}: {
  embedded?: boolean;
  open: boolean;
  onClose: () => void;
  onPick: (card: ErpCard) => void;
}) {
  const [term, setTerm] = React.useState("");
  const [kinds, setKinds] = React.useState<ErpKind[]>([]);
  const [rows, setRows] = React.useState<ErpCard[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const searchRef = useFocusOnMount<HTMLInputElement>();

  // Debounced, and the in-flight request is abandoned when a newer one starts:
  // without that, a fast typist gets results for "SLA" arriving after results
  // for "SLAS-2026" and the list flickers backwards.
  React.useEffect(() => {
    if (!open) return undefined;
    const q = term.trim();
    if (q.length < 2) {
      setRows([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchErp(q, kinds.length ? kinds : undefined)
        .then((r) => { if (alive) { setRows(r); setError(null); } })
        .catch((e) => { if (alive) { setError(errMsg(e)); setRows([]); } })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [term, kinds, open]);

  // A fresh dialog every time. Reopening onto the previous search is a small
  // thing that reads as the product not having noticed it was closed.
  React.useEffect(() => {
    if (open) {
      setTerm("");
      setRows([]);
      setKinds([]);
      setError(null);
    }
  }, [open]);

  const toggleKind = (k: ErpKind) =>
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const content = (
    <>
      <div className="space-y-3">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={tr("Invoice number, file ref, client name…")}
          aria-label={tr("Search records")}
          ref={searchRef}
        />

        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kinds.includes(k.key)}
              onClick={() => toggleKind(k.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-micro transition-colors",
                kinds.includes(k.key)
                  ? "border-primary bg-primary/10 text-primary-ink"
                  : "border-border bg-card text-muted-foreground hover:bg-accent/60",
              )}
            >
              {tr(k.label)}
            </button>
          ))}
        </div>

        <div className="max-h-[320px] min-h-[160px] overflow-y-auto rounded-lg border border-border">
          {term.trim().length < 2 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {tr("Type at least two characters to search.")}
            </p>
          ) : loading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{tr("Searching…")}</p>
          ) : error ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{error}</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {/* Says what it searched. "No results" alone leaves the reader
                  wondering whether they lack access or the record is absent. */}
              {tr("Nothing matched, in the records you can see.")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={`${c.kind}:${c.id}`}>
                  <button
                    type="button"
                    onClick={() => { onPick(c); onClose(); }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {c.title || c.ref}
                      </span>
                      <span className="block truncate text-micro text-muted-foreground">
                        {[c.subtitle, c.status ? c.status.replace(/_/g, " ").toLowerCase() : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {c.amount !== null && (
                        <span className="block text-sm tabular-nums text-foreground">
                          {money(c.amount, c.currency)}
                        </span>
                      )}
                      {c.date && (
                        <span className="block text-micro text-muted-foreground">{dateDmy(c.date)}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-micro text-muted-foreground">
          {tr("The card reads live — whoever you send it to sees the record as it stands when they open it, and only if they have access to it.")}
        </p>
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
      </div>
    </>
  );
  return embedded ? content : <Dialog open={open} onClose={onClose} title={tr("Attach a record")} size="md">{content}</Dialog>;
}
