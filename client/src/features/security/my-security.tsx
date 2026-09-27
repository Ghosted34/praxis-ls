/**
 * My Security (self-service) — a passkey for THIS device (first, because it is
 * the fastest and safest way in and the one the lock screen leads with), your
 * password, an authenticator app, and a device-bound Quick PIN. Talks to the
 * tenant auth routes: /auth/passkey/*, /auth/change-password,
 * /auth/2fa/setup|enable|disable, /auth/pin/register|devices.
 *
 * Adding a way in (a passkey, a PIN) on a session that is no longer fresh asks
 * for the password first — the server answers REAUTH_REQUIRED and `withReauth`
 * asks, once, in a branded dialog. Removing one asks for confirmation, and
 * names what will stop working.
 */
import { pageShell } from "@/lib/layout";
import { dateFmt, fmtRelative } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import { ApiError, tenantWithProgress } from "@/lib/api-client";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";
import { PIN_LENGTH } from "@/components/ui/pin-input";
import { pinStore } from "@/lib/pin-store";
import { cn } from "@/lib/cn";
import { useSearchParams } from "react-router-dom";
import {
  changePassword,
  setupTotp,
  enableTotp,
  disableTotp,
  listPinDevices,
  revokePinDevice,
  type TotpSetup,
  type PinDeviceRow,
} from "@/lib/security-api";
import {
  registerPasskey,
  listPasskeys,
  deletePasskey,
  biometricName,
  deviceLabel,
  isPasskeyCancel,
  isPasskeySupported,
  platformAuthenticatorAvailable,
  type PasskeyCredential,
} from "@/lib/webauthn";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { quickPin } from "@praxis/shared";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { FingerprintIcon } from "@/features/auth/sign-in-panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { SettingsCard, Field } from "@/components/settings/controls";

