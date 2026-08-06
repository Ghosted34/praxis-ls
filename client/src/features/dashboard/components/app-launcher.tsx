/**
 * Application launcher — twelve tiles into the modules an operator uses daily.
 *
 * The mock rendered every tile with a hardcoded `onclick="go('ops')"`, so all
 * twelve opened its own sample Operations view whichever one you clicked; the
 * iframe build patched that by rebinding the rendered DOM to a label→route map
 * in the parent, keyed on the tile's visible text because the label was the only
 * identifier the mock's `apps` array carried. The route is now a property of the
 * tile, and the tile is a `<Link>`.
 *
 * TILES THIS USER CANNOT OPEN ARE NOT DRAWN. Twelve hard-coded destinations on
 * the landing screen is the widest single offer in the product, and it was made
 * to everybody: a warehouse role saw the OHADA ledger, the tax centre and
 * treasury, and found out what they meant by clicking one. The grid reflows over
 * however many survive, so a shorter list is a shorter grid rather than holes.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useCanOpenRoute } from "@/lib/route-access";

type IP = React.SVGProps<SVGSVGElement>;
const gi = (d: string) => (p: IP) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    width={20}
    height={20}
    {...p}
  >
    <path d={d} />
  </svg>
);

type Tile = { label: string; hint: string; to: string; Icon: (p: IP) => React.JSX.Element };

/** Routes carried over verbatim from the iframe build's `APP_ROUTE` map. */
export const LAUNCHER: Tile[] = [
  { label: "Operations", hint: "Dossiers · milestones", to: "/operations", Icon: gi("M4 4h6l2 3h8v13H4z") },
  { label: "Freight", hint: "Sea · air · transit", to: "/operations/files", Icon: gi("M3 14l9-4 9 4-9 5zM12 10V4") },
  { label: "Fleet", hint: "Dispatch · fuel", to: "/fleet", Icon: gi("M3 7h13l5 5v5h-3M5 17h2M17 17h2") },
  { label: "Warehouse", hint: "GRN · putaway · pick", to: "/wms", Icon: gi("M3 9l9-5 9 5v10l-9 5-9-5z") },
  { label: "Invoicing", hint: "Proforma · final", to: "/finance/invoices", Icon: gi("M4 6h16v13H4zM4 10h16") },
  { label: "Treasury", hint: "Bank · cash · MoMo", to: "/master/treasury-accounts", Icon: gi("M12 3v18M7 7h8a3 3 0 010 6H7") },
  { label: "OHADA ledger", hint: "Journals · GL · TB", to: "/finance/journals", Icon: gi("M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6") },
  { label: "Tax centre", hint: "TVA · WHT · DSF", to: "/finance/tax", Icon: gi("M6 3h12v18H6zM9 8h6M9 12h6M9 16h4") },
  { label: "CRM", hint: "Clients · pipeline", to: "/sales/leads", Icon: gi("M9 4a3 3 0 100 6 3 3 0 000-6M3 20a6 6 0 0112 0M17 11a2.5 2.5 0 100-5") },
  { label: "Procurement", hint: "PO · GRN · 3-way", to: "/procurement", Icon: gi("M3 4h2l2.4 12h10L20 8H6M9 20h.01M17 20h.01") },
  { label: "HR & payroll", hint: "People · CNPS", to: "/hr/employees", Icon: gi("M12 4a3.5 3.5 0 100 7 3.5 3.5 0 000-7M5 21a7 7 0 0114 0") },
  { label: "Settings", hint: "Config · white-label", to: "/settings", Icon: gi("M12 9a3 3 0 100 6 3 3 0 000-6M12 3v2M12 19v2M4 12H2M22 12h-2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4") },
];

export function AppLauncher({ onBrowseAll }: { onBrowseAll: () => void }) {
  const canOpen = useCanOpenRoute();
  const tiles = LAUNCHER.filter((t) => canOpen(t.to));

  return (
    <section aria-labelledby="ct-apps">
      <div className="mb-3 mt-6 flex items-center gap-3">
        <h2 id="ct-apps" className="text-title font-semibold tracking-tight">
          Applications
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={onBrowseAll}
          className="rounded-sm text-label font-semibold text-primary-ink hover:underline"
        >
          Browse everything →
        </button>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {tiles.map(({ label, hint, to, Icon }, i) => (
          <li key={to}>
            <Link
              to={to}
              className={cn(
                "flex h-full flex-col rounded-lg border bg-card p-4 shadow-[var(--shadow-s)]",
                "transition-colors hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] hover:bg-accent/40",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mb-3 grid h-10 w-10 place-items-center rounded-md",
                  // Alternating tint, as the mock did with :nth-child(even) —
                  // it keeps a 6-across row from reading as one orange band.
                  i % 2 === 0
                    ? "bg-[color-mix(in_srgb,var(--primary)_11%,transparent)] text-primary-ink"
                    : "bg-[rgb(var(--brand-blue)_/_0.12)] text-[rgb(var(--brand-blue-ink))]",
                )}
              >
                <Icon />
              </span>
              <span className="text-base font-semibold leading-tight">{label}</span>
              <span className="mt-0.5 text-label text-muted-foreground">{hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
