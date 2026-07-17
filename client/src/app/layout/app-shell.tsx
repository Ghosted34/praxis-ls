/**
 * Protected app shell — Lovable "Control Tower" look on the app's real nav.
 *
 * Navigation lives in the top command bar: the primary areas — Control Tower,
 * Finance, Warehouse, Fleet — sit inline. Areas with child screens open a
 * dropdown on hover (with a short grace delay) or on click/tap (kept as a
 * fallback for touch + keyboard); Control Tower is a direct link. A "More"
 * button opens the full menu as a collapsible overlay sidebar (outside-click or
 * Escape to close). On mobile the inline areas collapse and the hamburger opens
 * that same sidebar.
 */
import * as React from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { tokenStore } from "@/lib/token-store";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { cn } from "@/lib/cn";

type NavItem = { to: string; label: string };
type NavGroup = { heading: string; items: NavItem[]; prefix?: string };

// Menu mirrors the target IA map (doc/FE_IA_HANDOFF.md). Screens without a page
// yet route to a shared "Coming soon" placeholder — tab-children are kept as flat
// items for now (they'll fold into tabbed parents when those screens are built).
const NAV: NavGroup[] = [
  {
    heading: "Overview",
    prefix: "/",
    items: [
      { to: "/", label: "Control Tower" },
      { to: "/workspace", label: "My workspace" },
      { to: "/godmode", label: "God mode" },
    ],
  },
  {
    heading: "Commercial",
    prefix: "/commercial",
    items: [
      { to: "/commercial/quotations", label: "Quotations" },
      { to: "/commercial/margin-simulation", label: "Margin simulation" },
      { to: "/commercial/extra-charge-simulation", label: "Extra-charge simulation" },
      { to: "/commercial/pricing-variance", label: "Pricing variance" },
    ],
  },
  {
    heading: "Sales & CRM",
    prefix: "/sales",
    items: [
      { to: "/sales/leads", label: "Leads & intake" },
      { to: "/sales/leads?tab=intake", label: "Inbound intake" },
      { to: "/sales/opportunities", label: "Opportunities" },
      { to: "/sales/proposals", label: "Proposals" },
      { to: "/sales/meetings", label: "Meetings" },
      { to: "/sales/campaigns", label: "Marketing campaigns" },
      { to: "/sales/success-stories", label: "Success stories" },
    ],
  },
  {
    heading: "Operations",
    prefix: "/operations",
    items: [
      { to: "/operations", label: "Operations" },
    ],
  },
  {
    heading: "Procurement",
    prefix: "/procurement",
    items: [
      { to: "/procurement", label: "Procurement" },
    ],
  },
  {
    heading: "Costing",
    prefix: "/costing",
    items: [
      { to: "/costing", label: "Costing" },
    ],
  },
  {
    heading: "Finance",
    prefix: "/finance",
    items: [
      { to: "/finance/chart-of-accounts", label: "Chart of accounts" },
      { to: "/finance/journals", label: "Journals" },
      { to: "/finance/proformas", label: "Proforma & advances" },
      { to: "/finance/invoices", label: "Invoices" },
      { to: "/finance/credit-notes", label: "Credit notes" },
      { to: "/finance/receivables", label: "Receivables" },
      { to: "/finance/statements", label: "Statements" },
      { to: "/finance/tax", label: "Tax center" },
      { to: "/finance/assets", label: "Assets" },
      { to: "/finance/debt", label: "Debt" },
    ],
  },
  {
    heading: "Warehouse",
    prefix: "/wms",
    items: [
      { to: "/wms/locations", label: "Locations" },
      { to: "/wms/inventory", label: "Inventory" },
      { to: "/wms/inbound", label: "Inbound / GRN" },
      { to: "/wms/outbound", label: "Outbound" },
      { to: "/wms/equipment", label: "Equipment" },
      { to: "/wms/cycle-counts", label: "Cycle counts" },
    ],
  },
  {
    heading: "Fleet",
    prefix: "/fleet",
    items: [
      { to: "/fleet/vehicles", label: "Vehicles" },
      { to: "/fleet/compliance", label: "Compliance" },
      { to: "/fleet/work-orders", label: "Work orders" },
      { to: "/fleet/dispatch", label: "Dispatch" },
      { to: "/fleet/fuel", label: "Fuel log" },
      { to: "/fleet/drivers", label: "Drivers" },
      { to: "/fleet/incidents", label: "Incidents" },
    ],
  },
  {
    heading: "People & HR",
    prefix: "/hr",
    items: [
      { to: "/hr/employees", label: "Employees" },
      { to: "/hr/payroll", label: "Payroll" },
      { to: "/hr/vacancies", label: "Vacancies" },
      { to: "/hr/contracts", label: "Contracts" },
      { to: "/hr/appraisals", label: "Appraisals" },
      { to: "/hr/attendance", label: "Attendance" },
      { to: "/hr/leave", label: "Leave & allowances" },
      { to: "/hr/sops", label: "SOPs" },
      { to: "/hr/trainings", label: "Trainings" },
      { to: "/hr/talent-pool", label: "Talent pool" },
    ],
  },
  {
    heading: "Master data",
    prefix: "/master",
    items: [{ to: "/master", label: "Master data" }],
  },
  {
    heading: "Vault",
    prefix: "/vault",
    items: [
      { to: "/vault/documents", label: "Document vault" },
      { to: "/vault/signatures", label: "Signatures" },
      { to: "/vault/verification", label: "Verification" },
      { to: "/vault/compliance-flags", label: "Compliance flags" },
      { to: "/vault/reports", label: "Reports" },
    ],
  },
  {
    heading: "Comms",
    prefix: "/comms",
    items: [{ to: "/comms", label: "Smart Comms" }],
  },
  {
    heading: "Security & Access",
    prefix: "/security",
    items: [
      { to: "/security/users", label: "Users" },
      { to: "/security/roles", label: "Roles" },
      { to: "/security/permissions", label: "Permission matrix" },
      { to: "/security/capabilities", label: "Capabilities" },
      { to: "/security/scopes", label: "Scopes" },
      { to: "/security/field-visibility", label: "Field visibility" },
      { to: "/security/sessions", label: "My sessions" },
      { to: "/security/my-security", label: "My security" },
    ],
  },
  {
    heading: "Governance",
    items: [
      { to: "/audit", label: "Audit ledger" },
      { to: "/notifications", label: "Notifications" },
      { to: "/workflows", label: "Workflows" },
      { to: "/approvals", label: "Approvals" },
    ],
  },
  {
    heading: "Settings & Admin",
    items: [
      { to: "/settings", label: "Settings" },
      { to: "/appearance", label: "Appearance" },
      { to: "/settings/numbering", label: "Numbering schemes" },
      { to: "/settings/catalogue", label: "Catalogue" },
      { to: "/portal/access", label: "Portal access" },
    ],
  },
];

