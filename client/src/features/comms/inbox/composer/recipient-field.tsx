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
 *
 * ── AND MORE THAN ONE ADDRESS IS AN ORDINARY THING TO WANT ──────────────────
 *
 * The row was one plain text input holding a comma-separated string, and the
 * comma was the entire mechanism — undocumented, invisible, and the only way to
 * copy two people. Nothing on screen said a second address was possible, so
 * "there is no way to add a second one, no plus button, nothing" is exactly
 * what the control looked like. Worse, the row that got typed anyway
 * (`ops@camrail.cm billing@camrail.cm`, or a name pasted with its address) came
 * back from the server as `VALIDATION_ERROR: cc` after the send was pressed.
 *
 * So each address is now a CHIP, added by Enter, Tab, comma or semicolon,
 * removed by its × or by Backspace, and one that is not an address is drawn in
 * red WITH THE REASON, next to the field, before anything is sent. The chips
 * are the visible affordance the comma never was.
 *
 * The field still speaks to its parent in one comma-separated string — the
 * draft column, the autosave and the send payload all take that shape — but the
 * boundary between "committed" and "still being typed" lives here, which is
 * what lets a half-typed address stay editable instead of becoming a red chip
 * on every keystroke.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { addressTokens, bareAddress, isAddress, splitAddressList } from "./addresses";

/** An address offered by the record itself rather than by the search. */
export type ExtraRecipient = {
  name?: string | null;
  email: string;
  /** Shown as the tag on the suggestion row — "Consignee", "Client on file". */
  note?: string | null;
};