type Msg = { kind: "ok" | "err"; text: string } | null;

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "INVALID_2FA_CODE")
      return "That code isn't right — check your authenticator and retry.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function MySecurityPage() {
  const { user, registerPin, patchUser } = useAuth();

  // --- Profile picture ---
  const [avatarMsg, setAvatarMsg] = React.useState<Msg>(null);

  /**
   * Through the upload engine. The "avatar" profile squares the image with an
   * attention crop — which lands on the face far more reliably than the centre
   * crop the CSS was doing — and runs the enhancement chain, because profile
   * photos are taken on phones in offices and are routinely under-exposed.
   */
  const avatar = useUpload<{ avatar_url: string }>({
    profile: "avatar",
    maxBytes: 1024 * 1024,
    send: async (file, ctx) =>
      tenantWithProgress<{ avatar_url: string }>(
        "/auth/avatar",
        { data_url: await fileToDataUrl(file) },
        ctx.onProgress,
      ),
    onAllComplete: ([res]) => {
      if (!res) return;
      patchUser({ avatar_url: res.avatar_url });
      setAvatarMsg({ kind: "ok", text: "Profile picture updated." });
    },
  });

  const avatarItem = avatar.items[0] ?? null;
  const avatarBusy =
    avatarItem?.state === "uploading" || avatarItem?.state === "compressing";

  React.useEffect(() => {
    if (avatarItem?.state === "error" && avatarItem.error) {
      setAvatarMsg({ kind: "err", text: avatarItem.error });
    }
  }, [avatarItem?.state, avatarItem?.error]);

  // --- Password ---
  //
  // The rules are the server's (shared/security/password-policy.js: 12 chars,
  // upper + lower + digit + symbol, then a breach check). They are mirrored here
  // as a live checklist rather than a single "password too weak" after the round
  // trip — the server stays the authority, this just stops the user guessing
  // which of five rules they missed. The breach check is NOT mirrored: it needs
  // the HIBP call, so it can only ever be reported by the server.
  const [currentPw, setCurrentPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwMsg, setPwMsg] = React.useState<Msg>(null);

  const pwRules = [
    { label: "At least 12 characters", ok: newPw.length >= 12 },
    {
      label: "An uppercase and a lowercase letter",
      ok: /[A-Z]/.test(newPw) && /[a-z]/.test(newPw),
    },
    { label: "A number", ok: /[0-9]/.test(newPw) },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(newPw) },
  ];
  const pwMatches = newPw.length > 0 && newPw === confirmPw;
  const pwReady =
    pwRules.every((r) => r.ok) && pwMatches && currentPw.length > 0;

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwReady) return;
    setPwBusy(true);
    setPwMsg(null);
    try {
      const { sessions_signed_out: signedOut } = await changePassword(
        currentPw,
        newPw,
      );
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwMsg({
        kind: "ok",
        text: signedOut
          ? `Password changed. You're still signed in here; your other ${signedOut === 1 ? "session was" : `${signedOut} sessions were`} signed out.`
          : "Password changed. You're still signed in here.",
      });
    } catch (err) {
      setPwMsg({ kind: "err", text: errText(err) });
    } finally {
      setPwBusy(false);
    }
  }

  // --- MFA ---
  const [setup, setSetup] = React.useState<TotpSetup | null>(null);
  const [enrollCode, setEnrollCode] = React.useState("");
  const [disableCode, setDisableCode] = React.useState("");
  const [mfaBusy, setMfaBusy] = React.useState(false);
  const [mfaMsg, setMfaMsg] = React.useState<Msg>(null);

  async function beginSetup() {
    setMfaBusy(true);
    setMfaMsg(null);
    try {
      setSetup(await setupTotp());
    } catch (e) {
      setMfaMsg({ kind: "err", text: errText(e) });
    } finally {
      setMfaBusy(false);
    }
  }
  async function enable(code: string) {
    setMfaBusy(true);
    setMfaMsg(null);
    try {
      await enableTotp(code.trim());
      setSetup(null);
      setEnrollCode("");
      setMfaMsg({
        kind: "ok",
        text: "Authenticator enabled. You'll be asked for a code at sign-in.",
      });
    } catch (e) {
      setMfaMsg({ kind: "err", text: errText(e) });
    } finally {
      setMfaBusy(false);
    }
  }
  async function disable(code: string) {
    setMfaBusy(true);
    setMfaMsg(null);
    try {
      await disableTotp(code.trim());
      setDisableCode("");
      setMfaMsg({ kind: "ok", text: "Authenticator disabled." });
    } catch (e) {
      setMfaMsg({ kind: "err", text: errText(e) });
    } finally {
      setMfaBusy(false);
    }
  }

  const [confirm, confirmDialog] = useConfirm();
  const [prompt, promptDialog] = usePrompt();
  const email = user?.email ?? "";
  const bio = biometricName();

  /**
   * Adding a way in on a session that is no longer fresh needs the password
   * (server: REAUTH_REQUIRED). One helper, so the passkey and the PIN ask the
   * same question the same way. Resolves null when the person backs out.
   */
  async function withReauth<T>(run: (currentPassword: string | null) => Promise<T>): Promise<T | null> {
    try {
      return await run(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "REAUTH_REQUIRED")) throw e;
      const pw = await prompt({
        title: "Confirm it's you",
        description:
          "You signed in a while ago. Enter your password to add a new way into your account — it stops someone at an unattended desk from adding their own.",
        label: "Current password",
        type: "password",
        confirmLabel: "Confirm",
        trim: false,
        validate: (v) => (v ? null : "Enter your password."),
      });
      if (pw === null) return null;
      return run(pw);
    }
  }

  // --- Quick PIN ---
  const [devices, setDevices] = React.useState<PinDeviceRow[] | null>(null);
  const [pin, setPin] = React.useState("");
  const [pin2, setPin2] = React.useState("");
  const [label, setLabel] = React.useState(() => deviceLabel());
  const [pinBusy, setPinBusy] = React.useState(false);
  const [pinMsg, setPinMsg] = React.useState<Msg>(null);
  const thisDeviceId = email ? pinStore.get(email)?.device_id : null;
  const hasPinHere = !!thisDeviceId && !!devices?.some((d) => d.device_id === thisDeviceId && d.status === "ACTIVE");
  // The shared rule (@praxis/shared quickPin) — the same one the server applies,
  // shown as the user types rather than as a 422 after pressing the button.
  const pinWeak = pin.length === PIN_LENGTH ? quickPin.weakPinReason(pin) : null;
  const pinMismatch = pin2.length === PIN_LENGTH && pin !== pin2;
  const pinReady = pin.length === PIN_LENGTH && !pinWeak && pin === pin2;

  const loadDevices = React.useCallback(() => {
    listPinDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  React.useEffect(() => loadDevices(), [loadDevices]);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!pinReady) return;
    setPinBusy(true);
    setPinMsg(null);
    try {
      const done = await withReauth((pw) => registerPin(pin, label.trim() || null, pw));
      if (!done) return;
      setPin("");
      setPin2("");
      setPinMsg({
        kind: "ok",
        text: hasPinHere
          ? "This device's PIN was changed. The old one no longer works."
          : "Quick PIN is set up on this device. When your session locks, four digits unlock it.",
      });
      loadDevices();
    } catch (err) {
      setPinMsg({ kind: "err", text: errText(err) });
    } finally {
      setPinBusy(false);
    }
  }
  async function onRevoke(d: PinDeviceRow) {
    const here = thisDeviceId === d.device_id;
    const ok = await confirm({
      title: here ? "Turn off Quick PIN on this device?" : `Revoke the Quick PIN on "${d.label || "Unnamed device"}"?`,
      body: here
        ? "You'll sign in here with your passkey or password instead. You can set a new PIN up any time."
        : "That device will stop accepting the PIN straight away. Do this for a device you've lost or no longer use.",
      confirmLabel: here ? "Turn off Quick PIN" : "Revoke PIN",
      destructive: true,
    });
    if (!ok) return;
    try {
      await revokePinDevice(d.device_id);
      if (here && email) pinStore.remove(email);
      setPinMsg({ kind: "ok", text: here ? "Quick PIN is off on this device." : "That device's PIN was revoked." });
      loadDevices();
    } catch (err) {
      setPinMsg({ kind: "err", text: errText(err) });
    }
  }

  // --- Passkey deep link ---
  // The dashboard nudge links here with ?highlight=passkey. Scroll to the card
  // and ring it, so arriving by link SHOWS the location.
  const [searchParams, setSearchParams] = useSearchParams();
  const passkeyCardRef = React.useRef<HTMLDivElement>(null);
  const [passkeyHighlit, setPasskeyHighlit] = React.useState(false);

  React.useEffect(() => {
    if (searchParams.get("highlight") !== "passkey") return;
    const el = passkeyCardRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    setPasskeyHighlit(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("highlight");
      return next;
    }, { replace: true });
    const timer = window.setTimeout(() => setPasskeyHighlit(false), 2600);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams]);

  // --- Passkey ---
  const [passkeys, setPasskeys] = React.useState<PasskeyCredential[] | null>(null);
  const [pkBusy, setPkBusy] = React.useState(false);
  const [pkMsg, setPkMsg] = React.useState<Msg>(null);
  const passkeySupported = typeof window !== "undefined" && isPasskeySupported();
  const [platformOk, setPlatformOk] = React.useState<boolean | null>(null);
  const [deviceVersion, bumpDevice] = React.useReducer((n: number) => n + 1, 0);
  const passkeyHere = React.useMemo(
    () => !!email && passkeyDeviceStore.get(email),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deviceVersion invalidates a localStorage read React cannot track.
    [email, deviceVersion],
  );

  React.useEffect(() => {
    let alive = true;
    void platformAuthenticatorAvailable().then((ok) => alive && setPlatformOk(ok));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The server is the truth about which passkeys exist. A credential this
   * device remembers but the account no longer holds (removed from another
   * session) is forgotten here, so the sign-in and lock screens stop leading
   * with it.
   */
  const loadPasskeys = React.useCallback(() => {
    listPasskeys()
      .then((list) => {
        setPasskeys(list);
        if (!email) return;
        const onServer = new Set(list.map((p) => p.credential_id));
        for (const id of passkeyDeviceStore.ids(email)) if (!onServer.has(id)) passkeyDeviceStore.forgetId(email, id);
        if (list.length === 0) passkeyDeviceStore.remove(email);
        bumpDevice();
      })
      .catch(() => setPasskeys([]));
  }, [email]);
  React.useEffect(() => loadPasskeys(), [loadPasskeys]);

  async function onRegisterPasskey() {
    setPkBusy(true);
    setPkMsg(null);
    try {
      const r = await withReauth((pw) => registerPasskey({ email, label: deviceLabel(), currentPassword: pw }));
      if (!r) return;
      setPkMsg({ kind: "ok", text: `Done — ${bio} now signs you in on this device.` });
      loadPasskeys();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "PASSKEY_ALREADY_ON_DEVICE") {
        setPkMsg({ kind: "ok", text: "This device already has a passkey for your account — you're all set." });
        bumpDevice();
      } else if (isPasskeyCancel(err)) {
        setPkMsg({ kind: "err", text: "Passkey setup was cancelled." });
      } else {
        setPkMsg({ kind: "err", text: errText(err) });
      }
    } finally {
      setPkBusy(false);
    }
  }
  async function onDeletePasskey(c: PasskeyCredential) {
    const here = passkeyDeviceStore.holds(email, c.credential_id);
    const name = c.label || "this passkey";
    const ok = await confirm({
      title: here ? "Remove this device's passkey?" : `Remove the passkey for "${name}"?`,
      body: here
        ? `${bio} will stop signing you in here. Your PIN and password still work, and you can set a passkey up again any time.`
        : "That device will no longer be able to sign you in with it. Do this for a device you've lost or no longer use.",
      confirmLabel: "Remove passkey",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePasskey(c.credential_id);
      if (here) passkeyDeviceStore.forgetId(email, c.credential_id);
      setPkMsg({ kind: "ok", text: "Passkey removed." });
      loadPasskeys();
    } catch (err) {
      setPkMsg({ kind: "err", text: errText(err) });
    }
  }

  const okCls =
    "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm";
  const errCls =
    "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive";

  return (
    <section className={pageShell.wide}>
      {confirmDialog}
      {promptDialog}
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="My security"
        description="How you get into your account: a passkey on this device, a Quick PIN, your password and an authenticator app."
      />
      <HubTabs />

      <div className="mt-2 flex flex-col gap-5">
        {/* Profile picture */}
        <SettingsCard
          title="Profile picture"
          desc="Shown on your account menu across the app."
        >
          <div className="flex items-center gap-4">
            {/* The preview is the picked file the moment it is chosen, falling
                back to the stored avatar. Before this the old picture stayed on
                screen through the whole upload with nothing to say otherwise. */}
            {avatarItem?.previewUrl || user?.avatar_url ? (
              <img
                src={avatarItem?.previewUrl || user?.avatar_url || ""}
                alt="Your avatar"
                className="h-16 w-16 rounded-xl object-cover"
              />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
                {(user?.display_name || user?.email || "?")
                  .charAt(0)
                  .toUpperCase()}
              </span>
            )}
            <div>
              <FilePicker
                variant="inline"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={avatarBusy}
                trigger={
                  <span className="inline-flex h-9 items-center rounded-lg border px-3 text-sm no-underline">
                    {avatarBusy ? "Uploading…" : "Change picture"}
                  </span>
                }
                onPick={(files) => {
                  setAvatarMsg(null);
                  void avatar.pick(files);
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                PNG, JPG, WEBP or GIF, up to 1 MB.
              </p>
              {avatarItem && avatarItem.state !== "idle" && (
                <UploadProgress
                  className="mt-1 max-w-[220px]"
                  state={avatarItem.state}
                  percent={avatarItem.percent}
                  error={avatarItem.error}
                />
              )}
              {avatarMsg && (
                <p
                  className={`mt-1 text-xs ${avatarMsg.kind === "ok" ? "text-[rgb(var(--ok))]" : "text-[rgb(var(--bad))]"}`}
                >
                  {avatarMsg.text}
                </p>
              )}
            </div>
          </div>
        </SettingsCard>

        {/* Passkey — FIRST, because it is the fastest and safest way in and the
            one the lock screen leads with. `highlight=passkey` (the dashboard
            nudge's deep link) scrolls here and rings the card. */}
        <div
          ref={passkeyCardRef}
          className={cn(
            "rounded-2xl transition-shadow motion-reduce:transition-none",
            passkeyHighlit && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <SettingsCard
            title={`Passkey — ${bio === "your passkey" ? "one-touch sign-in" : bio}`}
            desc="One touch signs you in and unlocks your session. It belongs to this device alone — your laptop uses the laptop's, your phone uses the phone's — and there is nothing to type, so nothing to phish."
          >
            {!passkeySupported || platformOk === false ? (
              <p className="text-sm text-muted-foreground">
                This browser or device has no built-in fingerprint, face or Windows Hello sign-in it can use, so it can&apos;t hold a
                passkey. Use your Quick PIN or password here, and set a passkey up on your phone or laptop.
              </p>
            ) : passkeyHere ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-ink">
                  <FingerprintIcon width={24} height={24} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">This device signs you in with {bio}.</p>
                  <p className="text-xs text-muted-foreground">When your session locks, one touch unlocks it.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-ink">
                  <FingerprintIcon width={24} height={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    Set up {bio} on this device
                    <span className="status st-ok !py-0.5 !text-[9px]">recommended</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your session locks every two hours. With a passkey, getting back in is a single touch.
                  </p>
                </div>
                <Button onClick={() => void onRegisterPasskey()} loading={pkBusy}>
                  Set up {bio === "your passkey" ? "a passkey" : bio}
                </Button>
              </div>
            )}

            <div className="mt-5 border-t pt-4">
              <p className="micro mb-2">Your passkeys</p>
              {passkeys === null ? (
                <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
              ) : passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No passkeys yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {passkeys.map((c) => {
                    const here = passkeyDeviceStore.holds(email, c.credential_id);
                    return (
                      <div key={c.credential_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <FingerprintIcon width={18} height={18} className="shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                              <span className="truncate">{c.label || "Passkey"}</span>
                              {here && <span className="status st-ok !py-0.5 !text-[9px]">this device</span>}
                              {c.backed_up && <span className="status st-mute !py-0.5 !text-[9px]">synced</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Added {dateFmt(c.created_at)}
                              {c.last_used_at ? ` · last used ${fmtRelative(c.last_used_at)}` : " · never used"}
                            </div>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => void onDeletePasskey(c)}>
                          Remove
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {pkMsg && (
              <p className={`mt-4 ${pkMsg.kind === "ok" ? okCls : errCls}`} role="status">
                {pkMsg.text}
              </p>
            )}
          </SettingsCard>
        </div>

        {/* Password */}
        <SettingsCard
          title={tr("Password")}
          desc="Change it here whenever you like — you'll need your current one. Your other sessions are signed out; this one stays."
        >
          <form onSubmit={onChangePassword} className="flex flex-col gap-3">
            {/* username hint: gives password managers the account to file the new
                credential under, since there's no email field on this form. */}
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={user?.email ?? ""}
              readOnly
            />
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Current password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
            </div>

            <ul className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5">
              {pwRules.map((r) => (
                <li
                  key={r.label}
                  className={
                    r.ok && newPw ? "text-[rgb(var(--ok))]" : undefined
                  }
                >
                  <span aria-hidden>{r.ok && newPw ? "✓" : "•"}</span> {r.label}
                </li>
              ))}
            </ul>
            {confirmPw.length > 0 && !pwMatches && (
              <p className="text-xs text-[rgb(var(--bad))]">
                The two new passwords don&apos;t match.
              </p>
            )}

            <div>
              <Button type="submit" loading={pwBusy} disabled={!pwReady}>
                Change password
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Can&apos;t remember your current password? Sign out and use
                &ldquo;Forgot password&rdquo; on the sign-in screen — we&apos;ll
                email you a single-use link.
              </p>
            </div>
          </form>

          {pwMsg && (
            <p className={`mt-4 ${pwMsg.kind === "ok" ? okCls : errCls}`}>
              {pwMsg.text}
            </p>
          )}
        </SettingsCard>

        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          {/* MFA */}
          <SettingsCard
            title="Authenticator app (MFA)"
            desc="Time-based codes as a second factor at sign-in."
          >
            {!setup ? (
              <Button onClick={beginSetup} loading={mfaBusy}>
                Set up authenticator
              </Button>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Add this account to your authenticator app — scan the link or
                  enter the key manually, then enter the 6-digit code to
                  confirm.
                </p>
                <Field label="Setup key">
                  <Input
                    readOnly
                    value={setup.secret}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </Field>
                <Field label="otpauth link">
                  <Input
                    readOnly
                    value={setup.otpauth_url}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </Field>
                <Field label="6-digit code from the app">
                  <OtpInput
                    value={enrollCode}
                    onChange={setEnrollCode}
                    onComplete={enable}
                    disabled={mfaBusy}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    onClick={() => enable(enrollCode)}
                    loading={mfaBusy}
                    disabled={enrollCode.length < 6}
                  >
                    Enable
                  </Button>
                  <Button variant="ghost" onClick={() => setSetup(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-5 border-t pt-4">
              <p className="micro mb-2">Already enrolled?</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <OtpInput
                  value={disableCode}
                  onChange={setDisableCode}
                  disabled={mfaBusy}
                />
                <Button
                  variant="outline"
                  onClick={() => disable(disableCode)}
                  disabled={mfaBusy || disableCode.length < 6}
                >
                  Disable MFA
                </Button>
              </div>
            </div>

            {mfaMsg && (
              <p className={`mt-4 ${mfaMsg.kind === "ok" ? okCls : errCls}`}>
                {mfaMsg.text}
              </p>
            )}
          </SettingsCard>

          {/* Quick PIN */}
          <SettingsCard
            title="Quick PIN"
            desc="Four digits that unlock your session on THIS device only. Five wrong tries switch it off."
          >
            <form onSubmit={onRegister} className="flex flex-col gap-3" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={hasPinHere ? `New PIN (${PIN_LENGTH} digits)` : `PIN (${PIN_LENGTH} digits)`}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                    placeholder="••••"
                    aria-invalid={!!pinWeak || undefined}
                  />
                </Field>
                <Field label="Confirm PIN">
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin2}
                    onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                    placeholder="••••"
                    aria-invalid={pinMismatch || undefined}
                  />
                </Field>
              </div>
              {pinWeak && <p className="text-xs text-[rgb(var(--bad))]">{pinWeak}</p>}
              {!pinWeak && pinMismatch && <p className="text-xs text-[rgb(var(--bad))]">The two PINs don&apos;t match.</p>}
              <Field label="Device name">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My laptop" maxLength={80} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={pinBusy} disabled={!pinReady}>
                  {hasPinHere ? "Change this device's PIN" : "Set up Quick PIN here"}
                </Button>
                {hasPinHere && (
                  <span className="text-xs text-muted-foreground">Replaces the PIN on this device — the old one stops working.</span>
                )}
              </div>
            </form>

            <div className="mt-5 border-t pt-4">
              <p className="micro mb-2">Devices with a Quick PIN</p>
              {devices === null ? (
                <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
              ) : devices.filter((d) => d.status === "ACTIVE").length === 0 ? (
                <p className="text-sm text-muted-foreground">No device has a Quick PIN yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {devices
                    .filter((d) => d.status === "ACTIVE")
                    .map((d) => (
                      <div key={d.device_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="truncate">{d.label || "Unnamed device"}</span>
                            {thisDeviceId === d.device_id && (
                              <span className="status st-ok !py-0.5 !text-[9px]">this device</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Added {dateFmt(d.created_at)}
                            {d.last_used_at ? ` · last used ${fmtRelative(d.last_used_at)}` : " · never used"}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => void onRevoke(d)}>
                          {thisDeviceId === d.device_id ? "Turn off" : "Revoke"}
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {pinMsg && (
              <p className={`mt-4 ${pinMsg.kind === "ok" ? okCls : errCls}`} role="status">
                {pinMsg.text}
              </p>
            )}
          </SettingsCard>
        </div>

      </div>
    </section>
  );
}

export default MySecurityPage;
