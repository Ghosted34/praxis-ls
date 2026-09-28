/**
 * The portal's frame: an app on a phone, a piece of software on a desk.
 *
 *   PHONE    a quiet top bar (the tenant's logo, or a back arrow and the page
 *            title on an inner page, and the person's avatar), the page, a tab
 *            bar at the thumb, and the chat button floating above it.
 *   DESK     a sidebar with the same destinations, the page in a readable
 *            column, and the same floating chat button.
 *
 * The old header said "CLIENT PORTAL" in capitals beside the logo and wrapped
 * "Sign out" onto two lines on a phone. The client knows whose portal this is;
 * the logo says so, and signing out lives in the account sheet with the rest
 * of the settings nobody needs every day.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useBranding } from "@/app/branding";
import { cn } from "@/lib/cn";
import {
  portalHome,
  portalChatUnread,
  portalPasskeyRegisterOptions,
  portalPasskeyRegisterVerify,
  portalNotifySettings,
  type PortalHome,
} from "@/lib/portal-api";
import { portalSession } from "@/lib/portal-session";
import { getLang } from "@/lib/i18n";
import { usePortal } from "../lib/portal-context";
import { syncPush } from "../lib/portal-pwa";
import { deviceCanUsePasskey, createPasskey, isCancel, biometricKind } from "../lib/passkey";
import { BrandMark } from "../ui/brand";
import { Avatar, Sheet, useLoad, useToast, errorText, Busy, type Load } from "../ui/kit";
import {
  HomeIcon,
  ShipIcon,
  QuoteIcon,
  WalletIcon,
  FolderIcon,
  ChatIcon,
  ChevronLeftIcon,
  FaceIdIcon,
  FingerprintIcon,
  ChevronRightIcon,
  ShieldIcon,
} from "../ui/icons";
import { ChatSheet, type ChatTarget } from "../screens/chat";

/* ── page chrome: the title and back target an inner page sets ──────────── */

type Chrome = { title: string | null; back: string | null };
const ChromeContext = React.createContext<(c: Chrome) => void>(() => {});

/** An inner page names itself and where "back" goes; a tab page sets nothing. */
export function usePageChrome(title: string | null, back: string | null = null) {
  const set = React.useContext(ChromeContext);
  React.useEffect(() => {
    set({ title, back });
    return () => set({ title: null, back: null });
  }, [set, title, back]);
}

/* ── the home summary, shared: Home renders it, the tab badges count from it ─ */

const SummaryContext = React.createContext<Load<PortalHome> | null>(null);
export const useSummary = () => React.useContext(SummaryContext);

/* ── chat: any screen can open it, already pointed at a shipment ────────── */

/**
 * The count on the chat button: what the team wrote since I last looked. It
 * starts from the home summary and then asks the one cheap endpoint every
 * minute while the tab is visible (and when it comes back), so a reply lands
 * on the button without a reload — and a background tab asks nothing.
 */
function useChatUnread(on: boolean, initial: number | null) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (initial !== null) setCount(initial);
  }, [initial]);
  const refresh = React.useCallback(() => {
    portalChatUnread()
      .then((r) => setCount(r.unread))
      .catch(() => {
        /* @silent:storage the badge waits for the next minute */
      });
  }, []);
  React.useEffect(() => {
    if (!on) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [on, refresh]);
  return { count, refresh };
}

const ChatContext = React.createContext<(target?: ChatTarget) => void>(() => {});
export const useOpenChat = () => React.useContext(ChatContext);