/** The committed addresses in a row, as the chips that will be drawn for them. */
const toChips = (s: string) => addressTokens(s);

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

  /* ── Chips and the one being typed ────────────────────────────────────────
   *
   * `chips` is what has been committed; `term` is the text still in the input.
   * Both are reported UP as one comma-separated row, so the parent's send
   * payload, guardrail check and autosave all see a half-typed address as soon
   * as it is typed — pressing Send without pressing Enter first must not
   * silently drop the address that is plainly on screen. */
  const [chips, setChips] = React.useState<string[]>(() => toChips(value));
  const [term, setTerm] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  /* The row we last reported. A `value` that differs from it came from the
   * parent — a draft reopened into this field, a prefill — and re-seeds the
   * chips; a `value` that matches is our own echo and must not, or every commit
   * would rebuild the list under the caret. */
  const mirror = React.useRef(value);
  React.useEffect(() => {
    if (value === mirror.current) return;
    mirror.current = value;
    setChips(toChips(value));
    setTerm("");
  }, [value]);

  const emit = React.useCallback((nextChips: string[], nextTerm: string) => {
    setChips(nextChips);
    setTerm(nextTerm);
    const row = [...nextChips, nextTerm.trim()].filter(Boolean).join(", ");
    mirror.current = row;
    onChange(row);
  }, [onChange]);

  /**
   * Commit what has been typed, plus anything pasted in with it.
   *
   * A paste is the reason this takes a string rather than reading `term`: three
   * addresses arriving at once should become three chips, not one chip holding
   * all three.
   */
  const commit = React.useCallback((text: string, rest = "") => {
    const added = toChips(text);
    if (!added.length && !rest) { setTerm(rest); return; }
    const seen = new Set(chips.map((c) => bareAddress(c).toLowerCase()));
    const next = [...chips];
    for (const a of added) {
      const k = bareAddress(a).toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      next.push(a);
    }
    emit(next, rest);
  }, [chips, emit]);

  const remove = (i: number) => {
    emit(chips.filter((_, n) => n !== i), term);
    inputRef.current?.focus();
  };

  React.useEffect(() => {
    if (disabled || term.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    // Debounced: this fires on a keystroke and the server resolves four grant
    // lookups per call. 200ms is the same delay the old composer used.
    const t = setTimeout(() => {
      api.searchRecipients(term.trim())
        .then((r) => { if (live) setResults(r); })
        .catch(() => { if (live) setResults([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [term, disabled]);

  const needle = term.trim().toLowerCase();

  /** The record's own addresses, offered while the field is empty or matching. */
  const extras = extra.filter(
    (e) => e.email
      && (needle.length < 2
        || e.email.toLowerCase().includes(needle)
        || String(e.name || "").toLowerCase().includes(needle)),
  );

  // An address already in the field is not a suggestion — offering it again is
  // how a message goes out addressed to the same person twice.
  const chosen = new Set(chips.map((a) => bareAddress(a).toLowerCase()).filter(Boolean));
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
  const bad = chips.filter((c) => !isAddress(c));

  function pick(email: string) {
    commit(email);
    setResults([]);
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  }

  return (
    <div className="relative flex-1">
      {/* One control to look at, so the chips read as being IN the field rather
          than beside it. The input takes the rest of the row (`flex-1`), which
          is what makes "click after the last chip and type" land in it —
          without a click handler on a div, which is a control a keyboard cannot
          reach pretending to be one it can. */}
      <div
        className={cn(
          "flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-[10px] border border-input bg-background px-1.5 py-1",
          "focus-within:border-[color-mix(in_srgb,var(--primary)_50%,transparent)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {chips.map((a, i) => {
          const ok = isAddress(a);
          return (
            <span
              key={`${a}-${i}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
                ok
                  ? "border-border bg-muted/50"
                  : "border-[rgb(var(--bad))]/40 bg-[rgb(var(--bad-fill)/0.12)] text-[rgb(var(--bad))]",
              )}
            >
              <span className="truncate">{a}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(i)}
                aria-label={`${tr("Remove")} ${a}`}
                className="rounded px-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          id={id}
          ref={inputRef}
          value={term}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setOpen(true);
            // A separator — typed or pasted — is what turns text into a chip.
            // Everything after the last one stays in the input, so pasting
            // "a@b.cm, c@" leaves `c@` where the caret is, still editable.
            const parts = splitAddressList(next);
            if (parts.length > 1) commit(parts.slice(0, -1).join(","), parts[parts.length - 1].trim());
            else emit(chips, next);
          }}
          onFocus={() => setOpen(true)}
          // A click lands before blur closes the list, so the close is deferred.
          // The typed address is committed on the way out: leaving a field is
          // how most people finish one, and an address that stayed as raw text
          // is an address the next chip check never looked at.
          onBlur={() => {
            if (term.trim()) commit(term);
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !term && chips.length) {
              // Back into the input rather than gone: a mistyped address is
              // corrected far more often than it is retyped from scratch.
              e.preventDefault();
              emit(chips.slice(0, -1), chips[chips.length - 1]);
              return;
            }
            if (!showList) {
              if (e.key === "Enter" && term.trim()) {
                // The form's Enter only when there is nothing to add. This is
                // the key people reach for to add a second recipient, and
                // sending the message instead is the surprise worth avoiding.
                e.preventDefault();
                commit(term);
                return;
              }
              if (e.key === "Tab" && term.trim()) { commit(term); return; }
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
            } else if (e.key === "Enter") {
              // A highlighted row wins; otherwise the typed text becomes a chip.
              // Enter with neither is left to the form — swallowing it would
              // break sending with the keyboard, which is the thing this field
              // sits in front of.
              if (active >= 0) { e.preventDefault(); pick(rows[active].email); }
              else if (term.trim()) { e.preventDefault(); commit(term); }
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            } else if (e.key === "Tab") {
              // Tabbing away with a row highlighted takes it — the same bargain
              // every address field makes, and it saves the comma.
              if (active >= 0) pick(rows[active].email);
              else if (term.trim()) commit(term);
            }
          }}
          placeholder={chips.length ? tr("Add another…") : (placeholder || "name@company.cm")}
          className={cn(
            "h-6 min-w-40 flex-1 bg-transparent px-1 text-[13px] outline-none",
            "placeholder:text-muted-foreground disabled:cursor-not-allowed",
          )}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-describedby={bad.length ? `${id}-invalid` : undefined}
          aria-invalid={bad.length ? true : undefined}
        />
      </div>

      {/* Said here, before the send, rather than by the server after it. The
          address is named: "Cc is invalid" leaves the operator to work out
          which of four it means. */}
      {bad.length > 0 && (
        <p id={`${id}-invalid`} className="mt-1 text-[0.6875rem] text-[rgb(var(--bad))]">
          {bad.map((a) => `"${a}"`).join(", ")}
          {bad.length > 1 ? ` ${tr("are not email addresses")}` : ` ${tr("is not an email address")}`}
        </p>
      )}

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
