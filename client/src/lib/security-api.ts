/**
 * Self-service security calls (MFA/TOTP + Quick PIN devices) against the tenant
 * auth routes. Login-time PIN sign-in + MFA verify live in auth-context; this is
 * the signed-in management surface used by the My Security screen.
 */
import { tenant } from "./api-client";

export type TotpSetup = { secret: string; otpauth_url: string };
export const setupTotp = () => tenant<TotpSetup>("/auth/2fa/setup", { method: "POST" });
export const enableTotp = (code: string) =>
  tenant<{ is_2fa_enabled: boolean }>("/auth/2fa/enable", { method: "POST", body: { code } });
export const disableTotp = (code: string) =>
  tenant<{ is_2fa_enabled: boolean }>("/auth/2fa/disable", { method: "POST", body: { code } });

export type PinDeviceRow = {
  device_id: string;
  label?: string | null;
  status: string;
  created_at: string;
  last_used_at?: string | null;
};
export const listPinDevices = () => tenant<PinDeviceRow[]>("/auth/pin/devices");
export const revokePinDevice = (deviceId: string) =>
  tenant<{ revoked: boolean }>(`/auth/pin/devices/${deviceId}`, { method: "DELETE" });
