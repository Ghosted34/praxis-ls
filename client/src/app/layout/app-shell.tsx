/**
 * Protected app shell — Lovable "Control Tower" look on the app's real nav.
 * Glass top command bar + white-label rail (slide-over on mobile) + <Outlet/>.
 */
import * as React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { tokenStore } from "@/lib/token-store";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

type NavItem = { to: string; label: string };
type NavGroup = { heading: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { heading: "Overview", items: [{ to: "/", label: "Control Tower" }] },
  {
    heading: "Finance",
    items: [
      { to: "/finance/chart-of-accounts", label: "Chart of accounts" },
      { to: "/finance/journals", label: "Journals" },
      { to: "/finance/proformas", label: "Proforma & advances" },
      { to: "/finance/invoices", label: "Invoices" },
      { to: "/finance/receivables", label: "Receivables" },
      { to: "/finance/statements", label: "Statements" },
      { to: "/finance/tax", label: "Tax center" },
      { to: "/finance/assets", label: "Assets" },
    ],
  },
  {
    heading: "Security & Access",
    items: [
      { to: "/security/users", label: "Users" },
      { to: "/security/roles", label: "Roles" },
      { to: "/security/permissions", label: "Permission matrix" },
      { to: "/security/capabilities", label: "Capabilities" },
      { to: "/security/scopes", label: "Scopes" },
      { to: "/security/field-visibility", label: "Field visibility" },
      { to: "/security/sessions", label: "My sessions" },
    ],
  },
  {
    heading: "Fleet",
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
    heading: "Warehouse",
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
    heading: "People & HR",
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
    heading: "Governance",
    items: [
      { to: "/audit", label: "Audit ledger" },
      { to: "/notifications", label: "Notifications" },
      { to: "/workflows", label: "Workflows" },
      { to: "/approvals", label: "Approvals" },
      { to: "/appearance", label: "Appearance" },
      { to: "/settings", label: "Settings" },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5 p-3">
      {NAV.map((g) => (
        <div key={g.heading}>
          <p className="micro px-3 pb-2">{g.heading}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                onClick={onNavigate}
                style={({ isActive }) =>
                  isActive ? { borderLeftColor: "rgb(var(--brand-orange))" } : undefined
                }
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

function Brand({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-9 w-auto" />
      ) : (
        <span className="lux-mark">{name.charAt(0)}</span>
      )}
      <div className="leading-tight">
        <div className="font-display text-[17px] tracking-tight">{name}</div>
        <div className="micro mt-0.5">Control Tower</div>
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const env = tokenStore.getEnv();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  // Test/Live switch — persists X-Praxis-Env then reloads so every screen
  // re-fetches under the new environment (separate live/sandbox schemas).
  function toggleEnv() {
    const next = env === "sandbox" ? "live" : "sandbox";
    tokenStore.setEnv(next);
    window.location.reload();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top command bar */}
      <header className="lux-topbar flex h-[66px] flex-none items-center gap-4 px-4 md:px-6">
        <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
          ☰
        </button>
        <Brand name={brandName} logoUrl={branding.logoUrl} />

        {/* Search affordance (Lovable) */}
        <div className="ml-4 hidden items-center gap-2 rounded-xl border bg-accent/40 px-3 py-2 text-muted-foreground lg:flex">
          <span className="text-xs">Search dossiers, invoices, people…</span>
          <span className="ml-6 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold">⌘K</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={toggleEnv}
            title={env === "sandbox" ? "Switch to LIVE" : "Switch to TEST MODE"}
            className={cn("status", env === "sandbox" ? "st-warn" : "st-ok")}
          >
            {env === "sandbox" ? "TEST MODE" : "LIVE"}
          </button>
          <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Desktop rail */}
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r bg-sidebar md:block">
          <NavLinks />
        </aside>

        {/* Mobile slide-over */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <aside className="absolute left-0 top-0 h-full w-72 overflow-y-auto border-r bg-sidebar">
              <div className="flex h-[66px] items-center justify-between border-b px-4">
                <Brand name={brandName} logoUrl={branding.logoUrl} />
                <button onClick={() => setMobileOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
