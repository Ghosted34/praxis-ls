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
import { tenant } from "@/lib/api-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { openInstallUi, isStandalone } from "@/lib/pwa-install";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/command-palette";
import { PraxisCopilot } from "@/components/praxis-copilot";
import { FloatingActions } from "@/components/floating-actions";
import { ActionErrorBanner } from "@/components/action-error-banner";
import { useAiEnabled } from "@/components/ai-actions";
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
      { to: "/support", label: "Support & feedback" },
      { to: "/godmode", label: "God mode" },
    ],
  },
  {
    heading: "Commercial",
    prefix: "/commercial",
    items: [{ to: "/commercial", label: "Commercial" }],
  },
  {
    heading: "Sales & CRM",
    prefix: "/sales",
    items: [{ to: "/sales", label: "Sales & CRM" }],
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
      { to: "/finance", label: "Finance" },
    ],
  },
  {
    heading: "Warehouse",
    prefix: "/wms",
    items: [
      { to: "/wms", label: "Warehouse" },
    ],
  },
  {
    heading: "Fleet",
    prefix: "/fleet",
    items: [
      { to: "/fleet", label: "Fleet" },
    ],
  },
  {
    heading: "People & HR",
    prefix: "/hr",
    items: [{ to: "/hr", label: "People & HR" }],
  },
  {
    heading: "Master data",
    prefix: "/master",
    items: [{ to: "/master", label: "Master data" }],
  },
  {
    heading: "Vault",
    prefix: "/vault",
    items: [{ to: "/vault", label: "Vault & compliance" }],
  },
  {
    heading: "Comms",
    prefix: "/comms",
    items: [{ to: "/comms", label: "Smart Comms" }],
  },
  {
    heading: "Security & Access",
    prefix: "/security",
    items: [{ to: "/security", label: "Security & access" }],
  },
  {
    heading: "Governance",
    prefix: "/governance",
    items: [{ to: "/governance", label: "Governance" }],
  },
  {
    heading: "Settings & Admin",
    prefix: "/settings",
    items: [{ to: "/settings", label: "Settings & admin" }],
  },
];

/** The grouped nav, minus AI-only destinations when AI is off for the tenant.
 *  AI Control is a no-op surface without AI provisioned, so it's hidden (and any
 *  group left empty is dropped). */
function useVisibleNav(): NavGroup[] {
  const aiEnabled = useAiEnabled();
  return React.useMemo(() => {
    if (aiEnabled) return NAV;
    return NAV
      .map((g) => ({ ...g, items: g.items.filter((it) => it.to !== "/ai-control") }))
      .filter((g) => g.items.length > 0);
  }, [aiEnabled]);
}

