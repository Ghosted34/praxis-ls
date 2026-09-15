/**
 * The band's icon registry — drawing, not data.
 *
 * The server catalog ships an `icon` KEY per tile and no markup, for the same
 * reason it ships i18n keys instead of strings: this is the visual layer. The
 * registry must cover every key in `kpi_catalog` — and it must NOT crash on a
 * key it does not know: `iconForKpi` answers the domain glyph instead, so a
 * PR-2 tile that gains a bespoke icon here changes nothing downstream, and a
 * catalog typo degrades to a generic icon, never to a blank card or a React
 * error on the app's home screen.
 *
 * The four original cards' icons moved here VERBATIM (revenue, sla, overdue,
 * fleet) so the rebuild does not repaint the only pixels users have muscle
 * memory for.
 */
import * as React from "react";

type IP = React.SVGProps<SVGSVGElement>;
const ic = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 18,
  height: 18,
  "aria-hidden": true,
  ...p,
});

export const RevenueIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M4 19V5M4 19h16M8 15l3-4 3 3 4-6" />
  </svg>
);
export const SlaIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
export const OverdueIcon = (p: IP) => (
  <svg {...ic(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4l3 2" />
  </svg>
);
export const FleetIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M3 7h13l5 5v5h-3" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);
export const ProformaIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M7 3h7l3 3v15H7z" />
    <path d="M10 11h5M10 15h5" />
  </svg>
);
export const JournalIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M5 4h14v16H5zM9 4v16M12 9h4M12 13h4" />
  </svg>
);
export const FilesIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M4 6a1 1 0 011-1h4l2 2h8a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1z" />
  </svg>
);
export const ApprovalsIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M12 4l2 4 4 1-3 3 .7 4-3.7-2-3.7 2L9 12 6 9l4-1z" />
    <path d="M5 20h14" />
  </svg>
);
export const ComplianceIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M6 3v18M6 4h11l-2 4 2 4H6" />
  </svg>
);
export const LocationIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M12 21s-7-6-7-11a7 7 0 1114 0c0 5-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);
export const ReceiptIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M5 3h14v18l-2.3-1.4L14.4 21l-2.4-1.4L9.6 21l-2.3-1.4L5 21zM8.5 8.5h7M8.5 12.5h7" />
  </svg>
);
export const ClockIcon = (p: IP) => (
  <svg {...ic(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const MarginIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M4 20L20 4M7 4H4v3M20 17v3h-3" />
  </svg>
);
export const TruckIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M2 6h11v9H2zM13 9h4l4 3v3h-8" />
    <circle cx="6" cy="17" r="1.8" />
    <circle cx="16.5" cy="17" r="1.8" />
  </svg>
);
export const WarehouseIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M3 21V8l9-5 9 5v13M7 21v-7h10v7M7 17.5h10" />
  </svg>
);
export const StockIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
  </svg>
);
export const PeopleIcon = (p: IP) => (
  <svg {...ic(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0111 0M15.5 5.4a3.2 3.2 0 010 5.2M17 20a5.5 5.5 0 00-2.2-4.4" />
  </svg>
);
/** Domain fallbacks — an icon key the registry lacks paints these, not nothing. */
const DOMAIN_FALLBACK: Record<string, (p: IP) => React.JSX.Element> = {
  money: RevenueIcon,
  operations: FilesIcon,
  fleet_warehouse: TruckIcon,
  sales_procurement: ReceiptIcon,
  human_capital: PeopleIcon,
};

const REGISTRY: Record<string, (p: IP) => React.JSX.Element> = {
  revenue: RevenueIcon,
  sla: SlaIcon,
  overdue: OverdueIcon,
  fleet: FleetIcon,
  proforma: ProformaIcon,
  journal: JournalIcon,
  files: FilesIcon,
  approvals: ApprovalsIcon,
  compliance: ComplianceIcon,
  location: LocationIcon,
  receipt: ReceiptIcon,
  clock: ClockIcon,
  margin: MarginIcon,
  truck: TruckIcon,
  warehouse: WarehouseIcon,
  stock: StockIcon,
  people: PeopleIcon,
};

export function iconForKpi(iconKey: string, domain?: string): (p: IP) => React.JSX.Element {
  return REGISTRY[iconKey] ?? DOMAIN_FALLBACK[domain ?? ""] ?? FilesIcon;
}
