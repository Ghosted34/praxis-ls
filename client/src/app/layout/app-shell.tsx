/**
 * Protected app shell.
 *
 * THREE BANDS OF CHROME, EACH DOING ONE JOB:
 *
 *   `.wco`      the title bar. In an installed window this IS the OS title bar
 *               (Window Controls Overlay); everywhere else it is the utility
 *               strip. Logo, search, environment, theme, alerts, account —
 *               with search and environment present at EVERY width (see the
 *               strip's own comment) and theme demoted into the account menu
 *               below `sm` to pay for them.
 *   `<Ribbon>`  navigation and screen commands — the workflow families this
 *               user can see, and the destinations inside the one they are in.
 *   `<IconRail>` a constant strip of shortcuts down the left edge.
 *
 * WHAT THE RIBBON REPLACED, and why this is fewer rows rather than more. The
 * nav row here used to be a menubar of sixteen areas, and every one of those
 * areas is a hub that drew its OWN tab strip inside the page. So a desktop user
 * opening an operations file crossed three bands of navigation before the first
 * row of data. The ribbon's second row IS the hub's tab strip — hoisted into
 * the chrome, drawn from the same definitions (`areas.ts`), and removed from
 * the page (`tabbed-hub.tsx` keeps it below `md`, where there is no ribbon).
 *
 * The ribbon is also PERMISSION-AWARE, which the menubar never was: it renders
 * from `GET /permissions/mine`, so a family whose modules this user cannot read
 * is not there at all — not greyed, not locked, not a 403 waiting to happen.
 *
 * BELOW `md` none of that applies: the bottom bar carries the same families and
 * opens each into a sheet (`mobile-nav.tsx`), and the hamburger drawer survives
 * for the full grouped index.
 */
import * as React from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { CommandPaletteProvider } from "@/app/layout/command-palette-context";
import { NAV, type NavGroup } from "@/app/layout/nav-model";
import {
  AREA_ICON,
  CHILD_ICON,
  AlertIcon,
  ChevronIcon,
  DotIcon,
  DownloadIcon,
  HrIcon,
  LogoutIcon,
  MenuIcon,
  MoreIcon,
  PaletteIcon,
  SearchIcon,
  SecurityIcon,
} from "@/app/layout/nav-icons";
import { Ribbon } from "@/app/layout/ribbon";
import { IconRail } from "@/app/layout/icon-rail";
import { BottomNav } from "@/app/layout/mobile-nav";
import { EnvChip, SwitchToLiveButton } from "@/app/layout/env-switcher";
import { RibbonCommandsProvider } from "@/app/layout/shell-providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TENANT_KEY } from "@/lib/query-client";
import { tokenStore } from "@/lib/token-store";
import { tenant } from "@/lib/api-client";
import { disconnectCommsSocket } from "@/lib/comms-socket";
import { ThemeToggle } from "@/components/theme-toggle";
import { getMode, setMode, resolved } from "@/lib/theme-mode";
import { ClockPunchChip } from "@/components/clock-punch";
import { openInstallUi, isStandalone } from "@/lib/pwa-install";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/command-palette";
import { PraxisDrawer } from "@/components/praxis-drawer";
import { FloatingActions } from "@/components/floating-actions";
import { QuickActionsMenu } from "@/components/quick-actions";
import {
  DropdownMenu,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownRadioGroup,
  DropdownRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  getDensity,
  setDensity,
  isDensity,
  DENSITY_LABEL,
  DENSITY_HINT,
  type Density,
} from "@/lib/density";
import { AppIcon } from "@/components/ui/app-icon";
import { type EffectivePwa } from "@/lib/pwa-config";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PageSkeleton } from "@/components/ui/skeleton";
import { XIcon } from "@/components/ui/icons";
import { ActionErrorBanner } from "@/components/action-error-banner";
import { AccessBanner } from "@/app/layout/access-banner";
import { RouteAccessGate } from "@/app/layout/route-access-gate";
import { useAiEnabled } from "@/components/ai-actions";
import { cn } from "@/lib/cn";

