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
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

/* ── Small pieces ──────────────────────────────────────────────────────────── */

/**
 * One fact. `title` carries the contributing field labels, so a joined value
 * ("MSC ARUSHI / 128W") can still explain which half is the vessel — the panel
 * stays compact without the provenance being lost.
 */
function FacetCell({ facet }: { facet: api.Facet }) {
  const provenance =
    facet.parts.length > 1 ? facet.parts.map((p) => `${p.label}: ${p.value}`).join(" · ") : undefined;
  return (
    <div className="min-w-0">
      <dt className="micro text-muted-foreground">{facet.label}</dt>
      <dd className="truncate text-sm font-medium text-foreground" title={provenance || facet.value}>
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
  if (c.is_complete) return <Pill tone="ok">Complete</Pill>;
  const tone = c.missing_required.length ? "warn" : "mute";
  return (
    <Pill tone={tone}>
      {c.filled}/{c.total} filled
      {c.missing_required.length ? ` · ${c.missing_required.length} required missing` : ""}
    </Pill>
  );
}

/* ── Equipment ─────────────────────────────────────────────────────────────── */

/**
 * The boxes on the file. Grouped counts are the normal case ("2 × 20' Flat
 * Rack"); per-box numbers appear beneath a line once they have been recorded,
 * which is typically days later when the Bill of Lading arrives.
 */
function ContainerSummary({ block }: { block: api.ContainerBlock }) {
  if (!block.enabled || !block.lines.length) return null;
  const s = block.summary;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-sm font-medium text-foreground">Equipment</h4>
        {s ? (
          <span className="micro text-muted-foreground">
            {s.boxes} box{s.boxes === 1 ? "" : "es"} · {s.teu} TEU
            {s.identified ? ` · ${s.identified} identified` : ""}
          </span>
        ) : null}
      </div>
      <ul className="space-y-1">
        {block.lines.map((l, i) => (
          <li key={l.dossier_container_line_id || i} className="text-sm">
            <span className="num font-medium text-foreground">{l.qty} ×</span>{" "}
            <span className="text-foreground">{l.container_type_en || l.container_type_fr || l.container_type_code}</span>
            {l.load_mode_en ? <span className="micro text-muted-foreground"> · {l.load_mode_en}</span> : null}
            {l.units && l.units.length ? (
              <span className="micro text-muted-foreground">
                {" "}
                · {l.units.map((u) => u.container_no).filter(Boolean).join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
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
    .filter((r) => ["TRANSPORT_REF", "CONVEYANCE", "ARRIVAL_DATE", "CARGO_DESC", "CUSTODY_LOCATION"].includes(r))
    .slice(0, 4)
    .map((r) => data.facets[r]!)
    .filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="num font-medium text-foreground">{data.dossier.ref}</span>
      {data.route_label ? <span className="text-foreground">{data.route_label}</span> : null}
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
 * layout, read-only. Shown under the facet strip on the dossier 360, where the
 * question is "what do we know about this file" rather than "what goes on the
 * document".
 */
function Groups({ groups }: { groups: api.DetailGroupValue[] }) {
  const withValues = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.display !== null && f.display !== "") }))
    .filter((g) => g.fields.length);
  if (!withValues.length) return null;

  return (
    <div className="space-y-4">
      {withValues.map((g) => (
        <div key={g.code} className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">{g.label}</h4>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="micro text-muted-foreground">{f.label}</dt>
                <dd className="truncate text-sm text-foreground" title={f.display || undefined}>
                  {f.display}
                </dd>
              </div>
            ))}
          </dl>
        </div>
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
    () => (given || !dossierId ? Promise.resolve(null) : api.getShipmentDetails(dossierId)),
    [dossierId, given],
  );
  const data = given || fetched.data;

  if (fetched.error) return <ErrorState message={fetched.error} />;
  if (!data) return <Skeleton className="h-24 w-full" />;

  const facets = data.facet_order.map((r) => data.facets[r]!).filter(Boolean);

  if (variant === "strip") return <Strip data={data} />;

  const body = (
    <div className="space-y-4">
      {data.route_label ? (
        <p className="text-sm font-medium text-foreground">{data.route_label}</p>
      ) : null}

      {facets.length ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
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