/** A shipment's id in a `?chat=` link; anything else is ignored, not requested. */
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NavItem = { to: string; label: string; icon: React.ReactNode; badge?: number; end?: boolean };

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const portal = usePortal();
  const { branding } = useBranding();
  const location = useLocation();
  const [chrome, setChrome] = React.useState<Chrome>({ title: null, back: null });
  const [chat, setChat] = React.useState<ChatTarget | false>(false);
  const [scrolled, setScrolled] = React.useState(false);
  const lang = getLang();
  const isClient = portal.kind === "CLIENT";
  const summary = useLoad(() => (isClient ? portalHome(lang) : Promise.resolve(null as unknown as PortalHome)), `home:${lang}:${portal.kind}`);

  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // The browser tab says whose portal and which page — never ours.
  React.useEffect(() => {
    const name = branding.name || t("portal.brandFallback");
    document.title = chrome.title ? `${chrome.title} · ${name}` : name;
  }, [branding.name, chrome.title, t]);

  // A device that already has notifications on is re-registered on every
  // start (lib/portal-pwa.ts syncPush). Nothing is asked, and nothing is even
  // fetched, where notifications were never allowed.
  React.useEffect(() => {
    if (!isClient || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let alive = true;
    portalNotifySettings()
      .then((n) => (alive ? syncPush(n.push.public_key, lang === "fr" ? "fr" : "en") : undefined))
      .catch(() => {
        /* @silent:storage — the next start tries again */
      });
    return () => {
      alive = false;
    };
  }, [isClient, lang]);

  const s = summary.data;
  const needed = s?.requests?.open_count || 0;
  const overdue = s?.billing?.overdue_count || 0;
  const chatUnread = useChatUnread(isClient, s?.chat?.unread ?? null);

  const nav: NavItem[] = isClient
    ? [
        { to: "/portal", label: t("portal.nav.home"), icon: <HomeIcon />, end: true },
        ...(portal.canOps ? [{ to: "/portal/shipments", label: t("portal.nav.shipments"), icon: <ShipIcon /> }] : []),
        ...(portal.canOps ? [{ to: "/portal/quotes", label: t("portal.nav.quotes"), icon: <QuoteIcon /> }] : []),
        ...(portal.canBilling ? [{ to: "/portal/billing", label: t("portal.nav.billing"), icon: <WalletIcon />, badge: overdue }] : []),
        ...(portal.canOps ? [{ to: "/portal/documents", label: t("portal.nav.documents"), icon: <FolderIcon />, badge: needed }] : []),
      ]
    : [
        {
          to: "/portal",
          label: t(`portal.kind.${portal.kind}`),
          icon: portal.kind === "INVESTOR" ? <WalletIcon /> : <ShieldIcon />,
          end: true,
        },
      ];

  const openChat = React.useCallback((target?: ChatTarget) => setChat(target || null), []);
  const name = portal.me.portal_user.full_name || portal.me.portal_user.email;

  // A notification's link — `/portal?chat=general`, or a shipment's id — opens
  // that conversation over the page it lands on, then drops the parameter so a
  // reload or a back does not open it a second time.
  const navigate = useNavigate();
  React.useEffect(() => {
    if (!isClient) return;
    const params = new URLSearchParams(location.search);
    const thread = params.get("chat");
    if (!thread) return;
    if (thread === "general") setChat({ general: true });
    else if (THREAD_ID.test(thread)) setChat({ dossierId: thread });
    params.delete("chat");
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : "" }, { replace: true });
  }, [isClient, location.pathname, location.search, navigate]);

  return (
    <ChromeContext.Provider value={setChrome}>
      <SummaryContext.Provider value={summary}>
        <ChatContext.Provider value={openChat}>
          <div className="lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
            {/* ── desk: sidebar ── */}
            <aside className="pt-sidebar hidden lg:flex" aria-label={t("portal.nav.label")}>
              <div className="flex h-10 items-center px-3">
                <BrandMark className="max-h-9" />
              </div>
              <nav className="mt-8 grid gap-1">
                {nav.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className="pt-nav-item" aria-current={undefined}>
                    {({ isActive }) => (
                      <span className="contents" data-active={isActive || undefined}>
                        <span aria-hidden="true">{n.icon}</span>
                        <span className="flex-1">{n.label}</span>
                        {n.badge ? <span className="pt-seg-count pt-num">{n.badge}</span> : null}
                      </span>
                    )}
                  </NavLink>
                ))}
              </nav>
              <div className="mt-auto">
                <NavLink to="/portal/account" className="pt-nav-item !h-auto !py-3">
                  <Avatar name={portal.me.portal_user.full_name} email={portal.me.portal_user.email} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{portal.company || t(`portal.kind.${portal.kind}`)}</span>
                  </span>
                  <ChevronRightIcon size={18} />
                </NavLink>
              </div>
            </aside>

            <div className="min-w-0">
              {/* ── phone: top bar ── */}
              <header className="pt-topbar lg:hidden" data-scrolled={scrolled}>
                {chrome.back ? (
                  <BackButton to={chrome.back} />
                ) : (
                  <div className="flex min-w-0 flex-1 items-center pl-1">
                    <BrandMark />
                  </div>
                )}
                {chrome.back ? <p className="min-w-0 flex-1 truncate text-center text-[0.95rem] font-semibold text-foreground">{chrome.title}</p> : null}
                <NavLink to="/portal/account" aria-label={t("portal.nav.account")} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                  <Avatar name={portal.me.portal_user.full_name} email={portal.me.portal_user.email} size={36} />
                </NavLink>
              </header>

              <main id="pt-main" className="pt-main mx-auto w-full max-w-[1120px] px-4 pt-3 sm:px-6 lg:px-10 lg:pt-10">
                {children}
              </main>
            </div>
          </div>

          {/* ── phone: tab bar ── */}
          {nav.length > 1 ? (
            <nav className="pt-tabbar lg:hidden" aria-label={t("portal.nav.label")} style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className="pt-tab">
                  <span className="pt-tab-icon relative">
                    {n.icon}
                    {n.badge ? <span className="pt-badge pt-num">{n.badge > 9 ? "9+" : n.badge}</span> : null}
                  </span>
                  <span className="max-w-full truncate px-1">{n.label}</span>
                </NavLink>
              ))}
            </nav>
          ) : null}

          {isClient ? (
            <button type="button" className="pt-fab" onClick={() => openChat(null)}>
              <ChatIcon size={26} />
              <span className="sr-only">{chatUnread.count ? `${t("portal.chat.open")} (${t("portal.chat.unread", { count: chatUnread.count })})` : t("portal.chat.open")}</span>
              {chatUnread.count ? (
                <span className="pt-badge pt-num" aria-hidden="true">
                  {chatUnread.count > 9 ? "9+" : chatUnread.count}
                </span>
              ) : null}
            </button>
          ) : null}

          {isClient ? <ChatSheet open={chat !== false} target={chat || null} onClose={() => setChat(false)} onRead={chatUnread.refresh} /> : null}
          <PasskeyOffer key={location.key} />
        </ChatContext.Provider>
      </SummaryContext.Provider>
    </ChromeContext.Provider>
  );
}

