/**
 * Signing in to the portal.
 *
 * ── THE BRIEF ──────────────────────────────────────────────────────────────
 *
 * Beautiful, and almost no words (owner, portal redesign): the tenant's own
 * photograph, one field, one big button. Everything the old screen said in
 * paragraphs — what the portal is for, who issues access — is behind the ⓘ for
 * whoever wants it.
 *
 * And it is the homepage's hero, carried through the door (owner, login
 * redesign): the same scrimmed photograph, the same light passing behind a
 * two-tone headline, the same dark glass plate — here holding the form rather
 * than the track field. `SignInFrame` below says how, layer by layer.
 *
 * ── HOW A PERSON GETS IN ───────────────────────────────────────────────────
 *
 *   1. Email, then a six-digit code by email — nothing to remember.
 *   2. Or a password, for someone who has one.
 *   3. Or Face ID / fingerprint, offered FIRST to a returning person on a
 *      device that already holds their passkey ("Welcome back, Marie").
 *
 * "Keep me signed in" is on by default on a phone and off on a computer (a
 * shared office PC is the case it protects), and the person can flip it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { getLang, setLang } from "@/lib/i18n";
import { p } from "@/lib/base-path";
import { usePointerLight, useTilt } from "@/lib/motion";
import { useInView, useRevealed } from "@/components/ui/reveal";
import { StagedLines } from "@/components/ui/type";
import { RouteCanvas } from "@/components/site/route-canvas";
import { HERO_SCRIMS, SCRIM_DOOR_VEIL, SCRIM_DOOR_WASH } from "@/components/site/hero-scrim";
/* The hero's own rules — the pass, the glare, the edge that catches the beam,
   the tilt and the entrance — rather than a portal copy of them. A second copy
   of a light that is supposed to be one scene is two lights that drift. */
import "@/components/site/hero.css";
import {
  portalRequestCode,
  portalVerifyCode,
  portalLogin,
  portalForgot,
  portalMe,
  portalPasskeyLoginOptions,
  portalPasskeyLoginVerify,
  type Tokens,
} from "@/lib/portal-api";
import { portalSession, type KnownPerson } from "@/lib/portal-session";
import { deviceCanUsePasskey, signWithPasskey, isCancel, biometricKind } from "../lib/passkey";
import { firstNameOf } from "../lib/portal-context";
import { resolvePortalTheme, setPortalTheme } from "../lib/theme";
import { BrandMark, SignInScene, useSignInPhoto } from "../ui/brand";
import { Avatar, InfoButton, PasswordField, Switch, errorText, Busy } from "../ui/kit";
import { CodeInput } from "../ui/code-input";
import {
  ArrowRightIcon,
  FaceIdIcon,
  FingerprintIcon,
  MailIcon,
  KeyIcon,
  ChevronLeftIcon,
  ShipIcon,
  DocIcon,
  UploadIcon,
  WalletIcon,
  UsersIcon,
  ChatIcon,
  SunIcon,
  MoonIcon,
} from "../ui/icons";

type Step = "email" | "code" | "password" | "forgotSent";

const isPhone = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

/** Where to go after signing in: the page they were headed for, or Home. */
function useNext(): string {
  const [params] = useSearchParams();
  const next = params.get("next") || "";
  return next.startsWith("/portal") && !next.startsWith("/portal/login") ? next : "/portal";
}

