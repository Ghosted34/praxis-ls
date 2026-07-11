/**
 * Protected app shell: white-label sidebar + top bar + <Outlet/>. Mobile-correct
 * (sidebar becomes a slide-over). Skeletal by intent — the nav is the real
 * scaffold the feature screens hang off.
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
  { heading: "Overview", items: [{ to: "/", label: "Dashboard" }] },
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
    <nav className="flex flex-col gap-6 p-4">
      {NAV.map((g) => (
        <div key={g.heading}>
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60",
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

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block">
        <div className="flex h-16 items-center gap-2 border-b px-5 font-semibold">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="" className="h-7 w-auto" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">
              {brandName.charAt(0)}
            </span>
          )}
          <span className="truncate">{brandName}</span>
        </div>
        <NavLinks />
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r bg-sidebar">
            <div className="flex h-16 items-center justify-between border-b px-5 font-semibold">
              <span className="truncate">{brandName}</span>
              <button onClick={() => setMobileOpen(false)} aria-label="Close">✕</button>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b px-4">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">☰</button>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                env === "sandbox" ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {env === "sandbox" ? "TEST MODE" : "LIVE"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