function BackButton({ to }: { to: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="pt-icon-btn -ml-1"
      aria-label={t("portal.common.back")}
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(to))}
    >
      <ChevronLeftIcon size={24} />
    </button>
  );
}

/**
 * Right after signing in on a phone kept signed in: "use Face ID next time?".
 * Asked once per device — a "not now" is remembered — and only where the
 * device has its own screen-lock authenticator and no passkey for this person.
 */
const OFFERED_KEY = "praxis.portal.passkeyOffered";

function PasskeyOffer() {
  const { t } = useTranslation();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const state = location.state as { justSignedIn?: boolean; trusted?: boolean } | null;
  const kind = biometricKind();
  const Icon = kind === "face" ? FaceIdIcon : FingerprintIcon;

  React.useEffect(() => {
    if (!state?.justSignedIn || !state.trusted) return;
    const known = portalSession.known();
    let offered = false;
    try {
      offered = localStorage.getItem(OFFERED_KEY) === "1";
    } catch {
      offered = true; // @silent:storage — cannot remember a "not now", so do not ask
    }
    if (offered || (known && known.passkeys.length)) return;
    let alive = true;
    void deviceCanUsePasskey().then((ok) => alive && ok && setOpen(true));
    return () => {
      alive = false;
    };
  }, [state]);

  const dismiss = () => {
    try {
      localStorage.setItem(OFFERED_KEY, "1");
    } catch {
      /* @silent:storage — asked again next sign-in; harmless */
    }
    setOpen(false);
  };

  async function enable() {
    setBusy(true);
    try {
      const options = await portalPasskeyRegisterOptions();
      const attestation = await createPasskey(options);
      const out = await portalPasskeyRegisterVerify(attestation, String(options._challengeToken || ""));
      portalSession.addPasskey(out.credential_id);
      toast(t(`portal.passkey.on.${kind}`));
      dismiss();
    } catch (e) {
      if (!isCancel(e)) toast(errorText(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={dismiss}>
      <div className="flex flex-col items-center pb-2 pt-4 text-center">
        <span className="pt-icon-disc" style={{ width: 76, height: 76, borderRadius: 26 }}>
          <Icon size={38} />
        </span>
        <h2 className="pt-display mt-5 text-[1.5rem]">{t(`portal.passkey.offerTitle.${kind}`)}</h2>
        <p className="mt-2 max-w-sm text-[0.95rem] text-muted-foreground">{t("portal.passkey.offerBody")}</p>
        <div className="mt-6 grid w-full gap-2">
          <button type="button" className="pt-btn pt-btn-primary pt-btn-block" onClick={() => void enable()} disabled={busy}>
            <Busy busy={busy}>
              <Icon size={20} />
            </Busy>
            {t("portal.passkey.turnOn")}
          </button>
          <button type="button" className="pt-btn pt-btn-ghost pt-btn-block" onClick={dismiss}>
            {t("portal.common.notNow")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function PageHeader({
  title,
  sub,
  action,
  className,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="pt-display text-[1.85rem] sm:text-[2.1rem]">{title}</h1>
        {sub ? <p className="mt-1 text-[0.95rem] text-muted-foreground">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
