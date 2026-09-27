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
import { useTranslation } from "react-i18next";
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
import { EnvChip, EnvSwitchOverlay, EnvToggle, SwitchToLiveButton } from "@/app/layout/env-switcher";
import type { Env } from "@/app/layout/env";
import { RibbonCommandsProvider } from "@/app/layout/shell-providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TENANT_KEY } from "@/lib/query-client";
import { useToast } from "@/components/ui/toast";
import { useLiveNotifications } from "@/lib/use-live-notifications";
import { playOnce, tierFor } from "@/lib/notif-sound";
import { applyTabBadge } from "@/lib/tab-badge";
import { tokenStore } from "@/lib/token-store";
import { tenant } from "@/lib/api-client";
import { disconnectCommsSocket } from "@/lib/comms-socket";
import { setAppBadge } from "@/lib/app-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { navT } from "@/lib/i18n";
import { getMode, setMode, resolved } from "@/lib/theme-mode";
import { ClockPunchChip } from "@/components/clock-punch";
import { openInstallUi, isStandalone } from "@/lib/pwa-install";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/command-palette";
import { PraxisDrawer } from "@/components/praxis-drawer";
import { FloatingActions } from "@/components/floating-actions";
import { GlobalRaiseTicket } from "@/features/support/global-raise-ticket";
import { SignOutDialog } from "@/app/layout/sign-out-dialog";
import { forgetDeviceAccount } from "@/lib/device-account";
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
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { LockIcon, XIcon } from "@/components/ui/icons";
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

  // Robust even when the two unread shapes have been swapped or one endpoint
  // grows a second field: `/smartcomm/unread` is an array today but an object
  // with `count` would still resolve; `/notifications/unread-count` is an
  // object today but an array would still be summed. That is the "schema
  // mismatch" the reporter saw — the FAB showed 43 (the summed total) while
  // Messages showed 0 because one of the two resolves silently ate the shape.
  const num = (v: unknown): number => {
    if (typeof v === "number") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const n =
        o.count ??
        o.unread ??
        o.unread_count ??
        o.unreadCount ??
        o.total ??
        o.n;
      if (typeof n === "number") return n;
      // The server nests the count under `data` when the fetch layer did not
      // unwrap it (envelope vs plain), or under a differently-named field.
      if (typeof o.data === "number") return o.data as number;
      if (o.data && typeof o.data === "object") return num(o.data);
    }
    return 0;
  };
  // /smartcomm/unread returns per-channel rows [{group_id, unread}] → sum them;
  // /notifications/unread-count returns { unread: N }. Both helpers tolerate the
  // other shape so a future backend rename cannot silently zero a badge.
  const sumUnread = (v: unknown): number => {
    if (Array.isArray(v)) {
      return v.reduce((s, r) => {
        if (typeof r === "number") return s + r;
        if (r && typeof r === "object") {
          const o = r as Record<string, unknown>;
          const n =
            o.unread ?? o.unread_count ?? o.unreadCount ?? o.count ?? o.total ?? o.n;
          return s + (Number(n) || 0);
        }
        return s;
      }, 0);
    }
    // Not an array — might already be a counted object or a bare number, or
    // even an envelope `{ data: [...] }` if unwrapping changes.
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.data)) return sumUnread(o.data);
    }
    return num(v);
  };

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

  const messages = q.data?.messages ?? 0;
  const notifications = q.data?.notifications ?? 0;

  /* The number on the installed app's icon follows the same count the bell
     shows. This is the half of the badge the PAGE owns: whenever the user reads
     something the count drops here, so the home-screen icon has to drop with
     it. The other half — advancing the badge when a push lands on a closed app
     — belongs to the service worker (public/push-handler.js). Without this one,
     a user who cleared their notifications on a laptop would come back to a
     phone icon still claiming four. */
  React.useEffect(() => {
    if (q.isSuccess) setAppBadge(messages + notifications);
  }, [q.isSuccess, messages, notifications]);

  return { messages, notifications, reload };
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
  const [open, setOpen] = React.useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/60"
      >
        <span className="micro font-semibold tracking-wide text-muted-foreground">
          Row density
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium normal-case text-foreground">
            {DENSITY_LABEL[density]}
          </span>
          <ChevronIcon
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="mt-1 rounded-md border bg-card/50 p-1">
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
        </div>
      )}
    </div>
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
  const [open, setOpen] = React.useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/60"
      >
        <span className="micro font-semibold tracking-wide text-muted-foreground">
          Theme
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium capitalize text-foreground">
            {mode}
          </span>
          <ChevronIcon
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="mt-1 rounded-md border bg-card/50 p-1">
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
        </div>
      )}
    </div>
  );
}

