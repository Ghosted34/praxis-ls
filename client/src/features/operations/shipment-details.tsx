/**
 * The Shared Shipment/Service Detail Component.
 *
 * ONE component, rendered by every screen that references an operations file —
 * costing, quotation, proforma, invoice, transit order, delivery note, the
 * dossier 360 and the client portal. It is the reason this feature exists: in
 * the legacy system each of those screens re-derived "what is the transport
 * reference / the route / the conveyance for this file" for itself, in its own
 * language, and the copies had already drifted apart.
 *
 * IT KNOWS NOTHING ABOUT SERVICE TYPES. Not one branch on "sea" or "air"
 * anywhere below. The server resolves each fact to a FACET — a Bill of Lading
 * and a MAWB are both TRANSPORT_REF — and this renders whichever facets came
 * back, in the order they came back. A service type invented years from now
 * displays correctly here with no change to this file, which is the whole
 * point of the design.
 *
 * A FACET WITH NO VALUE IS ABSENT, NOT BLANK. A warehousing file has no route
 * and no vessel, so it renders neither — where the legacy panel showed
 * "Vessel: -", "Route: -", "Transport ref: -" on every storage job.
 *
 * USAGE
 *   <ShipmentDetailsPanel dossierId={id} />                     // fetches
 *   <ShipmentDetailsPanel data={details} />                     // pre-fetched
 *   <ShipmentDetailsPanel dossierId={id} variant="strip" />     // one-line header
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

/* ── Small pieces ──────────────────────────────────────────────────────────── */

/**
 * One fact, as a subtle identity tile.
 *
 * The legacy layout was a bare `dt / dd` on the page background, and eighteen
 * of them stacked into a fog. The tile draws a soft ground and a brand-blue
 * label so the eye lands on the value first and can scan the labels as a rail —
 * corporate feel without a heavy card per row.
 *
 * `title` carries the contributing field labels, so a joined value ("MSC
 * ARUSHI / 128W") can still explain which half is the vessel.
 */
function FacetCell({ facet }: { facet: api.Facet }) {
  const provenance =
    facet.parts.length > 1
      ? facet.parts.map((p) => `${p.label}: ${p.value}`).join(" · ")
      : undefined;
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-muted/25 px-3 py-2">
      <dt className="micro font-medium tracking-wide text-brand-blue-ink">
        {facet.label}
      </dt>
      <dd
        className="mt-0.5 truncate text-sm font-medium text-foreground"
        title={provenance || facet.value}
      >
        {facet.value}
      </dd>
    </div>
  );
}

/**
 * Completeness, stated rather than enforced.
 *
 * A file opens on the day the booking lands, when the BL number and the ETA
 * genuinely are not known — so the form only blocks on the fields the service
 * type marked required, and everything else is reported here. This is what
 * replaces the "nag until it is filled" behaviour that would otherwise push
 * people to invent values.
 */
function CompletenessPill({ c }: { c: api.ShipmentDetails["completeness"] }) {
  if (!c.total) return null;
  if (c.is_complete) return <Pill tone="ok">{tr("Complete")}</Pill>;
  const tone = c.missing_required.length ? "warn" : "mute";
  return (
    <Pill tone={tone}>
      {c.filled}/{c.total} filled
      {c.missing_required.length
        ? ` · ${c.missing_required.length} required missing`
        : ""}
    </Pill>
  );
}

/* ── Equipment ─────────────────────────────────────────────────────────────── */

/**
 * A single per-box unit. This is what a delivery note references when it needs
 * to name the exact container that carried the cargo — the value that used to
 * be scribbled by hand at the port gate.
 */
