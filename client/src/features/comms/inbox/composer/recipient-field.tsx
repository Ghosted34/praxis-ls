/**
 * An address field that searches the address books the CALLER may read.
 *
 * ── Why this exists as its own component ────────────────────────────────────
 *
 * There were two recipient searches in the product and they disagreed. The old
 * legacy compose modal (removed) had one on To and nothing on Cc; the rich
 * composer had neither, because it only ever opened on a reply where the
 * address was already decided. So the moment the composer grew a "new message" mode — which
 * is what sending a document from its own page needs — Cc became a field where
 * you had to already know the address by heart.
 *
 * ── The results are gated SERVER-side, and that matters ─────────────────────
 *
 * `/mail/recipients` returns only the registers the caller holds a view grant
 * on (clients MOD-03, suppliers MOD-04, staff MOD-02, leads MOD-20). This
 * component does no filtering of its own and must not start: a client that
 * hides rows it was sent has already been sent them.
 *
 * `extra` is the exception, and it is a deliberate one. A document supplies its
 * OWN counterparty — the client a transit order is addressed to — from the
 * record rather than from a search, so an operations clerk who may raise the
 * order and not browse the client register can still send it to them. Those
 * rows come from the prefill endpoint, are about this one record, and are
 * merged in here rather than being smuggled into the search.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/** An address offered by the record itself rather than by the search. */
export type ExtraRecipient = {
  name?: string | null;
  email: string;
  /** Shown as the chip — "Consignee", "Client on file". */
  note?: string | null;
};

const lastToken = (s: string) => {
  const i = Math.max(s.lastIndexOf(","), s.lastIndexOf(";"));
  return s.slice(i + 1).trim();
};

export function RecipientField({
  id,
  value,
  onChange,
  extra = [],
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  extra?: ExtraRecipient[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [results, setResults] = React.useState<api.Recipient[]>([]);
  const [open, setOpen] = React.useState(false);

  const term = lastToken(value);

  React.useEffect(() => {
    if (disabled || term.length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    // Debounced: this fires on a keystroke and the server resolves four grant
    // lookups per call. 200ms is the same delay the old composer used.
    const t = setTimeout(() => {
      api.searchRecipients(term)
        .then((r) => { if (live) setResults(r); })
        .catch(() => { if (live) setResults([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [term, disabled]);

  /** The record's own addresses, offered while the field is empty or matching. */
  const extras = extra.filter(
    (e) => e.email
      && (term.length < 2
        || e.email.toLowerCase().includes(term.toLowerCase())
        || String(e.name || "").toLowerCase().includes(term.toLowerCase())),
  );

  // An address already in the field is not a suggestion — offering it again is
  // how a message goes out addressed to the same person twice.
  const chosen = new Set(
    value.split(/[,;]/).map((a) => a.trim().toLowerCase()).filter(Boolean),
  );
  const rows = [
    ...extras
      .filter((e) => !chosen.has(e.email.toLowerCase()))
      .map((e) => ({ key: `extra:${e.email}`, name: e.name || e.email, email: e.email, note: e.note || tr("On this document") })),
    ...results
      .filter((r) => !chosen.has(String(r.email).toLowerCase()))
      .map((r) => ({ key: `${r.type}:${r.id}`, name: r.name, email: r.email, note: r.type })),
  ];

  function pick(email: string) {
    const i = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
    const head = i >= 0 ? `${value.slice(0, i + 1)} ` : "";
    onChange(`${head}${email}, `);
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative flex-1">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // A click lands before blur closes the list, so the close is deferred.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "name@company.cm"}
        className="h-8"
        autoComplete="off"
      />
      {open && rows.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
          {rows.map((r) => (
            <button
              type="button"
              key={r.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r.email)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="min-w-0 truncate">
                <span className="text-foreground">{r.name}</span>{" "}
                <span className="num text-muted-foreground">{r.email}</span>
              </span>
              <Pill tone="mute">{r.note}</Pill>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
