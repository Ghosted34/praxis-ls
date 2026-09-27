/**
 * THE "BY FAMILY" VIEW — what a client will read, next to what we costed.
 *
 * Tenant review "meeting 5" (21 Sep 2026, 01:28:21): the costing breaks
 * "Customs Formalities 500 000" into six lines — duties, the clearance fee,
 * the officers' transport, a gate pass… — and the quotation and invoice must
 * show the client the one line. This view groups the detailed lines exactly as
 * those documents print them (lib/client-headings.ts, the twin of the
 * template's grouping): one block per heading × nature, disbursements and our
 * own fees never mixed, a subtotal per block.
 *
 * It is also where a pricer MOVES a line to another family for this file, or
 * makes one up ("DAP Douala–Bangui"). The choice is saved on the line as
 * `client_heading` and rides costing → margin simulation → quotation →
 * invoice; "Catalogue default" clears it back to the dictionary's heading.
 *
 * A registry heading is stored by its CODE, which survives a rename and
 * resolves to the heading's bilingual name at print time; a made-up family is
 * stored as its text.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { usePrompt } from "@/components/ui/use-prompt";
import { useResource } from "@/lib/use-resource";
import { amount as fmt, money } from "@/lib/format";
import { listDictRefs } from "@/lib/masterdata-api";
import {
  groupByFamily,
  headingLabel,
  resolveHeading,
  OTHER_HEADING,
  type HeadedLine,
  type HeadingRef,
} from "@/lib/client-headings";

export type FamilyLine = HeadedLine & {
  label: string;
  qty: number | null;
  /** The line's amount in the document's currency (qty × unit). */
  amount: number;
};

const NEW = "__new__";
const CATALOGUE = "";

export function ClientFamilies<T extends FamilyLine>({
  lines,
  currency,
  readOnly,
  onHeading,
}: {
  lines: T[];
  currency: string;
  readOnly: boolean;
  /** Set (or clear, with null) the family of the line at `index`. */
  onHeading: (index: number, heading: string | null) => void;
}) {
  const refs = useResource(() => listDictRefs("CLIENT_HEADING"), []);
  const registry: HeadingRef[] = React.useMemo(() => refs.data || [], [refs.data]);
  const [prompt, promptDialog] = usePrompt();

  const families = groupByFamily(lines, registry);
  // Families made up on this document, offered on every line so a second line
  // can join the first without retyping it.
  const customs = [
    ...new Set(
      lines
        .map((l) => resolveHeading(l, registry))
        .filter((h) => h.custom)
        .map((h) => h.en),
    ),
  ];
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  async function choose(index: number, value: string) {
    if (value === NEW) {
      const name = await prompt({
        title: tr("New family for this document"),
        label: tr("Heading the client reads"),
        hint: tr("For example: DAP Douala–Bangui. It applies to this document only."),
        validate: (v) => (v.trim().length < 2 ? tr("At least two characters.") : null),
        confirmLabel: tr("Use this heading"),
      });
      if (name) onHeading(index, name);
      return;
    }
    onHeading(index, value === CATALOGUE ? null : value);
  }

  /** The select's value for a line: its stored override, or the catalogue. */
  const valueOf = (l: HeadedLine) => {
    const raw = (l.client_heading || "").trim();
    if (!raw) return CATALOGUE;
    const hit = registry.find(
      (r) => [r.code, r.name_en, r.name_fr].some((v) => (v || "").toLowerCase() === raw.toLowerCase()),
    );
    return hit ? hit.code : raw;
  };

  return (
    <div className="space-y-3">
      {promptDialog}
      <p className="micro">
        {tr(
          "What the client's quotation and invoice will print: one line per family, disbursements and our fees kept apart. The costing keeps every line.",
        )}
      </p>
      {families.map((f) => {
        const subtotal = f.lines.reduce((a, x) => a + (Number(x.line.amount) || 0), 0);
        const name = headingLabel(f.heading);
        const title = f.mixed
          ? `${name} — ${f.nature === "disbursement" ? tr("Disbursements") : tr("Service Fee")}`
          : name;
        return (
          <section key={`${f.heading.key}|${f.nature}`} className="rounded-lg border">
            <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="truncate text-sm font-semibold text-foreground">{title}</h4>
                {f.nature === "disbursement" && <Pill tone="mute">{tr("(PT)")}</Pill>}
                {f.heading.custom && <Pill tone="blue">{tr("This document only")}</Pill>}
              </div>
              <span className="num text-sm font-semibold text-foreground">{fmt(subtotal)}</span>
            </header>
            <ul className="divide-y divide-border">
              {f.lines.map(({ line, index }) => {
                const catalogue = resolveHeading({ ...line, client_heading: null }, registry);
                return (
                  <li
                    key={index}
                    className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_16rem_8rem]"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">{line.label || "—"}</span>
                    {readOnly ? (
                      <span className="micro">{name}</span>
                    ) : (
                      <Select
                        aria-label={`${tr("Family")} — ${line.label || tr("line")} ${index + 1}`}
                        value={valueOf(line)}
                        onChange={(e) => void choose(index, e.target.value)}
                      >
                        <option value={CATALOGUE}>
                          {`${tr("Catalogue")}: ${headingLabel(catalogue === OTHER_HEADING ? OTHER_HEADING : catalogue)}`}
                        </option>
                        {registry.map((r) => (
                          <option key={r.code} value={r.code}>
                            {headingLabel({ key: r.code, fr: r.name_fr || "", en: r.name_en || "", sort: 0, custom: false })}
                          </option>
                        ))}
                        {customs.map((c) => (
                          <option key={`custom:${c}`} value={c}>
                            {c}
                          </option>
                        ))}
                        <option value={NEW}>{tr("New heading…")}</option>
                      </Select>
                    )}
                    <span className="num text-right text-sm">{fmt(line.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>{tr("Total (HT)")}</span>
        <span className="num">{money(total, currency)}</span>
      </div>
    </div>
  );
}