function ContainerUnitRow({
  index,
  unit,
}: {
  index: number;
  unit: api.ContainerUnit;
}) {
  const no = unit.container_no?.trim();
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] items-baseline gap-x-3 gap-y-0 rounded-md border border-border/60 bg-background px-3 py-1.5">
      <span className="num micro text-muted-foreground">#{index + 1}</span>
      <span className="num truncate text-sm font-medium text-foreground">
        {no || (
          <span className="text-muted-foreground">
            {tr("No container number yet")}
          </span>
        )}
      </span>
      <span className="num micro truncate text-muted-foreground">
        {unit.seal_no ? `${tr("Seal")} ${unit.seal_no}` : ""}
      </span>
    </div>
  );
}

/**
 * The boxes on the file — the sole place a reader learns what container
 * carried what.
 *
 * TWO SHAPES. A GROUPED line is a count: "2 × 20' Flat Rack" is all we know.
 * A PER_BOX line has `units` recorded — the container number and seal for each
 * box — and the row expands to show them, because those numbers are the whole
 * reason the delivery note can be signed against a specific box rather than
 * "one of the two". The identified-count on the summary lets the reader see at
 * a glance whether the manifest has landed yet.
 */
function ContainerSummary({ block }: { block: api.ContainerBlock }) {
  if (!block.enabled || !block.lines.length) return null;
  const s = block.summary;
  const anyUnits = block.lines.some((l) => l.units && l.units.length);
  return (
    <section className="space-y-3 rounded-lg border border-border/70 border-l-2 border-l-brand-blue bg-card px-4 py-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-blue-ink">
          {tr("Equipment")}
        </h3>
        {s ? (
          <span className="micro text-muted-foreground">
            {s.boxes} box{s.boxes === 1 ? "" : "es"} · {s.teu} TEU
            {s.identified ? ` · ${s.identified} identified` : ""}
          </span>
        ) : null}
      </header>
      <ul className="space-y-3">
        {block.lines.map((l, i) => (
          <li
            key={l.dossier_container_line_id || i}
            className="space-y-2 text-sm"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="num font-medium text-foreground">{l.qty} ×</span>
              <span className="font-medium text-foreground">
                {l.container_type_en ||
                  l.container_type_fr ||
                  l.container_type_code}
              </span>
              {l.load_mode_en ? (
                <span className="micro text-muted-foreground">
                  · {l.load_mode_en}
                </span>
              ) : null}
            </div>
            {block.mode === "PER_BOX" && anyUnits && l.units?.length ? (
              <div className="space-y-1 pl-4">
                {l.units.map((u, ui) => (
                  <ContainerUnitRow key={ui} index={ui} unit={u} />
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {block.mode === "PER_BOX" && !anyUnits ? (
        <p className="micro text-muted-foreground">
          Container numbers appear here once the Bill of Lading arrives — open
          Edit containers to add them.
        </p>
      ) : null}
    </section>
  );
}

/* ── Variants ──────────────────────────────────────────────────────────────── */

/**
 * The one-line header for a document that has its own layout and only wants the
 * headline facts — route, reference, arrival. Used above a costing sheet or an
 * invoice, where a full panel would compete with the numbers.
 */
function Strip({ data }: { data: api.ShipmentDetails }) {
  const head = data.facet_order
    .filter((r) =>
      [
        "TRANSPORT_REF",
        "CONVEYANCE",
        "ARRIVAL_DATE",
        "CARGO_DESC",
        "CUSTODY_LOCATION",
      ].includes(r),
    )
    .slice(0, 4)
    .map((r) => data.facets[r]!)
    .filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="num font-medium text-foreground">
        {data.dossier.ref}
      </span>
      {data.route_label ? (
        <span className="text-foreground">{data.route_label}</span>
      ) : null}
      {head.map((f) => (
        <span key={f.role} className="text-muted-foreground">
          <span className="micro">{f.label}: </span>
          <span className="text-foreground">{f.value}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Everything the service type defines, in its own groups and order — the form's
 * layout, read-only. Each group becomes a subtly bordered section with a
 * brand-blue left rule, so the reader can pick up "Sea transport", "Cargo",
 * "Customs & trade" at a glance instead of one flat wall of key/value.
 *
 * The header is `<h3>`: the shipment panel above is `<h2>` (Panel default), so
 * these sit correctly under it in the document outline.
 */
function Groups({ groups }: { groups: api.DetailGroupValue[] }) {
  const withValues = groups
    .map((g) => ({
      ...g,
      fields: g.fields.filter((f) => f.display !== null && f.display !== ""),
    }))
    .filter((g) => g.fields.length);
  if (!withValues.length) return null;

  return (
    <div className="space-y-3">
      {withValues.map((g) => (
        <section
          key={g.code}
          className="space-y-3 rounded-lg border border-border/70 border-l-2 border-l-brand-blue bg-card px-4 py-3"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-blue-ink">
            {g.label}
          </h3>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="micro text-muted-foreground">{f.label}</dt>
                <dd
                  className="mt-0.5 truncate text-sm text-foreground"
                  title={f.display || undefined}
                >
                  {f.display}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/* ── The component ─────────────────────────────────────────────────────────── */

export type ShipmentDetailsPanelProps = {
  /** Fetches when given. Ignored if `data` is supplied. */
  dossierId?: string;
  /** Pre-fetched projection — for a screen that already loaded it (a document
   *  preview, a print view) and must not fire a second request. */
  data?: api.ShipmentDetails | null;
  /** `panel` = full block with groups. `facets` = the canonical strip only.
   *  `strip` = one line, for a document header. */
  variant?: "panel" | "facets" | "strip";
  /** Rendered top-right of the panel — the "Edit" button on the 360, nothing on
   *  a document. */
  action?: React.ReactNode;
  title?: string;
  className?: string;
};

export function ShipmentDetailsPanel({
  dossierId,
  data: given,
  variant = "panel",
  action,
  title,
  className,
}: ShipmentDetailsPanelProps) {
  const fetched = useResource<api.ShipmentDetails | null>(
    () =>
      given || !dossierId
        ? Promise.resolve(null)
        : api.getShipmentDetails(dossierId),
    [dossierId, given],
  );
  const data = given || fetched.data;

  if (fetched.error) return <ErrorState message={fetched.error} />;
  if (!data) return <Skeleton className="h-24 w-full" />;

  const facets = data.facet_order.map((r) => data.facets[r]!).filter(Boolean);

  if (variant === "strip") return <Strip data={data} />;

  const body = (
    <div className="space-y-5">
      {data.route_label ? (
        // The route as a real headline. The legacy panel wrote it as one small
        // line and it disappeared into the field grid — this file goes from
        // Antwerp to Douala, and that ought to be the first thing you see.
        <p className="text-base font-semibold text-foreground">
          {data.route_label}
        </p>
      ) : null}

      {facets.length ? (
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {facets.map((f) => (
            <FacetCell key={f.role} facet={f} />
          ))}
        </dl>
      ) : (
        // Not an error: a file whose service type has no form yet, or one where
        // nothing has been filled in. Say which, rather than rendering nothing.
        <p className="micro text-muted-foreground">
          {data.field_set
            ? "No details captured on this file yet."
            : "This service type has no detail form yet — add one under Service types → Details."}
        </p>
      )}

      {variant === "panel" ? (
        <>
          <ContainerSummary block={data.containers} />
          <Groups groups={data.groups} />
        </>
      ) : null}
    </div>
  );

  if (variant === "facets") return <div className={className}>{body}</div>;

  return (
    <Panel
      className={className}
      title={title || data.dossier.service_type_name || "Shipment details"}
      subtitle={
        data.field_set?.is_stale
          ? `Captured with form v${data.field_set.version} — no longer the live version`
          : undefined
      }
      action={
        <div className="flex items-center gap-2">
          <CompletenessPill c={data.completeness} />
          {action}
        </div>
      }
    >
      {body}
    </Panel>
  );
}

export default ShipmentDetailsPanel;