/** The grouped nav, minus AI-only destinations when AI is off for the tenant.
 *  AI Control is a no-op surface without AI provisioned, so it's hidden (and any
 *  group left empty is dropped). */
function useVisibleNav(): NavGroup[] {
  const aiEnabled = useAiEnabled();
  return React.useMemo(() => {
    if (aiEnabled) return NAV;
    return NAV.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.to !== "/ai-control"),
    })).filter((g) => g.items.length > 0);
  }, [aiEnabled]);
}

/**
 * LIVE / TEST, from `sm` up. Lifted out of the shell's markup when the utility
 * cluster moved into the title bar — it is the one control in there whose
 * colours carry meaning (a sandbox session must never be mistaken for a live
 * one), so it is worth being a named component rather than forty lines inline.
 *
 * `--ok` / `--warn` rather than raw emerald/amber: two of the 122 palette
 * bypasses F14 counted were in this exact control, in the shell itself.
 *
 * BELOW `sm` THE CONTROL IS `EnvChip` (env-switcher.tsx), not this. Two labelled
 * cells cost ~100px of a 360px strip, and this component's `hidden` used to mean
 * a phone had no way INTO the sandbox at all while the sandbox banner offered a
 * way out of it. Deliberately still single-tap and unconfirmed: that asymmetry
 * with the phone's confirm-both-ways is argued in env-switcher.tsx's header.
 */
