/**
 * Client WebAuthn (passkey) helpers.
 *
 * Uses the native WebAuthn API directly (no extra npm dep) with base64url
 * helpers so we don't need @simplewebauthn/browser for the login modal.
 * Server speaks the same shape SimpleWebAuthn expects (challenge, rp, user
 * as base64url). When the backend hasn't been deployed yet the fetch 404s
 * and we surface a friendly error rather than a stack trace.
 */
import { tenant } from "./api-client";
import { tokenStore } from "./token-store";
import { lastSessionStore } from "./last-session";

function b64urlToBuf(b64url: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toPublicKeyOptions(opt: any): PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions {
  // Server sends JSON with base64url strings; we hydrate to ArrayBuffers
  if (opt.challenge) opt.challenge = b64urlToBuf(opt.challenge);
  if (opt.user && opt.user.id) opt.user.id = b64urlToBuf(opt.user.id);
  if (opt.allowCredentials) {
    for (const c of opt.allowCredentials) c.id = b64urlToBuf(c.id);
  }
  if (opt.excludeCredentials) {
    for (const c of opt.excludeCredentials) c.id = b64urlToBuf(c.id);
  }
  return opt;
}

function fromCredential(cred: PublicKeyCredential): any {
  const rawId = bufToB64url(cred.rawId);
  const resp: any = (cred as any).response;
  const out: any = {
    id: (cred as any).id,
    rawId,
    type: cred.type,
    response: {},
  };
  if (resp.attestationObject) out.response.attestationObject = bufToB64url(resp.attestationObject);
  if (resp.clientDataJSON) out.response.clientDataJSON = bufToB64url(resp.clientDataJSON);
  if (resp.authenticatorData) out.response.authenticatorData = bufToB64url(resp.authenticatorData);
  if (resp.signature) out.response.signature = bufToB64url(resp.signature);
  if (resp.userHandle !== undefined && resp.userHandle !== null) {
    out.response.userHandle = resp.userHandle ? bufToB64url(resp.userHandle) : null;
  }
  if ((cred as any).getClientExtensionResults) {
    try {
      out.clientExtensionResults = (cred as any).getClientExtensionResults();
    } catch { /* @silent:storage */ }
  }
  return out;
}

export type PasskeyCredential = {
  credential_id: string;
  label?: string | null;
  created_at: string;
  last_used_at?: string | null;
  transports?: string[];
};

/**
 * Authenticate with a passkey (Face ID / Touch ID / security key).
 * If email is provided we scope the allowCredentials list; without it we
 * use discoverable (resident) credentials — the user picks from the OS sheet.
 */
export async function authenticateWithPasskey(email?: string): Promise<void> {
  if (!window.PublicKeyCredential) throw Object.assign(new Error("Passkeys aren't supported in this browser."), { code: "WEBAUTHN_NOT_SUPPORTED" });

  // 1) Ask server for assertion options
  const options: any = await tenant<any>("/auth/passkey/login/options", {
    method: "POST",
    auth: false,
    body: email ? { email: email.trim().toLowerCase() } : {},
  });

  const publicKey = toPublicKeyOptions(options) as PublicKeyCredentialRequestOptions;

  let cred: PublicKeyCredential | null = null;
  try {
    cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  } catch (e: any) {
    // User cancelled — surface as NOT_ALLOWED so caller can stay quiet
    const err: any = new Error(e?.message || "Passkey cancelled");
    err.name = e?.name || "NotAllowedError";
    err.code = "NOT_ALLOWED";
    throw err;
  }
  if (!cred) throw Object.assign(new Error("No passkey selected"), { code: "NOT_ALLOWED" });

  const assertion = fromCredential(cred);

  // 2) Verify with server — returns tokens on success
  const r = await tenant<{ access_token: string; refresh_token: string; user: { email: string; display_name?: string; avatar_url?: string | null; user_id: string } }>(
    "/auth/passkey/login/verify",
    {
      method: "POST",
      auth: false,
      body: { email: email ? email.trim().toLowerCase() : undefined, assertion, challengeToken: (options as any)._challengeToken, _challenge: (options as any)._challenge },
    },
  );

  // Persist tokens + last session like the other auth paths do (auth-context will also hydrate via /me)
  if (r && r.access_token) {
    tokenStore.setAccess(r.access_token);
    tokenStore.setPersist(true);
    // tokenStore.setRefresh will be called via api-client? Actually r contains refresh_token
    // We mimic auth-context.acceptTokens shape
    // Use raw tokenStore to avoid importing auth internals
    // Persist refresh token through the correct store
    const { tokenStore: ts } = await import("./token-store");
    ts.setRefresh(r.refresh_token);
    try {
      localStorage.setItem("praxis.user", JSON.stringify(r.user));
    } catch { /* @silent:storage */ }
    lastSessionStore.fromUser(r.user);
    // Also hit /auth/me to hydrate full profile (best-effort)
    try {
      const fresh = await tenant<any>("/auth/me");
      try {
        localStorage.setItem("praxis.user", JSON.stringify(fresh));
      } catch { /* @silent:storage */ }
      lastSessionStore.fromUser(fresh);
    } catch { /* @silent:storage */ }
  }
}

/**
 * Register a new passkey (requires an authenticated session, like PIN).
 * Returns the new credential id.
 */
export async function registerPasskey(label?: string | null): Promise<{ credential_id: string }> {
  if (!window.PublicKeyCredential) throw Object.assign(new Error("Passkeys aren't supported in this browser."), { code: "WEBAUTHN_NOT_SUPPORTED" });

  const options = await tenant<any>("/auth/passkey/register/options", {
    method: "POST",
    body: label ? { label } : {},
  });

  const publicKey = toPublicKeyOptions(options) as PublicKeyCredentialCreationOptions;

  let cred: PublicKeyCredential | null = null;
  try {
    cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  } catch (e: any) {
    const err: any = new Error(e?.message || "Passkey creation cancelled");
    err.name = e?.name || "NotAllowedError";
    err.code = "NOT_ALLOWED";
    throw err;
  }
  if (!cred) throw new Error("Passkey creation failed");

  const attestation = fromCredential(cred);
  const r = await tenant<{ credential_id: string }>("/auth/passkey/register/verify", {
    method: "POST",
    body: { attestation, label: label ?? null, challengeToken: (options as any)._challengeToken, _challenge: (options as any)._challenge },
  });
  return r;
}

export const listPasskeys = () => tenant<PasskeyCredential[]>("/auth/passkey/credentials");
export const deletePasskey = (id: string) =>
  tenant<{ deleted: boolean }>(`/auth/passkey/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Whether the current browser claims to support passkeys */
export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}