/**
 * The frame every sign-in step sits in — the homepage hero, carried through
 * the door.
 *
 * ── WHY IT IS THE HERO AND NOT A PAGE OF ITS OWN ──────────────────────────
 *
 * A client reaches this screen from the homepage's "Client portal" link, and
 * until this frame they walked out of a dark, lit, moving scene into a
 * photograph with a white sheet over two thirds of it: the same company, two
 * different buildings. So this is the hero's scene, layer for layer and in the
 * hero's own paint order — `hero.tsx` carries each layer's safety argument, and
 * every one of them holds here because nothing is reordered:
 *
 *   photograph → pointer light → the pass → the scrims → night
 *     → route lanes → the copy's veil → the copy and the plate
 *
 * The classes are the hero's own (`hero.css`), not copies, and the scrims come
 * from the hero's measured stop lists (`hero-scrim.ts`). At `lg` it is the
 * hero's split scrim, copy in the left column where it holds the floor. Below
 * `lg` the floor rides WITH the copy as a veil in its grid cell, over a lighter
 * wash, so the photograph shows between the headline and the plate instead of
 * vanishing under a scrim sized for the hero's longer copy. The eyebrow and the
 * track link each carry a glass ground of their own, so neither leans on the
 * photograph for its contrast.
 *
 * ── THE PLATE IS A PIECE OF THE DARK THEME ────────────────────────────────
 *
 * The form is dark glass in BOTH portal themes (owner's choice). Rather than a
 * second, on-dark set of rules for every field, button, switch and code box in
 * `kit.tsx`, the plate carries `data-theme="dark"`: the dark token block in
 * `index.css` matches it, so every control inside paints from dark-theme pairs
 * `check:contrast` already measures, and a control added to a sign-in step
 * later is right on the glass without anyone remembering to make it so.
 * `.pt-signin-plate` in portal.css adds the glass and the `--pt-*` family.
 *
 * ── THE SWITCH ────────────────────────────────────────────────────────────
 *
 * Light/dark here is the PORTAL's theme (`lib/theme.ts`), the same choice
 * Account offers, so a client can make it before the first screen they land
 * on. The scene answers at once — night deepens the wash over the photograph
 * (`.pt-signin-night`) — and the portal behind the door opens in that mode.
 */
