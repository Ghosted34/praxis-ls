/**
 * The lock screen — what a finance officer's desk shows once their session has
 * ended and they are not there.
 *
 * ── WHAT IT GUARANTEES ──────────────────────────────────────────────────────
 *
 *   NOTHING IS READABLE. Every other top-level element of the page — the app,
 *   and every portal (dialogs, toasts, the call overlay, menus) — is blurred
 *   beyond reading and hidden from print. A dark, brand-tinted veil sits on top.
 *   Portals that open WHILE locked are caught too (a MutationObserver), so a
 *   late toast cannot surface a customer's name over the blur.
 *
 *   NOTHING IS USABLE. The same elements are `inert` and `aria-hidden`: no
 *   click, no Tab, no screen-reader cursor reaches an approval button behind the
 *   veil. Keyboard and pointer events that start on the lock screen stop here,
 *   so an Escape meant for the PIN field cannot close a dialog underneath. And
 *   the tokens are already gone — auth-context wiped them and api-client
 *   refuses authenticated calls while locked — so even a DOM edited by hand has
 *   nothing to act with.
 *
 *   NOTHING IS LOST. The app is not unmounted. The half-typed invoice, the
 *   open record, the scroll position are all exactly where they were, and the
 *   right person unlocking returns them to it — passkey, PIN or password, in
 *   that order, from the same panel the sign-in page uses.
 *
 * The page title changes to say it is locked, so a tab strip or a task
 * switcher does not advertise which record was open.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useAuth, type LockReason } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { LockIcon, ShieldIcon } from "@/components/ui/icons";
import { currentLocale } from "@/lib/i18n";
import { SignInPanel } from "./sign-in-panel";

const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT", "META"]);

type Saved = { inert: boolean; ariaHidden: string | null };

/**
 * Blur + inert every top-level element except the lock screen's own root, and
 * keep doing it for anything added while locked. Returns the undo.
 */
function sealPage(except: HTMLElement): () => void {
  const saved = new Map<Element, Saved>();
  const seal = (el: Element) => {
    if (el === except || SKIP.has(el.tagName) || saved.has(el)) return;
    const h = el as HTMLElement;
    saved.set(el, { inert: h.inert === true, ariaHidden: el.getAttribute("aria-hidden") });
    h.inert = true;
    el.setAttribute("aria-hidden", "true");
    el.classList.add("praxis-locked");
  };
  Array.from(document.body.children).forEach(seal);
  const observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && seal(n as Element));
  });
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect();
    saved.forEach((was, el) => {
      const h = el as HTMLElement;
      h.inert = was.inert;
      if (was.ariaHidden === null) el.removeAttribute("aria-hidden");
      else el.setAttribute("aria-hidden", was.ariaHidden);
      el.classList.remove("praxis-locked");
    });
  };
}

function reasonText(reason: LockReason | null, maxAgeMin: number): string {
  switch (reason) {
    case "session_max_age":
      return `For your security, sessions lock after ${maxAgeMin >= 60 && maxAgeMin % 60 === 0 ? `${maxAgeMin / 60} hours` : `${maxAgeMin} minutes`}. Sign in to pick up exactly where you left off.`;
    case "inactivity_timeout":
      return "Locked after a period without activity. Sign in to pick up exactly where you left off.";
    case "revoked":
      return "This session was ended from another device or by an administrator. Sign in to continue.";
    case "manual":
      return "You locked this screen. Sign in to pick up exactly where you left off.";
    default:
      return "Your session is locked. Sign in to pick up exactly where you left off.";
  }
}

function useClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function LockClock() {
  const now = useClock();
  // Day-first, pinned locale — never the machine's (CLAUDE.md, dates rule).
  const locale = currentLocale() === "fr-FR" ? "fr-FR" : "en-GB";
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now);
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);
  return (
    <div className="login-lock-clock" aria-hidden>
      <span className="login-lock-time">{time}</span>
      <span className="login-lock-date">{day}</span>
    </div>
  );
}

/**
 * Mounted once, high in the app (app.tsx). Shows while the session is locked —
 * and for the few seconds after unlocking while a passkey offer is on screen,
 * so the app stays sealed until the panel says it is done.
 */
export function LockLayer({ maxAgeMin = 120 }: { maxAgeMin?: number }) {
  const { status, user, lockReason, abandonLock, unlockedElsewhere } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const [open, setOpen] = React.useState(false);
  const [reasonShown, setReasonShown] = React.useState<LockReason | null>(null);
  const [identity, setIdentity] = React.useState<typeof user>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const titleId = React.useId();
  // Read through a ref: a branding refresh while locked must not re-run the
  // seal below, which would remount the panel and drop a half-typed PIN.
  const brandRef = React.useRef(brandName);
  brandRef.current = brandName;

  // Latch open on lock; only the panel's onDone (or leaving auth) closes it.
  React.useEffect(() => {
    if (status === "locked") {
      setOpen(true);
      setReasonShown(lockReason);
      setIdentity(user);
    } else if (status === "anon" || status === "loading") {
      setOpen(false);
    }
  }, [status, lockReason, user]);

  // Another tab unlocked the shared session: nothing left for this panel to do.
  React.useEffect(() => {
    if (unlockedElsewhere > 0) setOpen(false);
  }, [unlockedElsewhere]);

  // The portal root: created on open, removed on close.
  React.useEffect(() => {
    if (!open) return;
    const el = document.createElement("div");
    el.id = "praxis-lock-root";
    document.body.appendChild(el);
    setHost(el);
    const unseal = sealPage(el);
    // Events that begin on the lock screen end here. React's own handlers are
    // bound on this container too and still run; only document-level listeners
    // (a dialog's "click outside", "Escape closes", the ⌘K palette) are denied.
    const stop = (e: Event) => e.stopPropagation();
    const kinds = ["pointerdown", "mousedown", "touchstart", "focusin", "keydown", "keyup"];
    kinds.forEach((k) => el.addEventListener(k, stop));
    const title = document.title;
    document.title = `Locked · ${brandRef.current}`;
    return () => {
      kinds.forEach((k) => el.removeEventListener(k, stop));
      unseal();
      el.remove();
      setHost(null);
      document.title = title;
    };
  }, [open]);

  // The seal (sealPage, above) never waits on knowing WHO is locked out. With
  // no cached identity the panel falls back to the device's remembered one,
  // and failing that asks for an email — a different account signing in then
  // reloads the page (auth-context), so nobody inherits what is behind the blur.
  if (!open || !host) return null;

  return createPortal(
    <div className="login-lock-scrim" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="login-lock-top">
        <span className="login-lock-brand">
          {branding.logoUrl ? <img src={branding.logoUrl} alt="" /> : <ShieldIcon width={18} height={18} />}
          {brandName}
        </span>
      </div>

      <LockClock />

      <div className="login-card login-lock-card">
        <span className="login-lock-badge">
          <LockIcon width={13} height={13} /> Session locked
        </span>
        <SignInPanel
          mode="unlock"
          titleId={titleId}
          identity={
            identity
              ? { email: identity.email, display_name: identity.display_name, avatar_url: identity.avatar_url }
              : null
          }
          reason={reasonText(reasonShown, maxAgeMin)}
          onSwitchAccount={abandonLock}
          onDone={() => setOpen(false)}
        />
      </div>

      <p className="login-lock-foot">
        <ShieldIcon width={13} height={13} />
        Your work is safe behind the lock — nothing on this screen can be seen or used until you sign in.
      </p>
    </div>,
    host,
  );
}
