/**
 * Navigation glyphs.
 *
 * `app/layout/app-shell.tsx` defined TWENTY-SIX icons inline against the shared
 * set's twenty (audit F6: "three icon systems", with download, search, shield,
 * help and chevron each drawn two or three times with different path data).
 * Moving them here does not merge the two sets — that is Phase 4's per-area
 * sweep — but it takes 227 lines out of a 924-line shell and gives the nav's
 * glyphs one home, which is the precondition for merging them at all.
 *
 * These are deliberately 16px, 1.7 stroke: a nav row is denser than a button
 * row, and the shared `ui/icons` set is tuned at 18px / 1.75.
 */
import * as React from "react";

// --- tiny inline icons (stroke inherits currentColor) ----------------------
export type IP = React.SVGProps<SVGSVGElement>;
const sic = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 16,
  height: 16,
  "aria-hidden": true,
  ...p,
});
export const TowerIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 11l9-8 9 8M5 10v10h14V10" />
  </svg>
);
export const FinanceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
  </svg>
);
export const WarehouseIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 9l9-5 9 5v10l-9 5-9-5z" />
  </svg>
);
export const FleetIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 7h13l5 5v5h-3" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);
export const MoreIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);
/** "All areas" — a 3×3 grid, the conventional glyph for an app/area index. */
export const GridIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" />
    <rect x="14.5" y="3.5" width="6" height="6" rx="1.2" />
    <rect x="3.5" y="14.5" width="6" height="6" rx="1.2" />
    <rect x="14.5" y="14.5" width="6" height="6" rx="1.2" />
  </svg>
);
/** Hamburger. Replaces the literal "☰" character the shell used as its mobile
 *  menu control — a text glyph is not an icon: it inherits the font stack, has
 *  no fixed metrics, and renders differently on every platform (F14). */
export const MenuIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
/** Warning triangle for the sandbox banner, replacing the literal "⚠". */
export const AlertIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4.5M12 17h.01" />
  </svg>
);
export const ChevronIcon = (p: IP) => (
  <svg {...sic(p)} width={14} height={14}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const FilesIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 4h6l2 3h8v13H4z" />
  </svg>
);
export const SearchIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </svg>
);
export const OperationsIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 5h6l2 3h8v11H4z" />
  </svg>
);
export const CommercialIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
export const SalesIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="8" cy="9" r="2.5" />
    <path d="M3.5 19a4.5 4.5 0 0 1 9 0" />
    <circle cx="16.5" cy="9" r="2.5" />
    <path d="M14 19a4.5 4.5 0 0 1 6.5-4" />
  </svg>
);
export const ProcurementIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
    <path d="M3 4h2l2.4 12h10L20 8H6" />
  </svg>
);
export const CostingIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2" />
  </svg>
);
export const HrIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);
export const MasterIcon = (p: IP) => (
  <svg {...sic(p)}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3 3 7 3s7-1.3 7-3v-6" />
  </svg>
);
export const VaultIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
export const CommsIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 5h16v11H8l-4 3z" />
  </svg>
);
export const SecurityIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
  </svg>
);
export const GovernanceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M10 5h9M10 12h9M10 19h9" />
    <path d="M4 5l1.4 1.4L8 4M4 12l1.4 1.4L8 11M4 19l1.4 1.4L8 18" />
  </svg>
);
export const SettingsIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M4.2 7l2.2 1.3M17.6 15.7 19.8 17M4.2 17l2.2-1.3M17.6 8.3 19.8 7" />
  </svg>
);
export const PaletteIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1" />
    <circle cx="15.5" cy="10" r="1" />
    <circle cx="12" cy="15.5" r="1" />
  </svg>
);
export const DownloadIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
  </svg>
);
export const LogoutIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </svg>
);
export const AREA_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  Overview: TowerIcon,
  Commercial: CommercialIcon,
  "Sales & CRM": SalesIcon,
  Operations: OperationsIcon,
  Procurement: ProcurementIcon,
  Costing: CostingIcon,
  Finance: FinanceIcon,
  Warehouse: WarehouseIcon,
  Fleet: FleetIcon,
  "People & HR": HrIcon,
  "Master data": MasterIcon,
  Vault: VaultIcon,
  Comms: CommsIcon,
  "Security & Access": SecurityIcon,
  Governance: GovernanceIcon,
  "Settings & Admin": SettingsIcon,
};

// --- per-child icons for the Overview section (side panel + header dropdown) ---
export const WorkspaceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </svg>
);
export const SupportIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3 2.4c-.6.2-1 .8-1 1.6" />
    <path d="M12 17h.01" />
  </svg>
);
export const GodModeIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M13 3 4 14h6l-1 7 9-11h-6z" />
  </svg>
);
export const DotIcon = (p: IP) => (
  <svg {...sic(p)} width={14} height={14}>
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);
/** Icon per Overview child, keyed by route. Falls back to a small dot. */
export const CHILD_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  "/": TowerIcon,
  "/workspace": WorkspaceIcon,
  "/support": SupportIcon,
  "/godmode": GodModeIcon,
};
