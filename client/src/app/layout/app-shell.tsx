/**
 * Protected app shell — Lovable "Control Tower" look on the app's real nav.
 *
 * NAVIGATION (audit F9, Phase 3). Twelve of the sixteen top-level areas used to
 * be reachable ONLY through a "More" button that opened a `fixed inset-0` scrim
 * plus a 288px drawer — a phone pattern, on a 2560px screen with several hundred
 * pixels of unused top bar. Desktop users paid two clicks and a full-screen
 * overlay to reach three quarters of the product.
 *
 * The top bar is now a real menubar that widens with the viewport: four areas
 * inline at `md`, five at `lg`, seven at `xl`, ten at `2xl`, and an "All areas"
 * button that opens every one of the sixteen in a single in-place panel — no
 * scrim, no drawer, Escape and arrow keys handled by Radix. The overlay drawer
 * survives for `< md` only, driven by the hamburger, which is where that pattern
 * belongs.
 */
import * as React from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { CommandPaletteProvider } from "@/app/layout/command-palette-context";
import { areaEntries, NAV, TIER_CLASS, TOPBAR, type NavGroup } from "@/app/layout/nav-model";
import {
  AREA_ICON, CHILD_ICON, AlertIcon, ChevronIcon, DotIcon, DownloadIcon, FilesIcon, FinanceIcon,
  GridIcon, HrIcon, LogoutIcon, MenuIcon, MoreIcon, PaletteIcon, SearchIcon, SecurityIcon,
  TowerIcon, type IP,
} from "@/app/layout/nav-icons";
import { tokenStore } from "@/lib/token-store";
import { tenant } from "@/lib/api-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { openInstallUi, isStandalone } from "@/lib/pwa-install";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/command-palette";
import { PraxisCopilot } from "@/components/praxis-copilot";
import { FloatingActions } from "@/components/floating-actions";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PageSkeleton } from "@/components/ui/skeleton";
import { XIcon } from "@/components/ui/icons";
import { ActionErrorBanner } from "@/components/action-error-banner";
import { useAiEnabled } from "@/components/ai-actions";
import { cn } from "@/lib/cn";

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
  const name = (user?.display_name || user?.full_name || (user?.email ? user.email.split("@")[0] : "") || "Account").replace(/[._-]+/g, " ");
  const email = user?.email || "";
  const role = user?.role || "Member";

  // Was a hand-rolled role="menu" (audit F13). It declared menu semantics —
  // which promise arrow keys, Home/End, type-ahead and a managed focus cycle,
  // and which STRIP the link role from every <Link role="menuitem"> — while
  // app-shell.tsx contained zero onKeyDown handlers. That is worse than plain
  // links: the markup told a screen-reader user to use the arrow keys, the
  // arrow keys did nothing, and the link affordance was gone. Radix implements
  // the pattern it was claiming.
  return (
    <div data-navarea>
      <DropdownMenu
        trigger={
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border p-1 pr-2 transition-colors hover:bg-accent/50"
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-md object-cover" />
            ) : (
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                {initialsOf(name || email)}
              </span>
            )}
            <span className="hidden text-left leading-tight sm:block">
              <span className="block max-w-[10rem] truncate text-sm font-semibold capitalize text-foreground">{name}</span>
              <span className="block max-w-[10rem] truncate text-micro text-muted-foreground">{role}</span>
            </span>
            <ChevronIcon className="hidden shrink-0 sm:block" />
          </button>
        }
      >
        <DropdownLabel>
          <span className="block truncate text-sm font-semibold capitalize text-foreground">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{role}</span>
        </DropdownLabel>
        <DropdownSeparator />
        <DropdownItem to="/my-hr">
          <HrIcon /> My HR
        </DropdownItem>
        <DropdownItem to="/security/my-security">
          <SecurityIcon /> My security
        </DropdownItem>
        <DropdownItem to="/appearance">
          <PaletteIcon /> Appearance
        </DropdownItem>
        {!isStandalone() && (
          <DropdownItem onSelect={openInstallUi}>
            <DownloadIcon /> Install app
          </DropdownItem>
        )}
        <DropdownSeparator />
        <DropdownItem destructive onSelect={onLogout}>
          <LogoutIcon /> Sign out
        </DropdownItem>
      </DropdownMenu>
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
  className,
}: {
  group: NavGroup;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onHoverOpen: () => void;
  onHoverClose: () => void;
  /** Which viewport tier reveals this area — see TOPBAR. */
  className?: string;
}) {
  const Icon = AREA_ICON[group.heading] || MoreIcon;
  const label = group.heading;

  // Single-item area → direct link, no dropdown. Hovering it should still
  // dismiss any open sibling dropdown.
  if (group.items.length === 1) {
    return (
      <NavLink
        to={group.items[0].to}
        end
        className={cn("lux-navlink", className, active && "active")}
        onClick={onNavigate}
        onMouseEnter={onHoverClose}
      >
        <Icon />
        <span>{label}</span>
      </NavLink>
    );
  }

  // Second hand-rolled role="menu" (audit F13). Same defect as UserMenu: menu
  // semantics declared with zero keyboard handling, and NavLink's link role
  // stripped by role="menuitem". `modal={false}` keeps the rest of the top bar
  // interactive so sliding the pointer to a sibling area still works.
  return (
    // Pointer-only affordance: hover opens the menu for a mouse, and the Radix
    // trigger inside is what a keyboard uses. Nothing here is reachable — or
    // needs to be — by keyboard, so the wrapper is presentational.
    <div data-navarea role="presentation" className={className} onMouseEnter={onHoverOpen} onMouseLeave={onHoverClose}>
      <DropdownMenu
        align="start"
        modal={false}
        open={open}
        onOpenChange={(next) => next !== open && onToggle()}
        trigger={
          <button type="button" className={cn("lux-navlink", (active || open) && "active")}>
            <Icon />
            <span>{label}</span>
            <ChevronIcon className={cn("transition-transform", open && "rotate-180")} />
          </button>
        }
      >
        {group.items.map((it) => {
          const CIcon = CHILD_ICON[it.to] || DotIcon;
          return (
            <DropdownItem key={it.to} to={it.to}>
              <CIcon />
              <span>{it.label}</span>
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </div>
  );
}

/**
 * "All areas" — every destination in the product, in one in-place panel.
 *
 * This is what replaces the desktop half of the More drawer (F9). It is a real
 * menu button: Radix owns the arrow keys, Home/End, type-ahead, Escape and the
 * focus cycle, and it closes on outside click. Nothing is scrimmed, so the page
 * behind stays readable while you decide — which is most of the difference
 * between an index and an interruption.
 *
 * Flattened deliberately. `Overview` is a grouping, not a destination, so its
 * four screens appear as themselves; the other fifteen areas are hubs and
 * appear once each. Nineteen entries, every one a link.
 */
function AllAreasMenu() {
  const nav = useVisibleNav();
  const entries = areaEntries(nav).map((e) => ({
    ...e,
    Icon: AREA_ICON[e.label] || CHILD_ICON[e.to] || DotIcon,
  }));

  return (
    // `data-navarea` keeps the shell's outside-click handler from treating a
    // click inside this menu as "close the open area dropdown".
    <div data-navarea>
      <DropdownMenu
        align="start"
        // The panel is a grid of links, so Radix's default min-width would
        // squeeze it; this sizes to the viewport and never overflows it.
        className="grid w-[min(44rem,calc(100vw-2rem))] grid-cols-2 gap-0.5 sm:grid-cols-3"
        trigger={
          <button type="button" className="lux-navlink">
            <GridIcon />
            <span>All areas</span>
            <ChevronIcon />
          </button>
        }
      >
        {entries.map(({ to, label, Icon }) => (
          <DropdownItem key={to} to={to}>
            <Icon />
            <span className="truncate">{label}</span>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </div>
  );
}

/** The full grouped menu — rendered inside the mobile overlay sidebar. Every
 *  group carries its area icon. Single-screen areas (now hubs) are a single
 *  link; multi-item areas (Overview) are a collapsible section with a chevron. */
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

  const topbarAreas = TOPBAR.map((t) => ({ ...t, group: NAV.find((g) => g.heading === t.heading) })).filter(
    (t): t is typeof t & { group: NavGroup } => !!t.group,
  );
  const visibleNav = useVisibleNav();

  // Handed to screens through context so a component can open ⌘K without
  // synthesising a keyboard event at `document` — see command-palette-context.
  const paletteApi = React.useMemo(
    () => ({
      open: () => setPaletteOpen(true),
      close: () => setPaletteOpen(false),
      toggle: () => setPaletteOpen((o) => !o),
    }),
    [],
  );

  return (
    <CommandPaletteProvider value={paletteApi}>
    <div className="flex h-full flex-col">
      {/*
        Skip link (audit F13, WCAG 2.4.1). With 12 of 16 areas behind the More
        drawer, a keyboard user previously tabbed the entire header on every
        navigation before reaching content. Visually hidden until focused.
      */}
      <a
        href="#main-content"
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-[var(--shadow-l)] focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      {/* Top command bar */}
      <header className="lux-topbar relative z-40 flex h-[66px] flex-none items-center gap-3 px-4 md:px-6">
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <MenuIcon width={20} height={20} />
        </button>
        <Brand name={brandName} logoUrl={branding.logoUrl} />

        {/* Inline primary nav (desktop) — Control Tower now sits directly beside
            the logo (the brand text block was removed), so it starts tight to the
            mark and the rest of the bar has room to align. */}
        <nav className="ml-2 hidden min-w-0 items-center gap-0.5 md:flex" aria-label="Areas">
          {topbarAreas.map(({ group, from }) => (
            <NavArea
              key={group.heading}
              group={group}
              className={TIER_CLASS[from]}
              active={isAreaActive(group)}
              open={openArea === group.heading}
              onToggle={() => setOpenArea((cur) => (cur === group.heading ? null : group.heading))}
              onNavigate={() => setOpenArea(null)}
              onHoverOpen={() => openAreaNow(group.heading)}
              onHoverClose={closeAreaDeferred}
            />
          ))}
          <AllAreasMenu />
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
          {/* Raw `emerald-500` / `amber-500` here were two of the 122 palette
              bypasses F14 counted, in the shell itself. `--ok` / `--warn` are
              the same decision in tokens, so they follow the AA retune and a
              tenant's dark theme rather than Tailwind's defaults. */}
          <div className="hidden items-center rounded-md border p-0.5 text-xs font-semibold sm:inline-flex" role="group" aria-label="Data environment">
            <button
              type="button"
              onClick={() => switchEnv("live")}
              aria-pressed={env !== "sandbox"}
              className={cn(
                "rounded-sm px-2.5 py-1.5 transition-colors",
                env !== "sandbox"
                  ? "bg-[rgb(var(--ok-fill)_/_0.14)] text-[rgb(var(--ok))]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              LIVE
            </button>
            <button
              type="button"
              onClick={() => switchEnv("sandbox")}
              aria-pressed={env === "sandbox"}
              className={cn(
                "rounded-sm px-2.5 py-1.5 transition-colors",
                env === "sandbox"
                  ? "bg-[rgb(var(--warn-fill)_/_0.16)] text-[rgb(var(--warn))]"
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

      {/*
        Mobile overlay sidebar — hamburger only, and `md:hidden` so it cannot
        appear on a desktop viewport even if the state is somehow set (F9: this
        drawer used to be the ONLY route to twelve of sixteen areas at every
        width). Desktop reaches everything through the menubar above.
      */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Scrim. Click-to-dismiss is a pointer convenience; the drawer has a
              real labelled close button and the shell closes it on Escape, so
              there is no keyboard-only path through this element. */}
          <div role="presentation" className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="lux-sidebar-in absolute left-0 top-0 flex h-full w-72 flex-col overflow-y-auto border-r bg-sidebar">
            <div className="flex h-[66px] flex-none items-center justify-between border-b px-4">
              <Brand name={brandName} logoUrl={branding.logoUrl} />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close menu"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <XIcon width={18} height={18} />
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
        <div className="flex flex-none items-center justify-center gap-2 border-b border-[rgb(var(--warn-fill)_/_0.35)] bg-[rgb(var(--warn-fill)_/_0.14)] px-4 py-2 text-center text-xs font-medium text-[rgb(var(--warn))]">
          <AlertIcon width={14} height={14} className="shrink-0" />
          <span>TEST MODE — you&rsquo;re viewing sandbox data. Changes here don&rsquo;t affect live.</span>
          <button type="button" onClick={() => switchEnv("live")} className="ml-1 underline underline-offset-2 hover:no-underline">
            Switch to live
          </button>
        </div>
      )}

      {/* key={env} remounts the routed screen on an env switch so every screen
          re-fetches under the new X-Praxis-Env — the soft-switch mechanism. */}
      {/*
        Padding scales with the viewport now (was a flat p-6 at every width).
        Width itself is NOT capped here — each screen picks a deliberate column
        width via <PageContainer> / pageShell (audit F3), so the shell stays out
        of that decision and a full-bleed screen stays possible.
      */}
      <main
        id="main-content"
        tabIndex={-1}
        key={env}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 focus:outline-none md:p-6 md:pb-6 2xl:px-8"
      >
        {/* Per-route boundary, keyed on the path so navigating away from a
            crashed screen clears the error rather than stranding the user on it.
            The root boundary in main.tsx is the backstop; this one keeps the
            shell, the nav and the copilot alive when a single screen throws. */}
        <ErrorBoundary key={location.pathname} name="This screen">
          {/* Screens are lazy (app.tsx), so the routed element can suspend while
              its chunk downloads. The boundary sits HERE rather than around the
              whole app so the nav, topbar and copilot stay painted and only the
              content column shows the skeleton. Inside the ErrorBoundary so a
              chunk that fails to load — a stale service worker pointing at a
              filename a deploy removed — surfaces as the screen error, not a
              silent dead route. */}
          <React.Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </React.Suspense>
        </ErrorBoundary>
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
    </CommandPaletteProvider>
  );
}