export function SignInFrame({ children, info = true }: { children: React.ReactNode; info?: boolean }) {
  const photo = useSignInPhoto();
  const { t } = useTranslation();
  const lang = getLang();
  /* One contract, two inputs, as on the hero: the pointer on a laptop and the
     gyroscope on a phone both write `--lx`/`--ly` on the band, and the light,
     the glare and the plate's tilt all read that one pair. Neither hook ever
     prompts for a sensor permission. */
  const lightRef = usePointerLight<HTMLDivElement>();
  const tilt = useTilt<HTMLDivElement>({ max: 18 });
  /* `live` unpauses the pass and the word light only while the band is on
     screen; `entered` runs the arrival once. Both ride the shared observers. */
  const [liveRef, live] = useInView<HTMLDivElement>();
  const [enterRef, entered] = useRevealed<HTMLDivElement>();
  const bandRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      (lightRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (tilt.ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [lightRef, tilt.ref],
  );
  const wide = useWide();
  const taglineMain = t("portal.signin.taglineMain");
  const enter = (step: string) => cn("hero-enter", step, entered && "is-in");

  return (
    <div ref={bandRef} data-live={live ? "true" : "false"} className="pt-signin band-hero">
      {photo ? (
        <>
          <img className="pt-signin-photo" src={photo} alt="" />
          {/* Under the scrims, as on the hero: lightening cannot take a
              photograph past the white the floors were measured against. */}
          <div aria-hidden="true" className="hero-light" />
        </>
      ) : (
        <SignInScene />
      )}

      {/* The pass. Between the light and the scrims, so on a photograph the
          measured wash caps the beam exactly as it caps the image. */}
      <div ref={liveRef} aria-hidden="true" className="hero-beam-track">
        <span className="hero-beam" />
      </div>

      {/* The scrims. At `lg`, the hero's split, unchanged. Below it, a wash
          over the band held to the plate's floor — the copy's own floor rides
          in the grid with the copy (`pt-signin-veil`), so it is under the
          headline however the headline wraps. `hero-scrim.ts` has why. */}
      {photo ? (
        <>
          <div aria-hidden="true" className="pt-signin-layer lg:hidden" style={{ background: HERO_SCRIMS.css(SCRIM_DOOR_WASH) }} />
          <div aria-hidden="true" className="pt-signin-layer hidden lg:block" style={{ background: HERO_SCRIMS.css(HERO_SCRIMS.split) }} />
        </>
      ) : null}

      {/* Night: a wash of the band's own ground, only in the dark theme. It can
          only darken, so like the hero's departure it can raise the measured
          floors and never spend them. */}
      <div aria-hidden="true" className="pt-signin-night" />

      {/* The lanes, behind the plate on a wide screen, where the glass blurs
          them into moving light. Not MOUNTED below `lg` rather than merely
          hidden: a phone never sees them, so it should not run their effect. */}
      {wide ? (
        <div aria-hidden="true" className="pt-signin-lanes">
          <RouteCanvas className="h-full w-full" alpha={0.42} />
        </div>
      ) : null}

      <header className="pt-signin-bar">
        <BrandMark onDark className="max-h-9" />
        <div className="flex items-center gap-2">
          <div className="pt-signin-seg" role="group" aria-label={t("portal.account.language")}>
            {(["en", "fr"] as const).map((l) => (
              <button key={l} type="button" className="pt-glass-chip" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <ThemeSwitch />
          {info ? (
            <InfoButton onDark label={t("portal.signin.whatsInside")} title={t("portal.signin.whatsInside")}>
              <FeatureList />
            </InfoButton>
          ) : null}
        </div>
      </header>

      <div ref={enterRef} className="pt-signin-grid tilt-stage">
        {photo ? <div aria-hidden="true" className="pt-signin-veil lg:hidden" style={{ background: HERO_SCRIMS.css(SCRIM_DOOR_VEIL) }} /> : null}
        <div className="pt-signin-copy">
          <p className={enter("pt-signin-eyebrow eyebrow hero-enter-eyebrow")}>{t("portal.signin.eyebrow")}</p>
          {/* A paragraph, not a heading: the screen's `h1` is the step inside
              the plate ("Sign in", "Check your email"), which is what a screen
              reader should land on. `StagedLines` gives the line its one
              readable name either way. The second half arrives on its own beat
              in the tenant's colour, and `wordOffset` keeps it the next light
              in the pass rather than a second first. */}
          <p className="pt-signin-title hero-title hero-lit">
            <StagedLines paintImmediately masked startDelay={80} wordClassName="hero-word-light" text={taglineMain} />{" "}
            <span className="text-[var(--primary-ink-hero)]">
              <StagedLines
                masked
                startDelay={340}
                wordOffset={taglineMain.trim().split(/\s+/).length}
                wordClassName="hero-word-light hero-word-light-accent"
                text={t("portal.signin.taglineAccent")}
              />
            </span>
          </p>
          <ul className={enter("pt-signin-points hero-enter-lead")} aria-label={t("portal.signin.whatsInside")}>
            {POINTS.map(([Icon, key]) => (
              <li key={key} className="pt-signin-point">
                <span className="pt-signin-point-icon">
                  <Icon size={20} />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
          <div className={enter("pt-signin-way hero-enter-cta")}>
            {/* Someone holding only a tracking number has no account and
                needs none: say so before they go looking for a password. */}
            <Link to={p("/track")} className="pt-signin-pill">
              <ShipIcon size={18} />
              {t("portal.signin.trackLink")}
              <ArrowRightIcon size={16} className="pt-signin-pill-arrow" />
            </Link>
          </div>
        </div>

        {/* The plate. Its wrapper owns the entrance transform and `.tilt-plate`
            owns the pointer's, on separate elements for the reason `hero.css`
            gives; the wrapper is deaf to the pointer and the plate hears again
            (`.pt-signin-plate`), which keeps Chromium's preserve-3d hit test
            from stopping one element short of the fields. */}
        <div className={cn("pt-signin-slot hero-plate-enter hero-enter-plate", entered && "is-in")}>
          <main data-theme="dark" className="pt-signin-plate tilt-plate">
            <span aria-hidden="true" className="hero-plate-glare" />
            <span aria-hidden="true" className="hero-beam-edge" />
            <div className="relative">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

/** The hero's split width (`lg`), live — the lanes exist only at and above it. */
function useWide() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = React.useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return wide;
}

/** What the portal is for, shown beside the form where there is room for it.
 *  Four of the ⓘ's six rows; the ⓘ keeps the full list and the access note. */
const POINTS: [(props: { size?: number }) => React.ReactElement, string][] = [
  [ShipIcon, "portal.signin.feature.track"],
  [DocIcon, "portal.signin.feature.documents"],
  [WalletIcon, "portal.signin.feature.pay"],
  [ChatIcon, "portal.signin.feature.chat"],
];

/**
 * Light or dark, for the portal behind the door. The label names what a press
 * will DO ("Switch to dark mode"), so the icon is the state and the name is
 * the action — the pattern `components/site/theme-toggle.tsx` uses.
 */
function ThemeSwitch() {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<"light" | "dark">(() => resolvePortalTheme());
  const next = mode === "dark" ? "light" : "dark";
  const Icon = mode === "dark" ? SunIcon : MoonIcon;
  const label = mode === "dark" ? t("portal.signin.themeLight") : t("portal.signin.themeDark");
  return (
    <button
      type="button"
      className="pt-glass-chip !h-9 !w-9 !justify-center !p-0"
      aria-label={label}
      title={label}
      onClick={() => {
        setPortalTheme(next);
        setMode(next);
      }}
    >
      <Icon size={18} />
    </button>
  );
}

function FeatureList() {
  const { t } = useTranslation();
  const rows: [React.ReactNode, string][] = [
    [<ShipIcon key="s" />, "portal.signin.feature.track"],
    [<DocIcon key="d" />, "portal.signin.feature.documents"],
    [<UploadIcon key="u" />, "portal.signin.feature.send"],
    [<WalletIcon key="w" />, "portal.signin.feature.pay"],
    [<ChatIcon key="c" />, "portal.signin.feature.chat"],
    [<UsersIcon key="t" />, "portal.signin.feature.team"],
  ];
  return (
    <div className="grid gap-1">
      <ul className="grid gap-1">
        {rows.map(([icon, key]) => (
          <li key={key} className="flex items-center gap-4 py-2">
            <span className="pt-icon-disc">{icon}</span>
            <span className="text-[0.95rem] text-foreground">{t(key)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-2xl bg-[var(--pt-soft)] p-4 text-sm text-muted-foreground">{t("portal.signin.accessNote")}</p>
    </div>
  );
}

export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const next = useNext();
  const [known, setKnown] = React.useState<KnownPerson | null>(() => portalSession.known());
  const [email, setEmail] = React.useState(() => known?.email || "");
  const [step, setStep] = React.useState<Step>("email");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [trust, setTrust] = React.useState(() => isPhone() || !!known);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [canPasskey, setCanPasskey] = React.useState(false);
  const [resendIn, setResendIn] = React.useState(0);

  React.useEffect(() => {
    void deviceCanUsePasskey().then(setCanPasskey);
  }, []);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  // A person already signed in who lands here goes straight in.
  React.useEffect(() => {
    if (portalSession.access()) navigate(next, { replace: true });
  }, [navigate, next]);

  const offerPasskey = canPasskey && !!known && known.passkeys.length > 0 && known.email === email;

  async function finish(tokens: Tokens) {
    portalSession.store(tokens);
    let company: string | null = null;
    try {
      const me = await portalMe();
      company = me.company ? me.company.name : null;
    } catch {
      /* class D, best-effort — the greeting can wait for the next visit */
    }
    if (trust) {
      portalSession.remember({
        email: tokens.portal_user.email,
        firstName: firstNameOf(tokens.portal_user.full_name),
        company,
        ...(tokens.credential_id ? { passkeys: [...new Set([...(known?.passkeys || []), tokens.credential_id])] } : {}),
      });
    }
    navigate(next, { replace: true, state: { justSignedIn: true, trusted: trust } });
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const sendCode = () =>
    run("code", async () => {
      await portalRequestCode(email.trim());
      setStep("code");
      setCode("");
      setResendIn(30);
    });

  const verify = (value: string) =>
    run("verify", async () => {
      await finish(await portalVerifyCode(email.trim(), value, trust));
    });

  const signInWithPassword = () =>
    run("password", async () => {
      await finish(await portalLogin(email.trim(), password, trust));
    });

  const passkey = () =>
    run("passkey", async () => {
      try {
        const options = await portalPasskeyLoginOptions(known?.email || null, known?.passkeys || []);
        const assertion = await signWithPasskey(options);
        await finish(await portalPasskeyLoginVerify(assertion, String(options._challengeToken || ""), true));
      } catch (e) {
        if (isCancel(e)) return;
        // The server no longer knows this device's key: forget it here too, so
        // the next visit does not lead with a button that cannot work.
        if ((e as { code?: string }).code === "PASSKEY_REVOKED" && known) {
          known.passkeys.forEach((p) => portalSession.dropPasskey(p));
          setKnown(portalSession.known());
        }
        throw e;
      }
    });

  const forgot = () =>
    run("forgot", async () => {
      await portalForgot(email.trim());
      setStep("forgotSent");
    });

  const notYou = () => {
    portalSession.clear({ forget: true });
    setKnown(null);
    setEmail("");
    setStep("email");
    setError(null);
  };

  const bio = biometricKind();
  const BioIcon = bio === "face" ? FaceIdIcon : FingerprintIcon;
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const keepMe = (
    <div className="mt-6 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{t("portal.signin.keep")}</p>
        <p className="text-xs text-muted-foreground">{t("portal.signin.keepHint")}</p>
      </div>
      <Switch checked={trust} onChange={setTrust} label={t("portal.signin.keep")} />
    </div>
  );

  const errorLine = error ? (
    <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
      {error}
    </p>
  ) : null;

  return (
    <SignInFrame>
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validEmail) void sendCode();
          }}
        >
          {known ? (
            <div className="flex items-center gap-4">
              <Avatar name={known.firstName} email={known.email} size={56} />
              <div className="min-w-0">
                <h1 className="pt-display text-[1.7rem]">
                  {known.firstName ? t("portal.signin.welcomeBackNamed", { name: known.firstName }) : t("portal.signin.welcomeBack")}
                </h1>
                <p className="truncate text-sm text-muted-foreground">{known.company || known.email}</p>
              </div>
            </div>
          ) : (
            <>
              <h1 className="pt-display text-[2rem]">{t("portal.signin.title")}</h1>
              <p className="mt-1 text-[0.95rem] text-muted-foreground">{t("portal.signin.sub")}</p>
            </>
          )}

          {known ? null : (
            <div className="mt-6">
              <label htmlFor="pt-email" className="pt-label">
                {t("portal.signin.email")}
              </label>
              <input
                id="pt-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="pt-field"
                placeholder={t("portal.signin.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="mt-6 grid gap-3">
            {offerPasskey ? (
              <button type="button" className="pt-btn pt-btn-primary pt-btn-block hero-shimmer" onClick={() => void passkey()} disabled={!!busy}>
                <Busy busy={busy === "passkey"}>
                  <BioIcon size={22} />
                </Busy>
                {t(`portal.signin.bio.${bio}`)}
              </button>
            ) : null}
            <button
              type="submit"
              className={cn("pt-btn pt-btn-block", offerPasskey ? "pt-btn-soft" : "pt-btn-primary hero-shimmer")}
              disabled={!validEmail || !!busy}
            >
              <Busy busy={busy === "code"}>{offerPasskey ? <MailIcon size={20} /> : null}</Busy>
              {offerPasskey ? t("portal.signin.emailMeCode") : t("portal.signin.continue")}
              {!offerPasskey && busy !== "code" ? <ArrowRightIcon size={20} /> : null}
            </button>
            <button type="button" className="pt-btn pt-btn-ghost pt-btn-block" onClick={() => setStep("password")} disabled={!validEmail || !!busy}>
              <KeyIcon size={19} />
              {t("portal.signin.usePassword")}
            </button>
          </div>
          {errorLine}
          {known ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <button type="button" className="font-semibold text-primary-ink underline-offset-4 hover:underline" onClick={notYou}>
                {t("portal.signin.notYou", { email: known.email })}
              </button>
            </p>
          ) : null}
          {keepMe}
        </form>
      ) : null}

      {step === "code" ? (
        <div>
          <BackLink onClick={() => setStep("email")} />
          <h1 className="pt-display mt-3 text-[1.8rem]">{t("portal.signin.checkEmail")}</h1>
          <p className="mt-1 text-[0.95rem] text-muted-foreground">{t("portal.signin.codeSent", { email: email.trim() })}</p>
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (v.length === 6) void verify(v);
            }}
            disabled={busy === "verify"}
          />
          {errorLine}
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              className="font-semibold text-primary-ink disabled:text-muted-foreground"
              disabled={resendIn > 0 || !!busy}
              onClick={() => void sendCode()}
            >
              {resendIn > 0 ? t("portal.signin.resendIn", { s: resendIn }) : t("portal.signin.resend")}
            </button>
            <button type="button" className="font-semibold text-muted-foreground hover:text-foreground" onClick={() => setStep("password")}>
              {t("portal.signin.usePassword")}
            </button>
          </div>
          {busy === "verify" ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="pt-spinner animate-spin" aria-hidden="true" />
              {t("portal.signin.checking")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "password" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void signInWithPassword();
          }}
        >
          <BackLink onClick={() => setStep("email")} />
          <h1 className="pt-display mt-3 text-[1.8rem]">{t("portal.signin.passwordTitle")}</h1>
          <p className="mt-1 truncate text-[0.95rem] text-muted-foreground">{email.trim()}</p>
          <div className="mt-6">
            <PasswordField label={t("portal.signin.password")} value={password} onChange={setPassword} autoFocus invalid={!!error} />
          </div>
          {errorLine}
          <button type="submit" className="pt-btn pt-btn-primary pt-btn-block hero-shimmer mt-6" disabled={!password || !!busy}>
            <Busy busy={busy === "password"}>{null}</Busy>
            {t("portal.signin.signIn")}
          </button>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <button type="button" className="font-semibold text-primary-ink" onClick={() => void forgot()} disabled={!!busy}>
              {t("portal.signin.forgot")}
            </button>
            <button type="button" className="font-semibold text-muted-foreground hover:text-foreground" onClick={() => void sendCode()} disabled={!!busy}>
              {t("portal.signin.emailMeCode")}
            </button>
          </div>
          {keepMe}
        </form>
      ) : null}

      {step === "forgotSent" ? (
        <div className="text-center">
          <span className="pt-icon-disc mx-auto" data-tone="ok" style={{ width: 64, height: 64, borderRadius: 22 }}>
            <MailIcon size={28} />
          </span>
          <h1 className="pt-display mt-4 text-[1.7rem]">{t("portal.signin.checkEmail")}</h1>
          <p className="mt-2 text-[0.95rem] text-muted-foreground">{t("portal.signin.resetSent")}</p>
          <button type="button" className="pt-btn pt-btn-soft pt-btn-block mt-6" onClick={() => setStep("email")}>
            {t("portal.signin.back")}
          </button>
        </div>
      ) : null}
    </SignInFrame>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClick} className="-ml-2 inline-flex items-center gap-1 rounded-xl px-2 py-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
      <ChevronLeftIcon size={18} />
      {t("portal.signin.back")}
    </button>
  );
}