/** User avatar + dropdown (role · My HR · My security · theme · density · Lock · Sign out). */
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
  const { t } = useTranslation();
  const { lockNow } = useAuth();
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
        className="w-[calc(100vw-16px)] max-w-[20rem] sm:max-w-[22rem] max-h-[85vh] overflow-y-auto"
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
          <HrIcon /> {t("shell.myHr")}
        </DropdownItem>
        <DropdownItem to="/security/my-security">
          <SecurityIcon /> {t("shell.mySecurity")}
        </DropdownItem>
        {/* Points at the PERSONAL screen, not the tenant editor. This menu is
            the "me" menu — My HR, My security — and every user can reach it,
            but /appearance rewrites the company's brand and needs Settings-edit,
            so most people who clicked this hit a permission wall on save. The
            tenant editor is still one click away under Settings → Appearance,
            where the people who hold that grant look for it. */}
        <DropdownItem to="/my-appearance">
          <PaletteIcon /> {t("shell.myAppearance")}
        </DropdownItem>
        {!isStandalone() && (
          <DropdownItem onSelect={openInstallUi}>
            <DownloadIcon /> {t("shell.installApp")}
          </DropdownItem>
        )}
        <DropdownSeparator />
        {/* Theme + density are collapsible so the menu stays a scannable list
            on a phone. Theme is still sm:hidden — the header's ThemeToggle is
            the desktop door, so showing both at sm+ would be two live toggles
            for one preference that must stay in sync. Density is the user's
            personal row-height preference and lives here at every width. */}
        <div className="sm:hidden">
          <ThemeChoice />
        </div>
        <DensityChoice />
        <DropdownSeparator />
        {/* Stepping away from the desk: lock now rather than wait for the
            two-hour lock. Ends the session server-side; the app stays put
            behind the lock screen and the next unlock is one fingerprint. */}
        <DropdownItem onSelect={() => void lockNow()}>
          <LockIcon width={16} height={16} /> {t("shell.lockScreen")}
        </DropdownItem>
        <div className="p-1 pt-2">
          <DropdownItem
            onSelect={onLogout}
            className="justify-center rounded-md bg-primary py-2.5 font-semibold !text-primary-foreground shadow-sm hover:!bg-primary/90 data-[highlighted]:!bg-primary/90 data-[highlighted]:!text-primary-foreground"
          >
            <LogoutIcon /> {t("shell.signOut")}
          </DropdownItem>
        </div>
      </DropdownMenu>
    </div>
  );
}

/** The full grouped menu — rendered inside the mobile overlay sidebar. Every
 *  group carries its area icon. Single-screen areas (now hubs) are a single
 *  link; multi-item areas (Overview) are a collapsible section with a chevron. */