/** Areas surfaced inline in the top bar (in order). The rest live under More. */
const TOPBAR = ["Overview", "Finance", "Warehouse", "Fleet"];

// --- tiny inline icons (stroke inherits currentColor) ----------------------
type IP = React.SVGProps<SVGSVGElement>;
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
const TowerIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 11l9-8 9 8M5 10v10h14V10" />
  </svg>
);
const FinanceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
  </svg>
);
const WarehouseIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 9l9-5 9 5v10l-9 5-9-5z" />
  </svg>
);
const FleetIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M3 7h13l5 5v5h-3" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);
const MoreIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);
const ChevronIcon = (p: IP) => (
  <svg {...sic(p)} width={14} height={14}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const FilesIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 4h6l2 3h8v13H4z" />
  </svg>
);
const SearchIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </svg>
);
const AREA_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  Overview: TowerIcon,
  Finance: FinanceIcon,
  Warehouse: WarehouseIcon,
  Fleet: FleetIcon,
};

/** A top-bar area: a direct link (single item) or a hover/click dropdown. */
function NavArea({
  group,
  active,
  open,
  onToggle,
  onNavigate,
  onHoverOpen,
  onHoverClose,
}: {
  group: NavGroup;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onHoverOpen: () => void;
  onHoverClose: () => void;
}) {
  const Icon = AREA_ICON[group.heading] || MoreIcon;
  const label = group.heading === "Overview" ? "Control Tower" : group.heading;

  // Single-item area (Overview) → direct link, no dropdown. Hovering it should
  // still dismiss any open sibling dropdown.
  if (group.items.length === 1) {
    return (
      <NavLink
        to={group.items[0].to}
        end
        className={cn("lux-navlink", active && "active")}
        onClick={onNavigate}
        onMouseEnter={onHoverClose}
      >
        <Icon />
        <span>{label}</span>
      </NavLink>
    );
  }

  return (
    <div className="relative" data-navarea onMouseEnter={onHoverOpen} onMouseLeave={onHoverClose}>
      <button
        className={cn("lux-navlink", (active || open) && "active")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon />
        <span>{label}</span>
        <ChevronIcon className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          style={{ background: "var(--popover)" }}
          className="absolute left-0 top-[calc(100%+8px)] z-50 min-w-56 animate-fade-in rounded-xl border bg-popover p-2 shadow-l"
        >
          {group.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              role="menuitem"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/** The full grouped menu — rendered inside the More overlay sidebar. */
function SidebarLinks({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav className="flex flex-col gap-5 p-3">
      {NAV.map((g) => (
        <div key={g.heading}>
          <p className="micro px-3 pb-2">{g.heading === "Overview" ? "Overview" : g.heading}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                onClick={onNavigate}
                style={({ isActive }) => (isActive ? { borderLeftColor: "rgb(var(--brand-orange))" } : undefined)}
                className={({ isActive }) =>
                  cn(
                    "rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )
                }
              >
                {it.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// Logo/mark only — the "<name> / Control Tower" text block was removed so the
// Control Tower nav (with its hover menu) can sit right beside the logo and the
// rest of the top bar has room to breathe.
function Brand({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <div className="flex flex-none items-center">
      {logoUrl ? (
        <img src={logoUrl} alt={name} className="h-9 w-auto" />
      ) : (
        <span className="lux-mark" title={name}>{name.charAt(0)}</span>
      )}
    </div>
  );
}

/**
 * Mobile bottom nav (Lovable pattern) — shown only below the md breakpoint,
 * where the inline top-bar areas collapse. Four thumb targets: Control Tower,
 * Operations files, Finance, and Search (opens the ⌘K palette). The full 15-group
 * menu stays reachable via the top-bar hamburger, exactly as in the mock. Active
 * state is by route prefix so any screen inside an area lights its tab.
 */
const BOTTOM_NAV: { to: string; label: string; Icon: (p: IP) => React.JSX.Element; active: (p: string) => boolean }[] = [
  { to: "/", label: "Tower", Icon: TowerIcon, active: (p) => p === "/" },
  { to: "/operations/files", label: "Files", Icon: FilesIcon, active: (p) => p.startsWith("/operations") },
  { to: "/finance/journals", label: "Finance", Icon: FinanceIcon, active: (p) => p.startsWith("/finance") },
];

function BottomNav({ pathname, onSearch }: { pathname: string; onSearch: () => void }) {
  return (
    <nav className="lux-botnav flex md:hidden" aria-label="Primary">
      {BOTTOM_NAV.map(({ to, label, Icon, active }) => (
        <Link key={to} to={to} className={cn("lux-botnav-btn", active(pathname) && "active")}>
          <Icon width={20} height={20} />
          <span>{label}</span>
        </Link>
      ))}
      <button type="button" className="lux-botnav-btn" onClick={onSearch}>
        <SearchIcon width={20} height={20} />
        <span>Search</span>
      </button>
    </nav>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [openArea, setOpenArea] = React.useState<string | null>(null);
  const [env, setEnvState] = React.useState<string>(tokenStore.getEnv());

  // Hover open/close with a grace delay so moving from the button into the
  // menu (across the small gap) doesn't snap it shut.
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAreaNow = React.useCallback((h: string) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpenArea(h);
  }, []);
  const closeAreaDeferred = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenArea(null), 180);
  }, []);
  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Close dropdowns on outside-click and Escape; ⌘K / Ctrl-K toggles the
  // command palette; close everything on navigation.
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest("[data-navarea]")) setOpenArea(null);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setOpenArea(null);
        setSidebarOpen(false);
        setPaletteOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  React.useEffect(() => {
    setOpenArea(null);
    setSidebarOpen(false);
    setPaletteOpen(false);
  }, [location.pathname]);

  function isAreaActive(g: NavGroup): boolean {
    if (g.heading === "Overview") return location.pathname === "/";
    return !!g.prefix && location.pathname.startsWith(g.prefix);
  }

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  // Test/Live switch — SOFT (no reload). Identity is now env-independent
  // (server pins auth/sessions to the live schema), so flipping X-Praxis-Env no
  // longer logs the user out — only *business* data is sandboxed. Persist the
  // header, update state; the `key={env}` on <main> remounts the routed screen
  // so every useEffect re-fetches under the new environment. Access token, auth
  // and scroll of the shell are preserved.
  function switchEnv(next: string) {
    if (next === env) return;
    tokenStore.setEnv(next);
    setEnvState(next);
  }

  const topbarGroups = TOPBAR.map((h) => NAV.find((g) => g.heading === h)!).filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      {/* Top command bar */}
      <header className="lux-topbar relative z-40 flex h-[66px] flex-none items-center gap-3 px-4 md:px-6">
        <button
          className="md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
        <Brand name={brandName} logoUrl={branding.logoUrl} />

        {/* Inline primary nav (desktop) — Control Tower now sits directly beside
            the logo (the brand text block was removed), so it starts tight to the
            mark and the rest of the bar has room to align. */}
        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {topbarGroups.map((g) => (
            <NavArea
              key={g.heading}
              group={g}
              active={isAreaActive(g)}
              open={openArea === g.heading}
              onToggle={() => setOpenArea((cur) => (cur === g.heading ? null : g.heading))}
              onNavigate={() => setOpenArea(null)}
              onHoverOpen={() => openAreaNow(g.heading)}
              onHoverClose={closeAreaDeferred}
            />
          ))}
          <button className="lux-navlink" aria-haspopup="dialog" onClick={() => setSidebarOpen(true)}>
            <MoreIcon />
            <span>More</span>
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-xl border bg-accent/40 px-3 py-2 text-muted-foreground lg:flex"
            title="Search screens (⌘K)"
          >
            <span className="text-xs">Search screens…</span>
            <span className="ml-6 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold">⌘K</span>
          </button>
          <div className="inline-flex items-center rounded-xl border p-0.5 text-xs font-semibold" role="group" aria-label="Data environment">
            <button
              onClick={() => switchEnv("live")}
              aria-pressed={env !== "sandbox"}
              className={cn(
                "rounded-lg px-2.5 py-1.5 transition-colors",
                env !== "sandbox"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              LIVE
            </button>
            <button
              onClick={() => switchEnv("sandbox")}
              aria-pressed={env === "sandbox"}
              className={cn(
                "rounded-lg px-2.5 py-1.5 transition-colors",
                env === "sandbox"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              TEST
            </button>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </header>

      {/* Collapsible overlay sidebar (More / mobile hamburger) — full menu */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="lux-sidebar-in absolute left-0 top-0 flex h-full w-72 flex-col overflow-y-auto border-r bg-sidebar">
            <div className="flex h-[66px] flex-none items-center justify-between border-b px-4">
              <Brand name={brandName} logoUrl={branding.logoUrl} />
              <button onClick={() => setSidebarOpen(false)} aria-label="Close menu">
                ✕
              </button>
            </div>
            <SidebarLinks onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* The single custom scroll container: vertical scrolls, horizontal is
          clipped (pages that need it wrap their own overflow-x-auto region). */}
      {/* Sandbox warning banner (Lovable mock) — only in TEST mode. */}
      {env === "sandbox" && (
        <div className="flex flex-none items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-center text-xs font-medium text-amber-700 dark:text-amber-300">
          <span aria-hidden>⚠</span>
          <span>TEST MODE — you're viewing sandbox data. Changes here don't affect live.</span>
          <button onClick={() => switchEnv("live")} className="ml-1 underline underline-offset-2 hover:no-underline">
            Switch to live
          </button>
        </div>
      )}

      {/* key={env} remounts the routed screen on an env switch so every screen
          re-fetches under the new X-Praxis-Env — the soft-switch mechanism. */}
      <main key={env} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-6 pb-24 md:pb-6">
        <Outlet />
      </main>

      <BottomNav pathname={location.pathname} onSearch={() => setPaletteOpen(true)} />

      <CommandPalette open={paletteOpen} groups={NAV} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