function EnvToggle({
  env,
  onSwitch,
}: {
  env: string;
  onSwitch: (e: "live" | "sandbox") => void;
}) {
  return (
    <div
      className="hidden items-center rounded-md border p-0.5 text-[11px] font-semibold sm:inline-flex"
      role="group"
      aria-label="Data environment"
    >
      <button
        type="button"
        onClick={() => onSwitch("live")}
        aria-pressed={env !== "sandbox"}
        className={cn(
          "rounded-sm px-2 py-1 transition-colors",
          env !== "sandbox"
            ? "bg-[rgb(var(--ok-fill)_/_0.14)] text-[rgb(var(--ok))]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        LIVE
      </button>
      <button
        type="button"
        onClick={() => onSwitch("sandbox")}
        aria-pressed={env === "sandbox"}
        className={cn(
          "rounded-sm px-2 py-1 transition-colors",
          env === "sandbox"
            ? "bg-[rgb(var(--warn-fill)_/_0.16)] text-[rgb(var(--warn))]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        TEST
      </button>
    </div>
  );
}

/**
 * Full-screen interstitial during an env switch.
 *
 * `switchEnv` has already remounted every screen under `key={env}` and TanStack
 * is fetching fresh data under new env-scoped keys, so this overlay is a
 * VISUAL CUE, not a functional gate: without it the header briefly still
 * carries the old env's chrome and the newly-mounted screen paints its
 * skeleton — a fast-but-flickery transition that reads as either the toggle
 * having not worked or the app being confused. Half a second of "Switching…"
 * makes the same operation feel intentional.
 *
 * `role="status"` + `aria-live="polite"` so screen-reader users hear the
 * change instead of watching focus land back on the same nav tree with no
 * announcement of why.
 */
function EnvSwitchOverlay({ to }: { to: "live" | "sandbox" }) {
  const label = to === "sandbox" ? "TEST" : "LIVE";
  const tint = to === "sandbox" ? "warn" : "ok";
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-5 shadow-[var(--shadow-l)]">
        <span
          aria-hidden
          className={cn(
            "inline-block h-6 w-6 animate-spin rounded-full border-2 border-transparent",
            tint === "warn"
              ? "border-t-[rgb(var(--warn))]"
              : "border-t-[rgb(var(--ok))]",
          )}
        />
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">
            Switching to{" "}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-bold",
                tint === "warn"
                  ? "bg-[rgb(var(--warn-fill)_/_0.16)] text-[rgb(var(--warn))]"
                  : "bg-[rgb(var(--ok-fill)_/_0.14)] text-[rgb(var(--ok))]",
              )}
            >
              {label}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Loading fresh data…
          </div>
        </div>
      </div>
    </div>
  );
}

/** Initials from a name or email local-part. */
function initialsOf(nameOrEmail?: string | null): string {
  if (!nameOrEmail) return "?";
  const base = nameOrEmail.includes("@")
    ? nameOrEmail.split("@")[0].replace(/[._-]+/g, " ")
    : nameOrEmail;
  const parts = base.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Unread counts for the messages + notifications badges.
 *
 * PERF S15 (second half). This was a raw `setInterval(load, 60000)` outside the
 * query cache, firing two requests per user per minute forever. The audit's
 * arithmetic: at 1,000 concurrent users that is ~33 req/s of pure badge
 * polling, and because each costs several DB round-trips it works out at
 * roughly 230 round-trips per second for unread counts alone — on a topology
 * with a 12-connection-per-tenant ceiling (S1).
 *
 * Three things change, none of which alter what the badges show:
 *
 *   1. It goes through TanStack Query, so the two requests are DEDUPLICATED
 *      across every component that wants a badge instead of being one timer per
 *      mount.
 *   2. `refetchIntervalInBackground: false` — the browser stops polling when
 *      the tab is not visible. Most of that 33 req/s was tabs nobody was
 *      looking at.
 *   3. `refetchOnWindowFocus` (on by default here) means coming back to the tab
 *      refreshes immediately, so the badge is FRESHER on return than the old
 *      timer made it while costing less in between.
 *
 * Failures (feature off, 403) still resolve to 0 rather than surfacing —
 * `Promise.allSettled` is kept for exactly that reason.
 */
function useUnreadCounts(env: string): {
  messages: number;
  notifications: number;
  reload: () => void;
} {
  const qc = useQueryClient();

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
    Array.isArray(v)
      ? v.reduce(
          (s, r) => s + (Number((r as { unread?: unknown })?.unread) || 0),
          0,
        )
      : num(v);

  // `env` is in the key so flipping LIVE/TEST reads the other environment's
  // counts rather than showing stale ones.
  const key = [TENANT_KEY, "unread-counts", env] as const;

  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [m, n] = await Promise.allSettled([
        tenant("/smartcomm/unread"),
        tenant("/notifications/unread-count"),
      ]);
      return {
        messages: m.status === "fulfilled" ? sumUnread(m.value) : 0,
        notifications: n.status === "fulfilled" ? num(n.value) : 0,
      };
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const reload = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, env]);

  return {
    messages: q.data?.messages ?? 0,
    notifications: q.data?.notifications ?? 0,
    reload,
  };
}

/**
 * Row density, in the account menu (Phase 5, audit F9).
 *
 * WHY HERE AND NOT IN SETTINGS → APPEARANCE. Appearance is the TENANT's
 * white-label editor: it is admin-gated and it PUTs to `/branding`, so a choice
 * made there applies to everyone in the organisation. Density is the opposite —
 * personal, device-shaped, and stored in this browser's localStorage next to the
 * theme. Putting it in Appearance would have meant one admin deciding how dense
 * every dispatcher's screen is, which is precisely the decision the preference
 * exists to devolve.
 *
 * The account menu is where the app already keeps the other display preference
 * the user owns, so this sits with the theme toggle rather than inventing a
 * second place to look.
 */