function SidebarLinks({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
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
              key={navT(t, g.heading)}
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
              <span>{navT(t, g.heading)}</span>
            </NavLink>
          );
        }

        // Multi-item area (Overview) → collapsible section. Open while you're on
        // one of its screens (route-driven), collapsed everywhere else.
        const open = inGroup(g) || !!manual[g.heading];
        return (
          <div key={navT(t, g.heading)}>
            <button
              type="button"
              onClick={() => setManual((m) => ({ ...m, [g.heading]: !open }))}
              aria-expanded={open}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Icon />
              <span className="flex-1 text-left">{navT(t, g.heading)}</span>
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
          the search field off the row.

          `sm:` — IT STANDS DOWN ON A PHONE, and it is the right thing to give.
          The name is here because this strip REPLACES the OS title bar in an
          installed desktop window, where naming the window is the bar's whole
          job. There is no WCO on a phone: `env(titlebar-area-*)` is undefined in
          every mobile browser, so below `sm` this is an ordinary app bar, and
          the name is the one element in it that carries no function — the icon
          beside it says the same thing, and the user reached this app by
          tapping that icon under that name.

          It was paid for by the notification bell, which now renders at every
          width. The layout gate measures the drag handle for exactly this
          reason ("it is the first thing a seventh control in this strip would
          consume") and caught the bell taking it to zero at 320px. */}
      <span className="hidden truncate text-[13px] font-semibold tracking-tight text-foreground sm:inline">
        {cfg.name}
      </span>
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  /** The sign-out question — see `onLogout` and sign-out-dialog.tsx. */
  const [signOutOpen, setSignOutOpen] = React.useState(false);
  // `pwa` is the resolved installed-app identity (icon, app name, title-bar
  // treatment); `branding` is the in-app token layer. The title bar uses the
  // former, the drawer's wordmark the latter — see AppMark.
  const { branding, pwa } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const location = useLocation();
  const chatWorkstation = /^\/comms\/?$/.test(location.pathname);
  const qc = useQueryClient();
  // The one scroll container (index.css: html/body/#root are overflow:hidden).
  // Handed to <PullToRefresh> so the pull only arms at the true top of the
  // page — window.scrollY is always 0 here and cannot answer that.
  const mainRef = React.useRef<HTMLElement>(null);
  /**
   * The app-wide pull-to-refresh action. A SOFT refresh: invalidate every
   * active React Query key so the screen the user is on revalidates in place —
   * no `location.reload()`, so scroll, auth and in-memory form state all
   * survive (stale-while-revalidate, like a native app). The control tower
   * shipped this gesture on its own; hoisting it to the shell is what makes the
   * pull work on EVERY screen, which is what users expect from a mobile app.
   */
  const softRefresh = React.useCallback(async () => {
    await qc.invalidateQueries();
  }, [qc]);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [env] = React.useState<string>(tokenStore.getEnv());
  // Non-null from the moment an env switch is confirmed until the browser has
  // replaced the document: the DESTINATION env, which the full-screen overlay
  // names while the reload is in progress.
  const [switchingTo, setSwitchingTo] = React.useState<Env | null>(null);
  // The reload timer, held so it can be cancelled on unmount. An uncancelled
  // one would fire on an unmounted shell — harmless in a browser, but in jsdom
  // the window is gone by then and a timer nobody is awaiting fails the whole
  // test run as an unhandled error.
  const switchTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
  }, []);
  const unread = useUnreadCounts(env);
  const toast = useToast();

  /**
   * Live arrival — the half of "do not miss this" that works while the person
   * is looking at the screen.
   *
   * The badge poll (useUnreadCounts) is a 60-second interval that pauses on a
   * hidden tab, so before this a notification could sit unannounced for a
   * minute on an active screen with nothing to hear or see. It stays as the
   * reconciler; this is the live path.
   *
   * Only an INTERRUPT toasts and sounds. That is the user's own per-category
   * choice resolved on the server (rules/notification-interrupt.js), not a
   * judgement made here — everything else still lands in the bell and moves the
   * badge, which is what "quietly appear" is supposed to look like.
   */
  useLiveNotifications(
    React.useCallback(
      (n) => {
        // Always: the badge is now correct within a socket round-trip rather
        // than within a minute, for interrupts and quiet arrivals alike.
        unread.reload();
        const tier = tierFor(n);
        if (tier === "silent") return;
        playOnce(tier, n.notification_id);
        // The body is a preview, not the whole message — the toast is a
        // pointer to the bell, and a five-line toast covering the screen is
        // its own kind of interruption.
        const preview = n.body ? `${n.title} — ${n.body}` : n.title;
        toast.info(preview.length > 140 ? `${preview.slice(0, 139)}…` : preview);
      },
      [unread, toast],
    ),
  );

  // The tab title carries the unread count, so a Praxis tab in a row of twelve
  // says so without being focused. Push covers the case where the browser is
  // not even open; this covers the far commoner one where it is open behind
  // something else.
  React.useEffect(() => {
    applyTabBadge(unread.notifications);
  }, [unread.notifications]);

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

  /**
   * Signing out is a two-answer question now, because the device REMEMBERS the
   * account (see sign-out-dialog.tsx for why it is asked rather than assumed).
   * `onLogout` opens it; the two handlers below are its answers.
   */
  async function onLogout() {
    setSignOutOpen(true);
  }

  async function finishSignOut() {
    setSignOutOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  /**
   * The other answer: sign out AND take this account off the device.
   *
   * The removal runs AFTER `logout()` deliberately. logout() wipes
   * localStorage and then restores the DEVICE keys it carries across the wipe —
   * last-session among them. Removing first would leave logout restoring a
   * snapshot taken a moment before the removal, and the email would come back
   * from that snapshot rather than from the store.
   *
   * WHAT GOES is `forgetDeviceAccount`'s job, not this function's — the set of
   * stores that describe "this device belongs to someone" is defined in
   * `lib/device-account.ts` and pinned by its test, so a refactor here cannot
   * quietly drop one of them.
   *
   * `user.email` is captured before logout() for the obvious reason.
   */
  async function finishSignOutAndForget() {
    const email = user?.email ?? "";
    setSignOutOpen(false);
    await logout();
    forgetDeviceAccount(email);
    navigate("/login", { replace: true });
  }

  /**
   * Test/Live switch — a HARD switch: persist the choice, then reload the page.
   *
   * ── WHY A RELOAD, WHEN THE SOFT SWITCH WORKED ──────────────────────────────
   *
   * The previous version flipped `X-Praxis-Env` in place: cancel the outgoing
   * env's queries, drop the comms socket, `setEnv`, remount the routed screen
   * under `key={env}`. Every one of those steps was a patch over the same
   * fact — the page was full of state that belonged to the OTHER environment —
   * and each new kind of state (a form draft in memory, a dialog half-filled, a
   * websocket subscription, a module-level cache, a worker) needed its own
   * patch or leaked across. Users met the leak as "I switched to TEST and the
   * page still showed LIVE data until I pressed Ctrl+F5." A reload is what
   * Ctrl+F5 does, done for them: the new document boots from `praxis.env`
   * alone, and there is no state to clean because there is no old state. The
   * service worker never caches `/api` (vite.config.ts), so what the new
   * document fetches is the new environment's data, not a cached copy.
   *
   * The cost is that unsaved work does not survive — which is exactly what
   * `EnvSwitchDialog` (env-switcher.tsx) says before anyone gets here. Every
   * control that can call this goes through that dialog, on every width.
   *
   * ── ORDER ──────────────────────────────────────────────────────────────────
   *
   *   1. Show the overlay FIRST, so the outgoing screen is covered for the
   *      whole of the reload rather than flashing between the click and the
   *      new document — and so a slow connection shows "Switching to TEST"
   *      instead of a page that appears to have ignored the click.
   *   2. Cancel the outgoing env's in-flight queries and drop the comms
   *      socket. Both are moot once the document is gone, but the reload is a
   *      beat away and a response or a socket frame landing in that beat
   *      would still be work done for an environment nobody is looking at.
   *   3. Persist. `tokenStore.setEnv` is the ONLY input the next document
   *      reads, so it is written before anything that could fail.
   *   4. Reload, a moment later. The delay is one paint of the overlay, not a
   *      wait: long enough for the interstitial to be seen as the answer to
   *      the click, short enough that nobody reads it as loading.
   *
   * Shell state is deliberately NOT flipped: the outgoing screen stays as it
   * was under the overlay instead of remounting and refetching everything for
   * an environment it will never get to show.
   */
  const ENV_RELOAD_DELAY_MS = 450;
  function switchEnv(next: Env) {
    if (next === env) return;
    setSwitchingTo(next);
    void qc.cancelQueries({ queryKey: [TENANT_KEY, env] });
    disconnectCommsSocket();
    tokenStore.setEnv(next);
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => {
      switchTimer.current = null;
      window.location.reload();
    }, ENV_RELOAD_DELAY_MS);
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
                <span className="hidden text-xs lg:inline">{t("common.search")}</span>
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
                <LangToggle />
              </span>
              <span className="hidden sm:inline-flex">
                <ThemeToggle />
              </span>
              {/*
              NO QUICK-ACTIONS TRIGGER HERE, AT ANY WIDTH.

              A burst icon in the title bar is a menu whose contents you cannot
              guess from its glyph, sitting in the one strip where every other
              control says exactly what it is: search, clock, environment,
              language, theme, alerts, account. It also put Messages in the top
              bar while the rail already carries Messages, so the same
              destination had two chrome homes and the unread count had to be
              duplicated between them to stay honest.

              The two surfaces that remain are the ones that fit their input:
              `<IconRail>` on desktop (where the count now rides the Messages
              cell it belongs to) and `<FloatingActions>` on touch. Neither is
              in the header.
              */}
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
                    aria-label={t("shell.closeMenu")}
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
              <span>{t("shell.testMode")}</span>
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
            <IconRail messageBadge={unread.messages} />

            <div className="flex min-w-0 flex-1 flex-col">
              <Ribbon pathname={location.pathname} />

              {/* key={env}: the routed screen is keyed by environment. `env` is
              read once per document now that a switch reloads the page
              (switchEnv), so this is a statement of ownership rather than a
              remount trigger — every screen under here belongs to one env. */}
              {/*
            Padding scales with the viewport now (was a flat p-6 at every width).
            Width itself is NOT capped here — each screen picks a deliberate column
            width via <PageContainer> / pageShell (audit F3), so the shell stays out
            of that decision and a full-bleed screen stays possible.
          */}
              {/*
               * `relative` IS A BUG FIX, not styling. It makes this element a
               * containing block, so an absolutely-positioned descendant is
               * laid out against THE APP'S SCROLL CONTAINER rather than
               * against the document.
               *
               * Without it, any `position: absolute` descendant with no
               * positioned ancestor — every `sr-only` control is one, and
               * seven file inputs across the app are `sr-only` — resolves
               * against the initial containing block and adds its offset to
               * the DOCUMENT's scrollable overflow. Focusing it (which is what
               * opening a file picker does) then makes the browser scroll the
               * document to reveal it, carrying the entire shell out of the
               * viewport. Because `html, body, #root` are `overflow: hidden`
               * (index.css) there is no scrollbar to bring it back, so the app
               * simply appears black until a reload. See the long note in
               * `components/ui/file-drop.tsx`, which is where it was found.
               *
               * That component carries its own `relative` too, because it is
               * also rendered inside dialogs and must not depend on being a
               * descendant of this element. This is the floor for everything
               * else, and for whatever gets written next.
               */}
              <main
                id="main-content"
                ref={mainRef}
                tabIndex={-1}
                key={env}
                className={cn(
                  "relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain overflow-x-hidden p-4 pb-24 focus:outline-none md:p-6 md:pb-6 2xl:px-8",
                  chatWorkstation && "overflow-hidden",
                )}
              >
                {/* App-wide pull-to-refresh. It wraps every routed screen rather
                than living on one page, so the mobile pull gesture works
                everywhere the way a native app's does — a soft, in-place
                revalidation (softRefresh), not a hard reload. It reads the pull
                against THIS <main> (mainRef), the app's only scroll container,
                and stands down on the chat workstation, which owns its own
                scroll. Desktop and open-dialog suppression are the component's
                own (see pull-to-refresh.tsx). */}
                <PullToRefresh
                  onRefresh={softRefresh}
                  scrollRef={mainRef}
                  disabled={chatWorkstation}
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
                </PullToRefresh>
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
          {/* The one raise-a-ticket modal: the rail, the touch cluster and the
              Support page all open it through the same event, so it lives
              here with the other shell-level surfaces, not on the page. */}
          <GlobalRaiseTicket />
          {/* Sign out asks before it releases the device — it is a shell-level
              surface because both doors into it (the account menu, and whatever
              else grows one) have to ask the same question. */}
          <SignOutDialog
            open={signOutOpen}
            onClose={() => setSignOutOpen(false)}
            onSignOut={finishSignOut}
            onSignOutAndForget={finishSignOutAndForget}
            email={user?.email ?? null}
          />
          {/* ON EVERY TOUCH SCREEN, Smart Comms included.

              It used to be `!chatWorkstation &&`, because the cluster sits in
              the same corner as the composer's send and mic buttons, and the
              title bar's quick-actions menu stood in for it there. That menu is
              gone at every width, so the exception would now leave a phone on
              `/comms` with no quick actions at all — and no clock-in, which is
              the surface `<ClockPunch>` lives on below `sm`.

              The overlap is solved where it is caused: the composer publishes
              `--fab-floor` and the cluster anchors above it (floating-actions.tsx). */}
          <FloatingActions
            badge={unread.messages + unread.notifications}
            messageBadge={unread.messages}
            notificationBadge={unread.notifications}
          />
          {/* Env-switch interstitial. Shown from the confirmed switch until the
          browser has replaced the document (switchEnv above). `onReload` is
          the escape hatch the overlay offers if the reload was refused. */}
          {switchingTo && (
            <EnvSwitchOverlay to={switchingTo} onReload={() => window.location.reload()} />
          )}
        </div>
      </RibbonCommandsProvider>
    </CommandPaletteProvider>
  );
}
