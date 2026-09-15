/**
 * A record's 360 — a page on desktop, a sheet on a phone.
 *
 * ── WHY THIS IS A COMPONENT AND NOT A PATTERN YOU COPY ──────────────────────
 * The operations file 360 established the shape (doc/FRONTEND_GUIDE.md §3.11):
 * a real route for desktop so a reference can be pasted into an email, and the
 * dialog kept for phones because a full-page drill-in on a 390px viewport is a
 * navigation dead end. Transit orders and delivery notes want exactly the same
 * thing, and by the third copy the interesting parts — the `?focus=` exchange,
 * the redirect in each direction, the `replace` on both — are five subtle lines
 * that would drift the moment one of them was fixed and the others were not.
 *
 * Same argument as `client/eslint-local-rules/` being the single copy: a second
 * copy of a rule is a rule that drifts.
 *
 * ── THE THREE PIECES ────────────────────────────────────────────────────────
 *
 *   <Record360Page>     the page shell: back link, width, and the redirect that
 *                       hands a shared desktop link to the phone's sheet.
 *   <Record360Header>   the identity block — reference, pills, meta, actions.
 *   <Record360Rail>     what else the record touches, as cards.
 *
 * The LIST's half — `useRecordOpener`, which decides what a row click does and
 * exchanges a desktop `?focus=` for the route — is a hook, so it lives in
 * `lib/record-360.ts` (see the note there).
 *
 * The BODY is not here, and deliberately: what a transit order shows has
 * nothing in common with what a delivery note shows. Only the chrome is shared.
 *
 * @example
 * // in the list
 * const { isDesktop, openRecord, sheetId, closeSheet } =
 *   useRecordOpener("/operations/transit-orders", rows, (r) => r.transit_order_id);
 * <ListPage onRowClick={openRecord} … />
 * {sheetId && <TransitOrder360Modal id={sheetId} onClose={closeSheet} … />}
 *
 * // the page
 * <Record360Page basePath="/operations/transit-orders" backLabel="Transit orders" id={id}>
 *   <TransitOrder360 id={id} variant="page" />
 * </Record360Page>
 */
import * as React from "react";
import { Link, Navigate } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-media-query";
import { recordSheetPath } from "@/lib/record-360";

/**
 * The page shell: the back link, the width, and the hand-off to the sheet.
 *
 * A link shared from a desktop still opens on a phone — as the sheet, which is
 * what this product's detail views are below `lg`. The address survives the
 * hand-off; only the container changes. Rendered as a `<Navigate>` rather than
 * an effect, because there is no frame in which the page body should paint.
 *
 * It does NOT own the title. The body fetches the record, so the body is what
 * can name it — the `<h1>` lives in `<Record360Header>` and the back-arrow
 * tooltip is set by the body through `useTrailTitle`. A shell that took a title
 * prop would force every caller into a second fetch to supply it.
 */
export function Record360Page({
  basePath,
  backLabel,
  id,
  children,
}: {
  /** The list this record belongs to, e.g. `/operations/transit-orders`. */
  basePath: string;
  /** What the back link says, e.g. "Transit orders". */
  backLabel: string;
  /** The record's id, from `useParams`. */
  id: string;
  children: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();

  if (!isDesktop)
    return <Navigate to={recordSheetPath(basePath, id)} replace />;

  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div className="micro">
        <Link
          to={basePath}
          className="text-muted-foreground hover:text-foreground"
        >
          ← {backLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

/**
 * The identity block: what this record is, and what can be done to it.
 *
 * Page variant only — inside a dialog the title bar already says the reference
 * and the subtitle, and a second copy under it is the same words twice. The
 * ACTIONS still belong in both, which is why they are a separate prop the modal
 * renders on its own.
 *
 * `title` is the `<h1>`: the record IS the page, so it carries the document
 * outline rather than a generic screen name.
 */
export function Record360Header({
  title,
  titleClassName,
  pills,
  meta,
  subtitle,
  actions,
}: {
  title: string;
  /** e.g. `num` for a reference rendered in tabular figures. */
  titleClassName?: string;
  /** Status and classification pills, right of the title. */
  pills?: React.ReactNode;
  /** The one-line summary under the title. Falsy entries are dropped. */
  meta?: (string | null | undefined | false)[];
  /** A human title for the record, when it has one distinct from its reference. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const line = (meta || []).filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className={cn(
                "truncate text-lg font-semibold text-foreground",
                titleClassName,
              )}
            >
              {title}
            </h1>
            {pills}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm text-foreground">{subtitle}</p>
          )}
          <p className="mt-1 micro">{line || "—"}</p>
        </div>
        {actions}
      </div>
    </div>
  );
}

/**
 * One card in a record's related rail.
 *
 * A `to` makes it a real `<Link>` — middle-clickable, copyable, and it shows
 * its destination in the status bar. An `onClick` makes it a `<button>`, which
 * is what an in-page jump to another tab is. Neither makes it a `<div>` with a
 * handler, which is the shape that works for a mouse and for nothing else.
 *
 * ONLY LINK WHERE THE LINK LANDS. A card that navigates to a list which then
 * has to find the row is worse than one that stays put: the reader is moved and
 * still has to search. Where a destination takes no deep-link parameter, jump
 * to the tab holding the rows instead, or render the fact without a target.
 */
export function Record360Card({
  label,
  value,
  hint,
  to,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  to?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="micro uppercase tracking-wide">{label}</span>
      <span className="mt-1 block truncate text-sm font-medium text-foreground">
        {value}
      </span>
      {hint && <span className="mt-0.5 block truncate micro">{hint}</span>}
    </>
  );
  const cls =
    "block w-full rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (to)
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return (
    <div className="block w-full rounded-lg border bg-card px-3.5 py-2.5">
      {body}
    </div>
  );
}

/** The rail itself — what else this record touches, as a titled grid of cards. */
export function Record360Rail({
  title = "Related",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="micro mb-2">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}