function DensityChoice() {
  const [density, setLocal] = React.useState<Density>(getDensity);

  return (
    <>
      <DropdownLabel>
        <span className="micro">Row density</span>
      </DropdownLabel>
      <DropdownRadioGroup
        value={density}
        onValueChange={(v) => {
          if (!isDensity(v)) return;
          setDensity(v);
          setLocal(v);
        }}
      >
        {(["compact", "default", "comfortable"] as const).map((d) => (
          <DropdownRadioItem key={d} value={d} hint={DENSITY_HINT[d]}>
            {DENSITY_LABEL[d]}
          </DropdownRadioItem>
        ))}
      </DropdownRadioGroup>
    </>
  );
}

/**
 * Light / dark, in the account menu — the small-screen half of the strip's
 * `ThemeToggle`.
 *
 * WHY IT IS HERE. The toggle is a permanent 36×36 square spent on a preference
 * a user sets roughly once, ever, and below `sm` that square was the width the
 * search button and the environment chip needed. So the toggle is `sm:`-gated
 * and this stands in below it — beside `DensityChoice`, in the same
 * `DropdownRadioGroup` idiom, so "a display preference I own" is one place and
 * one pattern rather than two.
 *
 * NO "SYSTEM" OPTION, and that is not an omission. `getMode()` falls back to
 * "system" and `resolved()` follows the OS, but it is the SILENT default before
 * anyone has chosen — never a state the UI offers, exactly as the `ThemeToggle`
 * comment says. Listing it here would invent a third selectable state the rest
 * of the app does not have, and the first click would then be able to select
 * the state that means "I have not clicked".
 *
 * State stays in `lib/theme-mode` (`getMode` / `setMode` / `resolved`) — this
 * holds only the resolved appearance it is currently drawing, so the radio and
 * the toggle can never disagree about what is stored.
 */
function ThemeChoice() {
  const [mode, setLocal] = React.useState<"light" | "dark">(() =>
    resolved(getMode()),
  );

  return (
    <>
      <DropdownLabel>
        <span className="micro">Theme</span>
      </DropdownLabel>
      <DropdownRadioGroup
        value={mode}
        onValueChange={(v) => {
          if (v !== "light" && v !== "dark") return;
          setMode(v);
          setLocal(v);
        }}
      >
        <DropdownRadioItem value="light">Light</DropdownRadioItem>
        <DropdownRadioItem value="dark">Dark</DropdownRadioItem>
      </DropdownRadioGroup>
    </>
  );
}