/** Areas surfaced inline in the top bar (in order). The rest live under More. */
const TOPBAR = ["Overview", "Operations", "Fleet", "Finance"];

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
const OperationsIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 5h6l2 3h8v11H4z" />
  </svg>
);
const CommercialIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const SalesIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="8" cy="9" r="2.5" />
    <path d="M3.5 19a4.5 4.5 0 0 1 9 0" />
    <circle cx="16.5" cy="9" r="2.5" />
    <path d="M14 19a4.5 4.5 0 0 1 6.5-4" />
  </svg>
);
const ProcurementIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
    <path d="M3 4h2l2.4 12h10L20 8H6" />
  </svg>
);
const CostingIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2" />
  </svg>
);
const HrIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);
const MasterIcon = (p: IP) => (
  <svg {...sic(p)}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3 3 7 3s7-1.3 7-3v-6" />
  </svg>
);
const VaultIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
const CommsIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M4 5h16v11H8l-4 3z" />
  </svg>
);
const SecurityIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
  </svg>
);
const GovernanceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M10 5h9M10 12h9M10 19h9" />
    <path d="M4 5l1.4 1.4L8 4M4 12l1.4 1.4L8 11M4 19l1.4 1.4L8 18" />
  </svg>
);
const SettingsIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M4.2 7l2.2 1.3M17.6 15.7 19.8 17M4.2 17l2.2-1.3M17.6 8.3 19.8 7" />
  </svg>
);
const PaletteIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1" />
    <circle cx="15.5" cy="10" r="1" />
    <circle cx="12" cy="15.5" r="1" />
  </svg>
);
const DownloadIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
  </svg>
);
const LogoutIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </svg>
);
const AREA_ICON: Record<string, (p: IP) => React.JSX.Element> = {
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
const WorkspaceIcon = (p: IP) => (
  <svg {...sic(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </svg>
);
const SupportIcon = (p: IP) => (
  <svg {...sic(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3 2.4c-.6.2-1 .8-1 1.6" />
    <path d="M12 17h.01" />
  </svg>
);
const GodModeIcon = (p: IP) => (
  <svg {...sic(p)}>
    <path d="M13 3 4 14h6l-1 7 9-11h-6z" />
  </svg>
);
const DotIcon = (p: IP) => (
  <svg {...sic(p)} width={14} height={14}>
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);
/** Icon per Overview child, keyed by route. Falls back to a small dot. */
const CHILD_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  "/": TowerIcon,
  "/workspace": WorkspaceIcon,
  "/support": SupportIcon,
  "/godmode": GodModeIcon,
};

/** Initials from a name or email local-part. */
function initialsOf(nameOrEmail?: string | null): string {
  if (!nameOrEmail) return "?";
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0].replace(/[._-]+/g, " ") : nameOrEmail;
  const parts = base.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Unread counts for the messages + notifications badges. Polls gently and
 *  refetches when the data environment flips. Failures (feature off, 403) → 0. */
function useUnreadCounts(env: string): { messages: number; notifications: number; reload: () => void } {
  const [counts, setCounts] = React.useState({ messages: 0, notifications: 0 });
  const [tick, setTick] = React.useState(0);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  React.useEffect(() => {
    let live = true;
    const num = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const n = o.count ?? o.unread ?? o.total ?? o.n;
        return typeof n === "number" ? n : 0;
      }
      return 0;
    };
    // /smartcomm/unread returns per-channel rows [{group_id, unread}] → sum them;
    // /notifications/unread-count returns { unread: N }.
    const sumUnread = (v: unknown): number =>
      Array.isArray(v) ? v.reduce((s, r) => s + (Number((r as { unread?: unknown })?.unread) || 0), 0) : num(v);
    async function load() {
      const [m, n] = await Promise.allSettled([tenant("/smartcomm/unread"), tenant("/notifications/unread-count")]);
      if (!live) return;
      setCounts({
        messages: m.status === "fulfilled" ? sumUnread(m.value) : 0,
        notifications: n.status === "fulfilled" ? num(n.value) : 0,
      });
    }
    load();
    const id = setInterval(load, 60000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [env, tick]);
  return { ...counts, reload };
}

/** User avatar + dropdown (role · My HR · My security · Sign out). */
function UserMenu({ user, onLogout }: { user: { email?: string; display_name?: string; full_name?: string; avatar_url?: string | null; role?: string | null } | null; onLogout: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const name = (user?.display_name || user?.full_name || (user?.email ? user.email.split("@")[0] : "") || "Account").replace(/[._-]+/g, " ");
  const email = user?.email || "";
  const role = user?.role || "Member";

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div className="relative" ref={ref} data-navarea>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border p-1 pr-2 transition-colors hover:bg-accent/50"
      >
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt={name} className="h-8 w-8 rounded-lg object-cover" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            {initialsOf(name || email)}
          </span>
        )}
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-semibold capitalize text-foreground">{name}</span>
          <span className="block max-w-[10rem] truncate text-[11px] text-muted-foreground">{role}</span>
        </span>
        <ChevronIcon className={cn("hidden transition-transform sm:block", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          style={{ background: "var(--popover)" }}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 animate-fade-in rounded-xl border bg-popover p-2 shadow-l"
        >
          <div className="border-b px-3 pb-2 pt-1">
            <div className="truncate text-sm font-semibold capitalize">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{role}</div>
          </div>
          <Link to="/my-hr" role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <HrIcon /> My HR
          </Link>
          <Link to="/security/my-security" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <SecurityIcon /> My security
          </Link>
          <Link to="/appearance" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <PaletteIcon /> Appearance
          </Link>
          {!isStandalone() && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openInstallUi();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <DownloadIcon /> Install app
            </button>
          )}
          <button role="menuitem" onClick={onLogout} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-[rgb(var(--bad))] transition-colors hover:bg-accent/60">
            <LogoutIcon /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

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
  const label = group.heading;

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
          {group.items.map((it) => {
            const CIcon = CHILD_ICON[it.to] || DotIcon;
            return (
              <NavLink
                key={it.to}
                to={it.to}
                role="menuitem"
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )
                }
              >
                <CIcon />
                <span>{it.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The full grouped menu — rendered inside the More overlay sidebar. Every group
 *  carries its area icon. Single-screen areas (now hubs) are a single link;
 *  multi-item areas (Overview) are a collapsible section with a chevron. */
function SidebarLinks({ onNavigate }: { onNavigate: () => void }) {
  const nav = useVisibleNav();
  const { pathname } = useLocation();
  // Route-driven expansion: a multi-item section is open only while you're on one
  // of its screens, and snaps shut the moment you navigate away. `manual` lets you
  // peek from elsewhere, but it's cleared on every navigation so it can't stick open.
  const [manual, setManual] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setManual({}), [pathname]);
  const inGroup = (g: NavGroup) =>
    g.items.some((it) => (it.to === "/" ? pathname === "/" : pathname === it.to || pathname.startsWith(it.to + "/")));
  const childLink = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-2.5 rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm transition-colors",
      isActive ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
    );
  const activeBorder = ({ isActive }: { isActive: boolean }) =>
    isActive ? { borderLeftColor: "rgb(var(--brand-orange))" } : undefined;

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {nav.map((g) => {
        const Icon = AREA_ICON[g.heading] || MoreIcon;

        // Single-screen areas (hubs) → one icon+label link.
        if (g.items.length === 1) {
          const it = g.items[0];
          return (
            <NavLink
              key={g.heading}
              to={it.to}
              end={it.to === "/"}
              onClick={onNavigate}
              style={activeBorder}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              <Icon />
              <span>{g.heading}</span>
            </NavLink>
          );
        }

        // Multi-item area (Overview) → collapsible section. Open while you're on
        // one of its screens (route-driven), collapsed everywhere else.
        const open = inGroup(g) || !!manual[g.heading];
        return (
          <div key={g.heading}>
            <button
              type="button"
              onClick={() => setManual((m) => ({ ...m, [g.heading]: !open }))}
              aria-expanded={open}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Icon />
              <span className="flex-1 text-left">{g.heading}</span>
              <ChevronIcon className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
            </button>
            {open && (
              <div className="mb-1 mt-0.5 flex flex-col gap-0.5 pl-[26px]">
                {g.items.map((it) => {
                  const CIcon = CHILD_ICON[it.to] || DotIcon;
                  return (
                    <NavLink key={it.to} to={it.to} end={it.to === "/"} onClick={onNavigate} style={activeBorder} className={childLink}>
                      <CIcon />
                      <span>{it.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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
  { to: "/finance", label: "Finance", Icon: FinanceIcon, active: (p) => p.startsWith("/finance") },
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
  const unread = useUnreadCounts(env);

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
  const visibleNav = useVisibleNav();

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
            title="Search (⌘K)"
          >
            <span className="text-xs">Search…</span>
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
          <ThemeToggle />
          {/* Messages lives on the Smart Comms floating pin, so it's intentionally
              not duplicated here — only Notifications stays in the top bar. */}
          <NotificationBell count={unread.notifications} onChange={unread.reload} />
          <UserMenu user={user as { email?: string; display_name?: string; full_name?: string } | null} onLogout={onLogout} />
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

      {/* Surfaces row-action failures reported via lib/action-error. Retrofit
          for screens whose handlers had no catch — see
          doc/PERMISSION_SWEEP_BACKLOG.md §C. */}
      <ActionErrorBanner />
      <CommandPalette open={paletteOpen} groups={visibleNav} onClose={() => setPaletteOpen(false)} />
      <PraxisCopilot />
      <FloatingActions badge={unread.messages + unread.notifications} />
    </div>
  );
}
