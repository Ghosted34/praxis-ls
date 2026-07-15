/**
 * My Security (self-service) — enrol MFA (authenticator app) and manage
 * device-bound Quick PIN. Talks to the tenant auth routes:
 *   /auth/2fa/setup|enable|disable, /auth/pin/register|devices.
 * The backend doesn't report current MFA status (no /me), so both the enrol and
 * disable flows are shown with guidance.
 */
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import { ApiError } from "@/lib/api-client";
import { pinStore } from "@/lib/pin-store";
import {
  setupTotp,
  enableTotp,
  disableTotp,
  listPinDevices,
  revokePinDevice,
  type TotpSetup,
  type PinDeviceRow,
} from "@/lib/security-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { SettingsCard, Field } from "@/components/settings/controls";

type Msg = { kind: "ok" | "err"; text: string } | null;

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "INVALID_2FA_CODE") return "That code isn't right — check your authenticator and retry.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function MySecurityPage() {
  const { user, registerPin } = useAuth();

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
      setMfaMsg({ kind: "ok", text: "Authenticator enabled. You'll be asked for a code at sign-in." });
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
    if (!/^\d{4,8}$/.test(pin)) {
      setPinMsg({ kind: "err", text: "PIN must be 4–8 digits." });
      return;
    }
    setPinBusy(true);
    setPinMsg(null);
    try {
      await registerPin(pin, label.trim() || null);
      setPin("");
      setLabel("");
      setPinMsg({ kind: "ok", text: "Quick PIN registered on this device. You can now PIN-in from the sign-in screen." });
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

  const okCls = "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm";
  const errCls = "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive";

  return (
    <section className="mx-auto max-w-2xl animate-fade-in">
      <h1 className="font-display text-2xl tracking-tight">My security</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Protect your account with an authenticator app and a device-bound Quick PIN.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        {/* MFA */}
        <SettingsCard title="Authenticator app (MFA)" desc="Time-based codes as a second factor at sign-in.">
          {!setup ? (
            <Button onClick={beginSetup} loading={mfaBusy}>
              Set up authenticator
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Add this account to your authenticator app — scan the link or enter the key manually, then enter the
                6-digit code to confirm.
              </p>
              <Field label="Setup key">
                <Input readOnly value={setup.secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              </Field>
              <Field label="otpauth link">
                <Input readOnly value={setup.otpauth_url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              </Field>
              <Field label="6-digit code from the app">
                <OtpInput value={enrollCode} onChange={setEnrollCode} onComplete={enable} disabled={mfaBusy} />
              </Field>
              <div className="flex gap-2">
                <Button onClick={() => enable(enrollCode)} loading={mfaBusy} disabled={enrollCode.length < 6}>
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
              <OtpInput value={disableCode} onChange={setDisableCode} disabled={mfaBusy} />
              <Button variant="outline" onClick={() => disable(disableCode)} disabled={mfaBusy || disableCode.length < 6}>
                Disable MFA
              </Button>
            </div>
          </div>

          {mfaMsg && <p className={`mt-4 ${mfaMsg.kind === "ok" ? okCls : errCls}`}>{mfaMsg.text}</p>}
        </SettingsCard>

        {/* Quick PIN */}
        <SettingsCard title="Quick PIN" desc="A fast, device-bound unlock. Registers only on this device.">
          <form onSubmit={onRegister} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New PIN (4–8 digits)">
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="••••"
                />
              </Field>
              <Field label="Device label (optional)">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My laptop" />
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
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Quick PIN devices yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {devices.map((d) => (
                  <div key={d.device_id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {d.label || "Unnamed device"}
                        {thisDeviceId === d.device_id && <span className="status st-ok !py-0.5 !text-[9px]">this device</span>}
                        {d.status && d.status !== "ACTIVE" && (
                          <span className="status st-mute !py-0.5 !text-[9px]">{d.status.toLowerCase()}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Added {new Date(d.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => onRevoke(d.device_id)}>
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pinMsg && <p className={`mt-4 ${pinMsg.kind === "ok" ? okCls : errCls}`}>{pinMsg.text}</p>}
        </SettingsCard>
      </div>
    </section>
  );
}

export default MySecurityPage;