/** User avatar + dropdown (role · My HR · My security · theme · density · Sign out). */
function UserMenu({
  user,
  onLogout,
}: {
  user: {
    email?: string;
    display_name?: string;
    full_name?: string;
    avatar_url?: string | null;
    role?: string | null;
  } | null;
  onLogout: () => void;
}) {
  const name = (
    user?.display_name ||
    user?.full_name ||
    (user?.email ? user.email.split("@")[0] : "") ||
    "Account"
  ).replace(/[._-]+/g, " ");
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
            // NAMED EXPLICITLY, because below `sm` it had no name at all: the
            // initials are `aria-hidden` (they are a picture of the name beside
            // them) and that name is `hidden … sm:block`, so a phone got a
            // button announced as "button". That was always wrong; it became
            // load-bearing when the theme preference moved in here for small
            // screens, since this is now the only door to it.
            aria-label={`Account: ${name}`}
            className="flex items-center gap-2 rounded-lg border p-1 pr-2 transition-colors hover:bg-accent/50"
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-8 w-8 rounded-md object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
              >
                {initialsOf(name || email)}
              </span>
            )}
            <span className="hidden text-left leading-tight sm:block">
              <span className="block max-w-[10rem] truncate text-sm font-semibold capitalize text-foreground">
                {name}
              </span>
              <span className="block max-w-[10rem] truncate text-micro text-muted-foreground">
                {role}
              </span>
            </span>
            <ChevronIcon className="hidden shrink-0 sm:block" />
          </button>
        }
      >
        <DropdownLabel>
          <span className="block truncate text-sm font-semibold capitalize text-foreground">
            {name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {role}
          </span>
        </DropdownLabel>
        <DropdownSeparator />
        <DropdownItem to="/my-hr">
          <HrIcon /> My HR
        </DropdownItem>
        <DropdownItem to="/security/my-security">
          <SecurityIcon /> My security
        </DropdownItem>
        {/* Points at the PERSONAL screen, not the tenant editor. This menu is
            the "me" menu — My HR, My security — and every user can reach it,
            but /appearance rewrites the company's brand and needs Settings-edit,
            so most people who clicked this hit a permission wall on save. The
            tenant editor is still one click away under Settings → Appearance,
            where the people who hold that grant look for it. */}
        <DropdownItem to="/my-appearance">
          <PaletteIcon /> My appearance
        </DropdownItem>
        {!isStandalone() && (
          <DropdownItem onSelect={openInstallUi}>
            <DownloadIcon /> Install app
          </DropdownItem>
        )}
        <DropdownSeparator />
        {/* Theme only where the strip's toggle is not. A menu whose contents
            change with the viewport is a small cost; two live doors to one
            preference at the same width is a larger one, because the two would
            have to be kept in step forever and a user who found one would have
            no way to know the other existed. */}
        <div className="sm:hidden">
          <ThemeChoice />
        </div>
        <DensityChoice />
        <DropdownSeparator />
        <DropdownItem destructive onSelect={onLogout}>
          <LogoutIcon /> Sign out
        </DropdownItem>
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
    g.items.some((it) =>
      it.to === "/"
        ? pathname === "/"
        : pathname === it.to || pathname.startsWith(it.to + "/"),
    );
  const childLink = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-2.5 rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm transition-colors",
      isActive
        ? "bg-accent font-semibold text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
                  isActive
                    ? "bg-accent font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
              <ChevronIcon
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  !open && "-rotate-90",
                )}
              />
            </button>
            {open && (
              <div className="mb-1 mt-0.5 flex flex-col gap-0.5 pl-[26px]">
                {g.items.map((it) => {
                  const CIcon = CHILD_ICON[it.to] || DotIcon;
                  return (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.to === "/"}
                      onClick={onNavigate}
                      style={activeBorder}
                      className={childLink}
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
        <span className="lux-mark" title={name}>
          {name.charAt(0)}
        </span>
      )}
    </div>
  );
}

/**
 * The title bar's identity: the square app icon, then the app name as text.
 *
 * WHY NOT THE WORDMARK. `Brand` above renders the tenant's logo — typically a
 * wide lockup with a tagline, which is right for a 288px drawer and wrong for a
 * 44px bar: it has to shrink until the tagline is unreadable and it crowds out
 * everything else on the row. Every native desktop app solves this the same way
 * (WhatsApp, Slack, Teams, VS Code): a small square mark and the app's name in
 * plain text.
 *
 * It also makes the window self-consistent. The icon here is the SAME artwork
 * the operating system shows in the taskbar and on the home screen, and the
 * name is the one the install dialog used — both from Settings › App & PWA, so
 * a tenant configures their installed identity once and the title bar follows.
 * It is the same component the editor's title-bar preview draws with, so that
 * preview now predicts the real bar instead of merely resembling it.
 */
/** The mark's icon size. Published to CSS as `--wco-mark-size` so `.wco-mark`
 *  can centre it on the rail without a second copy of this number. */
const APP_MARK_SIZE = 20;

function AppMark({ cfg }: { cfg: EffectivePwa }) {
  return (
    <div
      className="wco-mark flex min-w-0 flex-none items-center gap-2"
      style={{ "--wco-mark-size": `${APP_MARK_SIZE}px` } as React.CSSProperties}
    >
      {/* `AppIcon`, not a bare <img src={cfg.iconUrl}>. The raw field is the
          UPLOAD, and when a tenant has not uploaded a dedicated app icon it
          resolves to the brand logo — the wide lockup this component exists to
          avoid — which a 20px box would squash into a smear. AppIcon composites
          it the way the API does: contained inside a square, on the configured
          plate, at the configured rounding. So whatever the taskbar shows, this
          shows. */}
      <AppIcon cfg={cfg} size={APP_MARK_SIZE} />
      {/* `truncate` because the name is tenant-supplied and the bar is shared
          with the window controls — a long one must give way rather than push
          the search field off the row. */}
      <span className="truncate text-[13px] font-semibold tracking-tight text-foreground">
        {cfg.name}
      </span>
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  // `pwa` is the resolved installed-app identity (icon, app name, title-bar
  // treatment); `branding` is the in-app token layer. The title bar uses the
  // former, the drawer's wordmark the latter — see AppMark.
  const { branding, pwa } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [env, setEnvState] = React.useState<string>(tokenStore.getEnv());
  // Non-null while an env switch is settling — shows a full-screen overlay so
  // the user sees the transition instead of a flash of the new env's skeleton.
  // Set to the OUTGOING env so the copy reads "Switching to <new>…".
  const [switchingFrom, setSwitchingFrom] = React.useState<string | null>(null);
  // The overlay's dismiss timer, held so it can be cancelled. An uncancelled
  // one fires `setSwitchingFrom` on an unmounted shell — harmless in a browser,
  // but in jsdom the window is gone by then and React throws
  // "window is not defined" from a timer nobody is awaiting, which fails the
  // whole test run as an unhandled error.
  const switchTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
  }, []);
  const unread = useUnreadCounts(env);

  // ⌘K / Ctrl-K toggles the command palette; Escape closes what is open.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setSidebarOpen(false);
        setPaletteOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    setSidebarOpen(false);
    setPaletteOpen(false);
  }, [location.pathname]);

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
  //
  // WHY THE STEPS ARE ORDERED THE WAY THEY ARE — this is the fix for the stale-
  // toggle bug (a user switching LIVE → TEST briefly saw LIVE data until they
  // refreshed the browser). The bug had three sources; each step here addresses
  // one:
  //
  //   1. `tenantKey()` and `resourceKey()` include env now, so a switch produces
  //      a fresh cache key and TanStack can never serve the other env's data
  //      from cache. This is the primary fix — the rest is defence.
  //
  //   2. `qc.cancelQueries()` stops any in-flight LIVE fetch. Without this, a
  //      request that departed before the switch would land after it, and its
  //      response (correctly headed with X-Praxis-Env: live) would still
  //      populate the LIVE-keyed cache — which is fine per se, but wastes a
  //      round-trip on data the user is no longer looking at.
  //
  //   3. The comms websocket carries env in its handshake, not per message —
  //      so a live socket keeps subscribing to the OLD env's channels until it
  //      is torn down. Disconnect here; the next `getCommsSocket()` reconnects
  //      under the new env.
  //
  // The overlay is a brief interstitial (~350 ms, or however long the first
  // batch of new-env fetches takes) so the switch is felt, not a silent
  // repaint. `key={env}` on <main> still remounts the routed screen — that
  // is what actually causes every screen's `useQuery` to be called again, with
  // the new key.
  function switchEnv(next: string) {
    if (next === env) return;
    setSwitchingFrom(env);
    // Cancel anything already flying under the outgoing env — its response is
    // no longer wanted, and we do not want it landing in the cache after the
    // switch. Prefix-match on [TENANT_KEY, prevEnv] catches every tenant query.
    void qc.cancelQueries({ queryKey: [TENANT_KEY, env] });
    // The socket carries env in its auth object, once, at connect time. We
    // have to tear it down for the next getCommsSocket() to reconnect under
    // the new env — otherwise Smart Comms keeps talking to the old schema
    // for the remaining lifetime of the page.
    disconnectCommsSocket();
    tokenStore.setEnv(next);
    setEnvState(next);
    // Give the newly-mounted screen a beat to fire its queries so the overlay
    // does not vanish before the skeleton behind it has a chance to paint.
    // Kept short — this is a transition indicator, not a load screen.
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => {
      switchTimer.current = null;
      setSwitchingFrom(null);
    }, 350);
  }

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
      <RibbonCommandsProvider>
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

          {/*
        ── THE TITLE BAR ──────────────────────────────────────────────────────
        In an installed window this IS the title bar: `display_override:
        ["window-controls-overlay"]` (src/routes/pwa.js) tells the OS to stop
        drawing one and hand the strip to the page, and `.wco` insets this row
        past the caption buttons using env(titlebar-area-*) — which is what
        makes it correct with the controls on the right (Windows) or the left
        (macOS) without a line of platform code.

        Everywhere else — a browser tab, and every mobile browser, none of which
        implement WCO — the env() fallbacks resolve to zero and this is simply
        the app's utility bar. One component, one code path.

        WHAT MOVED HERE, and why it is worth doing. Search, the environment
        toggle, notifications and the account menu used to sit in the 66px nav
        row below. An installed window was therefore spending a whole band of
        chrome on a title it already knew, while the row that carries the
        product's actual navigation fought for width. Moving the utility cluster
        into space the OS was wasting gives the nav row back its full width and
        is the entire point of adopting WCO.

        The strip drags the window (see `.wco` in index.css); every interactive
        child opts out via the `:is(button, a, input…)` rule there, which
        top-shell.test.tsx pins.
      */}
          <div className="wco wco-surface relative z-40 flex flex-none items-center gap-2 px-3">
            <div className="wco-art" aria-hidden />
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <MenuIcon width={18} height={18} />
            </button>
            <AppMark cfg={pwa} />
            {/* The drag handle. An empty flex-1 rather than a padded element: it is
            the only region a user can reliably grab to move the window, so it
            gets whatever width is left rather than a fixed amount. */}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {/*
            ONE SEARCH BUTTON, AT EVERY WIDTH — and it is one button, not two
            that hand off.

            It was `hidden … lg:flex`, i.e. 1024px and up, while `BottomNav`
            carried a Search cell inside `.lux-botnav` at `md:hidden`, i.e.
            below 768px. Between those two numbers NEITHER rendered: every
            tablet in portrait had no touch path to search at all. ⌘K still
            worked, which is precisely why the hole survived — it is invisible
            to anyone testing on a laptop with a keyboard.

            So the icon is unconditional and `lg` reveals the label and the ⌘K
            badge on top of it: progressive disclosure of a single control,
            which cannot develop a gap the way two controls with adjacent
            breakpoints did. From `lg` the button is what it always was, down to
            the badge; `lg:h-auto` gives back the intrinsic height that
            `wco-touch` overrides for the thumb below it.
          */}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search"
                title="Search (⌘K)"
                className="wco-touch flex min-w-[40px] items-center justify-center rounded-lg border bg-accent/40 text-muted-foreground transition-colors hover:text-foreground lg:h-auto lg:min-w-0 lg:justify-start lg:gap-2 lg:px-3 lg:py-1.5"
              >
                <SearchIcon width={16} height={16} />
                <span className="hidden text-xs lg:inline">Search…</span>
                <span className="ml-4 hidden rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold lg:inline">
                  ⌘K
                </span>
              </button>
              {/* Clocking in is a STATE, not a quick action — it lasts a shift, and
              until now the only desktop route to it was one click deep inside
              the quick-actions menu, whose burst icon gives no hint whether a
              shift is running. It sits with the other always-true facts of the
              session (which environment, which account). */}
              <ClockPunchChip />
              <EnvToggle env={env} onSwitch={switchEnv} />
              <EnvChip env={env} onSwitch={switchEnv} />
              {/* `sm:` — 36px is a lot of a 360px strip to hold permanently for a
              preference set once per user, and search and the env chip needed
              it. Below `sm` the same choice lives in the account menu
              (`ThemeChoice`), which is where the other display preference this
              user owns already is. */}
              <span className="hidden sm:inline-flex">
                <ThemeToggle />
              </span>
              <span className="hidden md:inline-flex">
                <QuickActionsMenu badge={unread.messages} />
              </span>
              <NotificationBell
                count={unread.notifications}
                onChange={unread.reload}
              />
              <UserMenu
                user={
                  user as {
                    email?: string;
                    display_name?: string;
                    full_name?: string;
                  } | null
                }
                onLogout={onLogout}
              />
            </div>
          </div>

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
              <div
                role="presentation"
                className="absolute inset-0 animate-fade-in bg-black/40"
                onClick={() => setSidebarOpen(false)}
              />
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
          {/* Sandbox warning banner (Lovable mock) — only in TEST mode.
          Its way out goes through `SwitchToLiveButton`, which asks first. This
          used to call `switchEnv("live")` from the onClick, so a phone had two
          routes between environments and only one of them confirmed — and this
          was the route a thumb could take by accident while reading the banner
          that explains why it matters. */}
          {env === "sandbox" && (
            <div className="flex flex-none items-center justify-center gap-2 border-b border-[rgb(var(--warn-fill)_/_0.35)] bg-[rgb(var(--warn-fill)_/_0.14)] px-4 py-2 text-center text-xs font-medium text-[rgb(var(--warn))]">
              <AlertIcon width={14} height={14} className="shrink-0" />
              <span>
                TEST MODE — you&rsquo;re viewing sandbox data. Changes here
                don&rsquo;t affect live.
              </span>
              <SwitchToLiveButton onSwitch={switchEnv} />
            </div>
          )}

          {/*
        THE BODY: rail beside, ribbon above.

        The rail runs the full height of everything under the title bar rather
        than starting below the ribbon, because it is not part of the ribbon and
        must not read as its sidebar — its contents are constant while the
        ribbon's change with where you are. The ribbon then belongs to the
        content column, which is what makes "these destinations are inside this
        family" a spatial fact rather than a caption.
      */}
          <div className="flex min-h-0 flex-1">
            <IconRail />

            <div className="flex min-w-0 flex-1 flex-col">
              <Ribbon pathname={location.pathname} />

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
                    <RouteAccessGate pathname={location.pathname}>
                      <Outlet />
                    </RouteAccessGate>
                  </React.Suspense>
                </ErrorBoundary>
              </main>
            </div>
          </div>

          {/* `onMenu` is the bar's escape hatch when the permissions read yields no
          families: the drawer is the complete, unfiltered index. It no longer
          takes `onSearch` — the strip's search button renders at every width
          now, so the bottom bar's Search cell was a second control for the same
          palette, and dropping it gives that width back to the families. */}
          <BottomNav onMenu={() => setSidebarOpen(true)} />

          {/* Surfaces row-action failures reported via lib/action-error. Retrofit
          for screens whose handlers had no catch — see
          doc/PERMISSION_SWEEP_BACKLOG.md §C. */}
          <ActionErrorBanner />
          {/* The GRANT half of live permission invalidation. Its counterpart — a
          revocation — never reaches a component: ShellProvider clears the local
          cache and hard-refreshes the moment it sees one. */}
          <AccessBanner />
          <CommandPalette
            open={paletteOpen}
            groups={visibleNav}
            onClose={() => setPaletteOpen(false)}
          />
          <PraxisDrawer />
          <FloatingActions badge={unread.messages + unread.notifications} />
          {/* Env-switch interstitial. Shown while `switchingFrom` is set — i.e. for
          the brief window between the toggle and the newly-mounted screen's
          first paint. `to` is the destination env, mapped back from the
          project's terminology (sandbox=TEST). */}
          {switchingFrom && (
            <EnvSwitchOverlay to={env === "sandbox" ? "sandbox" : "live"} />
          )}
        </div>
      </RibbonCommandsProvider>
    </CommandPaletteProvider>
  );
}
