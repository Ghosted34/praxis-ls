/**
 * ResponsiveList — one set of records, a table on a desktop and cards on a
 * phone.
 *
 * WHY THIS EXISTS. Every 360 dossier in this app renders its child collections
 * — documents, contacts, addresses, banks, shareholders — as a `<table>` inside
 * an `overflow-x-auto` wrapper. That is the correct answer at 1440px and it is
 * the wrong one at 390px: the wrapper technically prevents the page from
 * breaking, but a nine-column table in a 390px window means the reader pans
 * sideways to reach the row's own status pill, and the action cell (View /
 * Replace / Verify / Edit / Remove, five controls) wraps into a ragged column
 * of half-width buttons. On the party 360 the documents tab measured roughly
 * one document per screen-height that way. The reader could not compare two
 * rows, which is the only thing a table is for.
 *
 * So below `md` the same records are cards: a title, the facts that identify
 * the record, its status pills and its actions — each on its own line, in a
 * fixed order, one record per card. The card is not "the table, wrapped"; it is
 * the mobile shape of the same data, and the three slots below (title / pills /
 * meta / actions) exist so that shape cannot drift between screens.
 *
 * ONLY ONE BRANCH MOUNTS. The tempting version of this component is a pair of
 * `hidden md:block` / `md:hidden` wrappers around both renderings. Do not: a
 * table and a card list of the same records are two copies of the same
 * controls in the accessibility tree, so a screen reader on a phone announces
 * every row action twice, and a test that queries `getByRole("button", { name:
 * "Verify" })` finds two matches and has to be told which one it means. The
 * guide's §3.11 states the rule for dialogs (branch in JavaScript, not in CSS)
 * and the same reasoning applies here — see `lib/use-media-query.ts`.
 *
 * The DESKTOP branch is whatever you already have. Pass the existing table as
 * `children` and it renders untouched above `md`; nothing about a screen that
 * does not adopt the card branch changes.
 *
 * @example
 * <ResponsiveList
 *   items={documents}
 *   renderItem={(doc) => (
 *     <RecordCard
 *       title={doc.title}
 *       pills={<><Pill>{doc.scan_status}</Pill>…</>}
 *       meta={[["Type", doc.type_name], ["Expires", dateDmy(doc.expires_on)]]}
 *       actions={<><ViewButton /><MoreMenu /></>}
 *     />
 *   )}
 * >
 *   <MiniTable head={…}>{rows}</MiniTable>
 * </ResponsiveList>
 *
 * BEST PRACTICE. Keep the same information in both branches, in the same
 * order, or the two shells drift and the phone becomes the one that lies. If a
 * column matters enough to be in the table, it belongs in `meta`; if it does
 * not, delete the column rather than dropping it from one branch.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { useIsCompact } from "@/lib/use-media-query";

export function ResponsiveList<T>({
  items,
  renderItem,
  children,
  className,
  itemClassName,
  empty,
}: {
  /** The records. Only used to drive the card branch (`renderItem` runs per
   *  item); the table branch reads whatever it was given as `children`. */
  items: readonly T[];
  /** The phone rendering of one record. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** The desktop rendering — a `<table>`, unchanged. */
  children: React.ReactNode;
  className?: string;
  /** Applied to each card, for spacing. */
  itemClassName?: string;
  /** Rendered instead of the cards when `items` is empty. Optional: most call
   *  sites already handle the empty case in the table branch, and rendering
   *  nothing here reproduces the desktop behaviour of an empty `<tbody>`. */
  empty?: React.ReactNode;
}) {
  const compact = useIsCompact();

  if (!compact) return <>{children}</>;

  if (items.length === 0) return <>{empty ?? null}</>;

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, i) => (
        <li key={i} className={itemClassName}>
          {renderItem(item, i)}
        </li>
      ))}
    </ul>
  );
}

/**
 * One record's card — the phone shell for a table row.
 *
 * The slots are positional on purpose: `title`, `pills`, `meta`, `actions` is
 * the reading order for every collection in this app (what is it, what state is
 * it in, the facts that identify it, what I can do to it), and a screen that
 * puts its actions second is a screen where the reader's thumb lands on Edit
 * before they have read what they are editing.
 *
 * `title` and `actions` share the first line — the title may be long and the
 * actions are one or two small controls, so they are pinned right rather than
 * left to wrap under the title.
 */
export function RecordCard({
  title,
  subtitle,
  pills,
  meta,
  actions,
  leading,
  className,
  children,
}: {
  title: React.ReactNode;
  /** A second line of identifying text under the title (a type name, a code,
   *  the establishment a document belongs to). Lower case on purpose — unlike
   *  the label slots in this card, a subtitle is arbitrary text from the
   *  record ("Douala Terminal Services"), and `.micro`'s uppercase turns a
   *  name into a shout. */
  subtitle?: React.ReactNode;
  /** A control before the title — the multi-select checkbox on the entity
   *  dossiers, where ticking rows is how a batch is shared as one ZIP. It sits
   *  in the card's first line rather than on a line of its own because it
   *  belongs to the whole card, not to any one of its facts. */
  leading?: React.ReactNode;
  /** Status pills — one line, wrapping, never truncated. */
  pills?: React.ReactNode;
  /** `[label, value]` pairs, rendered as a compact two-column definition grid
   *  with the label in `.micro`. A pair whose value is null/undefined/empty is
   *  dropped rather than rendering an em dash in a card that already has a
   *  "no data" story of its own. */
  meta?: [string, React.ReactNode][];
  /** The card's controls. One primary action, plus a `<MoreMenu>` for the off
   *  ones — see `components/ui/more-menu.tsx`. */
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const shown = (meta ?? []).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && v !== "—",
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 shadow-[var(--shadow-s)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {leading ? <span className="shrink-0 pt-0.5">{leading}</span> : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {title}
            </div>
            {subtitle ? (
              <div className="truncate text-[11px] leading-4 text-muted-foreground">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </div>

      {pills ? <div className="mt-1.5 flex flex-wrap gap-1.5">{pills}</div> : null}

      {shown.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {shown.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="micro">{label}</dt>
              <dd className="min-w-0 truncate text-sm">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {children}
    </div>
  );
}
