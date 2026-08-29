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
 *
 * ── IT IS A COMBOBOX, AND IT BEHAVES LIKE ONE ───────────────────────────────
 *
 * The suggestion list used to be reachable only with a mouse: no arrow keys, no
 * Enter, no Escape, and no roles — so a screen reader announced a plain text
 * input while eight results sat under it unannounced, and a keyboard user
 * typing an address had to abandon the list and type the whole thing out.
 *
 * This is the most-used control in the composer and the one where a mistake is
 * least recoverable (the wrong address on an invoice), so it now implements the
 * combobox pattern properly: `role="combobox"` with `aria-expanded` and
 * `aria-controls` on the input, `role="listbox"` / `role="option"` on the list,
 * and `aria-activedescendant` pointing at the highlighted row — which is what
 * lets focus STAY in the text field, where the caret has to be, while the
 * selection moves.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
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
  /** Which row the keyboard is on. -1 = none, so Enter falls through to submit. */
  const [active, setActive] = React.useState(-1);

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

  // A highlight that survives the list changing points at a different person
  // than it did a keystroke ago — which, on an address field, is how the wrong
  // recipient gets picked by somebody who was not looking.
  React.useEffect(() => { setActive(-1); }, [term]);

  const showList = open && rows.length > 0;

  function pick(email: string) {
    const i = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
    const head = i >= 0 ? `${value.slice(0, i + 1)} ` : "";
    onChange(`${head}${email}, `);
    setResults([]);
    setOpen(false);
    setActive(-1);
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
        onKeyDown={(e) => {
          if (!showList) {
            // ArrowDown on a closed list with results is "show me them".
            if (e.key === "ArrowDown" && rows.length) { setOpen(true); e.preventDefault(); }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % rows.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            // Only when a row is HIGHLIGHTED. Enter on an untouched list has to
            // stay the form's — swallowing it would break sending with the
            // keyboard, which is the thing this field sits in front of.
            e.preventDefault();
            pick(rows[active].email);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setActive(-1);
          } else if (e.key === "Tab" && active >= 0) {
            // Tabbing away with a row highlighted takes it — the same bargain
            // every address field makes, and it saves the comma.
            pick(rows[active].email);
          }
        }}
        placeholder={placeholder || "name@company.cm"}
        className="h-8"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
      />
      {showList && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label={tr("Matching people and companies")}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {rows.map((r, i) => (
            <button
              type="button"
              key={r.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              // Never focusable: focus stays in the text field so the caret
              // survives, and `aria-activedescendant` above is what tells a
              // screen reader which row is current.
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r.email)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                i === active ? "bg-accent" : "hover:bg-accent",
              )}
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
