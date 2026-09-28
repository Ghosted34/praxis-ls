/**
 * Signing in to the portal.
 *
 * ── THE BRIEF ──────────────────────────────────────────────────────────────
 *
 * Beautiful, and almost no words (owner, portal redesign): the tenant's own
 * photograph behind a frosted card, one field, one big button. Everything the
 * old screen said in paragraphs — what the portal is for, who issues access —
 * is behind the ⓘ for whoever wants it.
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
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { getLang, setLang } from "@/lib/i18n";
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
import { BrandMark, SignInScene, useSignInPhoto } from "../ui/brand";
import { Avatar, InfoButton, PasswordField, Switch, errorText, Busy } from "../ui/kit";
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

/** The frame every sign-in step sits in: photo, veil, logo, card. */
export function SignInFrame({ children, info = true }: { children: React.ReactNode; info?: boolean }) {
  const photo = useSignInPhoto();
  const { t } = useTranslation();
  const lang = getLang();
  return (
    <div className="pt-signin">
      {photo ? <img className="pt-signin-photo" src={photo} alt="" /> : <SignInScene />}
      <div className="pt-signin-veil" aria-hidden="true" />
      <header className="flex items-center justify-between gap-3 px-5 pt-[calc(env(safe-area-inset-top)+18px)] md:px-10 md:pt-8">
        <BrandMark onDark className="max-h-9" />
        <div className="flex items-center gap-2">
          <div className="flex gap-1" role="group" aria-label={t("portal.account.language")}>
            {(["en", "fr"] as const).map((l) => (
              <button key={l} type="button" className="pt-glass-chip" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {info ? (
            <InfoButton onDark label={t("portal.signin.whatsInside")} title={t("portal.signin.whatsInside")}>
              <FeatureList />
            </InfoButton>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 flex-col justify-end md:flex-row md:items-center md:justify-between md:gap-10 md:px-10 lg:px-20">
        <p className="pt-display max-w-xl px-6 pb-6 text-[2.05rem] text-[var(--hero-foreground)] [text-shadow:0_2px_24px_rgb(0_0_0/0.35)] md:p-0 md:text-[2.75rem] lg:text-[3.4rem]">
          {t("portal.signin.tagline")}
        </p>
        <main className="pt-glass w-full rounded-t-[30px] px-6 pb-[calc(env(safe-area-inset-bottom)+26px)] pt-7 md:w-[440px] md:shrink-0 md:rounded-[30px] md:p-9">
          {children}
        </main>
      </div>
    </div>
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
              <button type="button" className="pt-btn pt-btn-primary pt-btn-block" onClick={() => void passkey()} disabled={!!busy}>
                <Busy busy={busy === "passkey"}>
                  <BioIcon size={22} />
                </Busy>
                {t(`portal.signin.bio.${bio}`)}
              </button>
            ) : null}
            <button
              type="submit"
              className={cn("pt-btn pt-btn-block", offerPasskey ? "pt-btn-soft" : "pt-btn-primary")}
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
          <button type="submit" className="pt-btn pt-btn-primary pt-btn-block mt-6" disabled={!password || !!busy}>
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

/**
 * Six boxes, one value. Typing advances, backspace retreats, and pasting the
 * whole code — or the phone offering it from the email (autocomplete
 * "one-time-code") — fills every box at once and submits.
 */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  React.useEffect(() => {
    refs.current[Math.min(value.length, 5)]?.focus();
    // Only on mount: moving focus on every keystroke is the handler's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    refs.current[Math.min(clean.length, 5)]?.focus();
  };

  return (
    <div className="pt-otp mt-6" role="group" aria-label={t("portal.signin.codeLabel")}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t("portal.signin.digit", { n: i + 1 })}
          maxLength={i === 0 ? 6 : 1}
          disabled={disabled}
          value={d.trim()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) return set(v); // a paste or autofill into one box
            const arr = value.split("");
            arr[i] = v;
            set(arr.join("").slice(0, i + 1) + (v ? value.slice(i + 1) : ""));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i].trim() && i > 0) {
              e.preventDefault();
              set(value.slice(0, i - 1));
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            set(e.clipboardData.getData("text"));
          }}
        />
      ))}
    </div>
  );
}
