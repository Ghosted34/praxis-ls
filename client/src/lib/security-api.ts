/**
 * Self-service security calls (MFA/TOTP + Quick PIN devices) against the tenant
 * auth routes. Login-time PIN sign-in + MFA verify live in auth-context; this is
 * the signed-in management surface used by the My Security screen.
 */
import { tenant } from "./api-client";

/**
 * Change your own password. Needs the current one — a live session is not proof
 * enough on the server, deliberately. Distinct from the admin route
 * (`POST /users/:id/password`, behind the IAM grant) and from the mailed
 * recovery link (`/auth/forgot-password` → `/reset-password`), which is the
 * route for someone who can't sign in at all.
 */
export const changePassword = (currentPassword: string, newPassword: string) =>
  tenant<{ changed: boolean; sessions_signed_out: number }>(
    "/auth/change-password",
    {
      method: "POST",
      // Default 401-refresh-and-retry left ON: a form the user spent a minute
      // filling in is exactly when the access token expires, and the server
      // answers a WRONG current password with 403, never 401 — so the retry path
      // can only ever be about the session, not about the credential.
      body: { current_password: currentPassword, new_password: newPassword },
    },
  );

export type TotpSetup = { secret: string; otpauth_url: string };
export const setupTotp = () =>
  tenant<TotpSetup>("/auth/2fa/setup", { method: "POST" });
export const enableTotp = (code: string) =>
  tenant<{ is_2fa_enabled: boolean }>("/auth/2fa/enable", {
    method: "POST",
    body: { code },
  });
export const disableTotp = (code: string) =>
  tenant<{ is_2fa_enabled: boolean }>("/auth/2fa/disable", {
    method: "POST",
    body: { code },
  });

export type PinDeviceRow = {
  device_id: string;
  label?: string | null;
  status: string;
  created_at: string;
  last_used_at?: string | null;
};
export const listPinDevices = () => tenant<PinDeviceRow[]>("/auth/pin/devices");
export const revokePinDevice = (deviceId: string) =>
  tenant<{ revoked: boolean }>(`/auth/pin/devices/${deviceId}`, {
    method: "DELETE",
  });
