/**
 * My Security (self-service) — change your password, enrol MFA (authenticator
 * app) and manage device-bound Quick PIN. Talks to the tenant auth routes:
 *   /auth/change-password, /auth/2fa/setup|enable|disable, /auth/pin/register|devices.
 * The backend doesn't report current MFA status (no /me), so both the enrol and
 * disable flows are shown with guidance.
 */
import { pageShell } from "@/lib/layout";
import { dateDmy } from "@/lib/format";
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
  isPasskeySupported,
  type PasskeyCredential,
} from "@/lib/webauthn";
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

  // --- Quick PIN ---
  const [devices, setDevices] = React.useState<PinDeviceRow[] | null>(null);
  const [pin, setPin] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [pinBusy, setPinBusy] = React.useState(false);
  const [pinMsg, setPinMsg] = React.useState<Msg>(null);
  const thisDeviceId = user ? pinStore.get(user.email)?.device_id : null;

  const loadDevices = React.useCallback(() => {
    listPinDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  React.useEffect(() => loadDevices(), [loadDevices]);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
      setPinMsg({ kind: "err", text: `PIN must be ${PIN_LENGTH} digits.` });
      return;
    }
    setPinBusy(true);
    setPinMsg(null);
    try {
      await registerPin(pin, label.trim() || null);
      setPin("");
      setLabel("");
      setPinMsg({
        kind: "ok",
        text: "Quick PIN registered on this device. You can now PIN-in from the sign-in screen.",
      });
      loadDevices();
    } catch (e) {
      setPinMsg({ kind: "err", text: errText(e) });
    } finally {
      setPinBusy(false);
    }
  }
  async function onRevoke(deviceId: string) {
    try {
      await revokePinDevice(deviceId);
      if (user && thisDeviceId === deviceId) pinStore.remove(user.email);
      loadDevices();
    } catch (e) {
      setPinMsg({ kind: "err", text: errText(e) });
    }
  }

  // --- Passkey ---
  const [passkeys, setPasskeys] = React.useState<PasskeyCredential[] | null>(null);
  const [pkLabel, setPkLabel] = React.useState("");
  const [pkBusy, setPkBusy] = React.useState(false);
  const [pkMsg, setPkMsg] = React.useState<Msg>(null);
  const passkeySupported = typeof window !== "undefined" && isPasskeySupported();

  const loadPasskeys = React.useCallback(() => {
    listPasskeys()
      .then(setPasskeys)
      .catch(() => setPasskeys([]));
  }, []);
  React.useEffect(() => loadPasskeys(), [loadPasskeys]);

  async function onRegisterPasskey(e: React.FormEvent) {
    e.preventDefault();
    setPkBusy(true);
    setPkMsg(null);
    try {
      await registerPasskey(pkLabel.trim() || null);
      setPkLabel("");
      setPkMsg({ kind: "ok", text: "Passkey added. You can now use Face ID / Touch ID to sign in." });
      loadPasskeys();
    } catch (err: any) {
      if (err && (err.name === "NotAllowedError" || err.code === "NOT_ALLOWED")) {
        setPkMsg({ kind: "err", text: "Passkey creation was cancelled." });
      } else {
        setPkMsg({ kind: "err", text: errText(err) });
      }
    } finally {
      setPkBusy(false);
    }
  }
  async function onDeletePasskey(id: string) {
    try {
      await deletePasskey(id);
      loadPasskeys();
      setPkMsg({ kind: "ok", text: "Passkey removed." });
    } catch (e) {
      setPkMsg({ kind: "err", text: errText(e) });
    }
  }

  const okCls =
    "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm";
  const errCls =
    "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive";

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="My security"
        description="Your password, an authenticator app, a device-bound Quick PIN and passkeys (Face ID / Touch ID) — all for your own account."
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
            desc="A fast, device-bound unlock. Registers only on this device."
          >
            <form onSubmit={onRegister} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={`New PIN (${PIN_LENGTH} digits)`}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))
                    }
                    placeholder="••••"
                  />
                </Field>
                <Field label="Device label (optional)">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="My laptop"
                  />
                </Field>
              </div>
              <div>
                <Button type="submit" loading={pinBusy}>
                  Register this device
                </Button>
              </div>
            </form>

            <div className="mt-5 border-t pt-4">
              <p className="micro mb-2">Registered devices</p>
              {devices === null ? (
                <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
              ) : devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Quick PIN devices yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {devices.map((d) => (
                    <div
                      key={d.device_id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {d.label || "Unnamed device"}
                          {thisDeviceId === d.device_id && (
                            <span className="status st-ok !py-0.5 !text-[9px]">
                              this device
                            </span>
                          )}
                          {d.status && d.status !== "ACTIVE" && (
                            <span className="status st-mute !py-0.5 !text-[9px]">
                              {d.status.toLowerCase()}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Added {dateDmy(d.created_at)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevoke(d.device_id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pinMsg && (
              <p className={`mt-4 ${pinMsg.kind === "ok" ? okCls : errCls}`}>
                {pinMsg.text}
              </p>
            )}
          </SettingsCard>
        </div>

        {/* Passkey */}
        <SettingsCard
          title="Passkey (Face ID / Touch ID)"
          desc="Passwordless sign-in with your device's biometrics or security key. Works on this device and anywhere your passkey is synced."
        >
          {!passkeySupported ? (
            <p className="text-sm text-muted-foreground">
              Passkeys need a secure browser with WebAuthn support (HTTPS + platform authenticator). Your current browser doesn't support them — use Quick PIN or password, and add a passkey from a supported device.
            </p>
          ) : (
            <form onSubmit={onRegisterPasskey} className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="Label (optional)">
                    <Input value={pkLabel} onChange={(e) => setPkLabel(e.target.value)} placeholder="My MacBook" />
                  </Field>
                </div>
                <Button type="submit" loading={pkBusy}>
                  Add passkey
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">You'll be asked by your device to confirm with Face ID, Touch ID, Windows Hello, or your security key.</p>
            </form>
          )}

          <div className="mt-5 border-t pt-4">
            <p className="micro mb-2">Registered passkeys</p>
            {passkeys === null ? (
              <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
            ) : passkeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No passkeys yet. Add one above to enable passwordless sign-in.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {passkeys.map((c) => (
                  <div key={c.credential_id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.label || "Passkey"}</div>
                      <div className="text-xs text-muted-foreground">
                        Added {dateDmy(c.created_at)}
                        {c.last_used_at ? ` • last used ${dateDmy(c.last_used_at)}` : ""}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => onDeletePasskey(c.credential_id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pkMsg && <p className={`mt-4 ${pkMsg.kind === "ok" ? okCls : errCls}`}>{pkMsg.text}</p>}
        </SettingsCard>
      </div>
    </section>
  );
}

export default MySecurityPage;
