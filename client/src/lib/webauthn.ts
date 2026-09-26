/**
 * Client WebAuthn (passkey) helpers — the ONE implementation.
 *
 * Uses the native WebAuthn API directly (no extra npm dep) with base64url
 * helpers. The server speaks SimpleWebAuthn's JSON shapes.
 *
 * There used to be two copies of the sign-in ceremony (here and in
 * auth-context), and they had drifted: the one the sign-in screen actually used
 * never recorded that the device holds a passkey, so a passkey sign-in did not
 * make the passkey the device's first choice next time. auth-context now calls
 * `passkeyAssertion` and owns only what happens with the tokens.
 */
import { tenant } from "./api-client";
import { passkeyDeviceStore } from "./passkey-devices";

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

type Descriptor = { id: string | ArrayBuffer; type: string; transports?: string[] };
type JsonOptions = {
  challenge: string | ArrayBuffer;
  user?: { id: string | ArrayBuffer; name?: string; displayName?: string };
  allowCredentials?: Descriptor[];
  excludeCredentials?: Descriptor[];
  _challengeToken?: string;
  [k: string]: unknown;
};

function toPublicKeyOptions(opt: JsonOptions) {
  // Server sends JSON with base64url strings; hydrate to ArrayBuffers. The
  // server-private `_challengeToken` is not a WebAuthn member and is dropped.
  const { _challengeToken: _drop, ...o } = opt;
  void _drop;
  if (typeof o.challenge === "string") o.challenge = b64urlToBuf(o.challenge);
  if (o.user && typeof o.user.id === "string") o.user = { ...o.user, id: b64urlToBuf(o.user.id) };
  if (o.allowCredentials) o.allowCredentials = o.allowCredentials.map((c) => ({ ...c, id: typeof c.id === "string" ? b64urlToBuf(c.id) : c.id }));
  if (o.excludeCredentials) o.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: typeof c.id === "string" ? b64urlToBuf(c.id) : c.id }));
  return o;
}

type AnyResponse = {
  clientDataJSON?: ArrayBuffer;
  attestationObject?: ArrayBuffer;
  authenticatorData?: ArrayBuffer;
  signature?: ArrayBuffer;
  userHandle?: ArrayBuffer | null;
  getTransports?: () => string[];
};

function fromCredential(cred: PublicKeyCredential) {
  const resp = cred.response as unknown as AnyResponse;
  const response: Record<string, unknown> = {};
  if (resp.clientDataJSON) response.clientDataJSON = bufToB64url(resp.clientDataJSON);
  if (resp.attestationObject) response.attestationObject = bufToB64url(resp.attestationObject);
  if (resp.authenticatorData) response.authenticatorData = bufToB64url(resp.authenticatorData);
  if (resp.signature) response.signature = bufToB64url(resp.signature);
  if (resp.userHandle) response.userHandle = bufToB64url(resp.userHandle);
  if (typeof resp.getTransports === "function") {
    try {
      response.transports = resp.getTransports();
    } catch {
      /* @silent:parse — transports are a hint; the credential is fine without them. */
    }
  }
  const out: Record<string, unknown> = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response,
  };
  const ext = (cred as unknown as { getClientExtensionResults?: () => Record<string, unknown> }).getClientExtensionResults;
  if (typeof ext === "function") {
    try {
      out.clientExtensionResults = ext.call(cred);
    } catch {
      /* @silent:parse */
    }
  }
  return out;
}

/**
 * A WebAuthn failure, named for what the person should be told.
 *
 * The old handler stamped EVERY failure `NOT_ALLOWED` ("cancelled"), so a
 * device that already held a passkey — the browser's InvalidStateError — told
 * the user they had cancelled, and they tried again, and were told again.
 */
export class PasskeyError extends Error {
  code: string;
  constructor(code: string, message: string, name?: string) {
    super(message);
    this.code = code;
    this.name = name || "PasskeyError";
  }
}

function mapDomError(e: unknown, phase: "create" | "get"): PasskeyError {
  const name = (e as { name?: string } | null)?.name || "";
  const message = (e as { message?: string } | null)?.message || "";
  if (name === "InvalidStateError" && phase === "create")
    return new PasskeyError("PASSKEY_ALREADY_ON_DEVICE", "This device already has a passkey for your account.", name);
  if (name === "SecurityError")
    return new PasskeyError("PASSKEY_INSECURE_CONTEXT", "Passkeys need a secure (https) connection to this workspace.", name);
  if (name === "NotSupportedError")
    return new PasskeyError("WEBAUTHN_NOT_SUPPORTED", "This device can't create a passkey for this browser.", name);
  // NotAllowedError is a cancel, a timeout, or a browser that wanted a tap
  // first — all "the person did not complete it", none a fault.
  return new PasskeyError("NOT_ALLOWED", message || "Passkey cancelled", name || "NotAllowedError");
}

export function isPasskeyCancel(e: unknown): boolean {
  const x = e as { code?: string; name?: string } | null;
  return !!x && (x.code === "NOT_ALLOWED" || x.name === "NotAllowedError" || x.name === "AbortError");
}

export type PasskeyCredential = {
  credential_id: string;
  label?: string | null;
  created_at: string;
  last_used_at?: string | null;
  transports?: string[] | null;
  device_type?: "singleDevice" | "multiDevice" | null;
  backed_up?: boolean | null;
};

/** Whether the current browser claims to support passkeys at all. */
export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

let platformProbe: Promise<boolean> | null = null;
/**
 * Does THIS device have its own passkey authenticator (Touch ID, Face ID,
 * Windows Hello, Android screen lock)? Cached. A probe that refuses to answer
 * is not a "no" — only a resolved `false` is.
 */
export function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!platformProbe) {
    platformProbe = (async () => {
      if (!isPasskeySupported()) return false;
      const PKC = window.PublicKeyCredential as unknown as {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      };
      if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return true;
      const [probe] = await Promise.allSettled([PKC.isUserVerifyingPlatformAuthenticatorAvailable()]);
      return probe.status === "fulfilled" ? !!probe.value : true;
    })();
  }
  return platformProbe;
}

/** A readable name for this device: "Chrome on macOS", "Safari on iPhone". */
export function deviceLabel(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return os || browser || "This device";
}

/** What the OS will actually ask for, in the words the person knows it by. */
export function biometricName(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  if (/iPhone/.test(ua)) return "Face ID";
  if (/iPad/.test(ua)) return "Touch ID or Face ID";
  if (/Macintosh|Mac OS X/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/Android/.test(ua)) return "your fingerprint";
  return "your passkey";
}

/**
 * The passkey ceremony up to — not including — the server's verification.
 *
 * `credentialIds` are the passkeys THIS device registered for the account. With
 * them the server scopes the ceremony to exactly those, on this device's own
 * authenticator, and the OS goes straight to the fingerprint / face. Without
 * them the browser offers the discoverable passkeys it holds. `email` binds the
 * ceremony to that account: another person's passkey cannot answer it.
 */
export async function passkeyAssertion(opts: { email?: string | null; credentialIds?: string[] }) {
  if (!isPasskeySupported())
    throw new PasskeyError("WEBAUTHN_NOT_SUPPORTED", "Passkeys aren't supported in this browser.");
  const email = opts.email ? opts.email.trim().toLowerCase() : undefined;
  const ids = (opts.credentialIds || []).filter(Boolean);
  const options = await tenant<JsonOptions>("/auth/passkey/login/options", {
    method: "POST",
    auth: false,
    retry: false,
    body: { ...(email ? { email } : {}), ...(ids.length ? { credential_ids: ids } : {}) },
  });
  let cred: PublicKeyCredential | null = null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: toPublicKeyOptions(options) as unknown as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw mapDomError(e, "get");
  }
  if (!cred) throw new PasskeyError("NOT_ALLOWED", "No passkey selected");
  return { assertion: fromCredential(cred), challengeToken: String(options._challengeToken || "") };
}

/**
 * Register a passkey on THIS device for the signed-in account.
 *
 * `email` is the account the credential is being added to — a parameter, not a
 * lookup, so the device registry reflects the SESSION's identity. The new
 * credential's id is recorded against it, which is what lets sign-in go
 * straight to this device's passkey.
 *
 * `currentPassword` is for a session that is no longer fresh: the server asks
 * for it (REAUTH_REQUIRED) before handing out a permanent way in.
 */
export async function registerPasskey(opts: {
  email: string | null | undefined;
  label?: string | null;
  currentPassword?: string | null;
}): Promise<{ credential_id: string; label?: string | null }> {
  if (!isPasskeySupported())
    throw new PasskeyError("WEBAUTHN_NOT_SUPPORTED", "Passkeys aren't supported in this browser.");

  const label = (opts.label || "").trim() || deviceLabel();
  const options = await tenant<JsonOptions>("/auth/passkey/register/options", {
    method: "POST",
    body: { label, ...(opts.currentPassword ? { current_password: opts.currentPassword } : {}) },
  });

  let cred: PublicKeyCredential | null = null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: toPublicKeyOptions(options) as unknown as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
  } catch (e) {
    const err = mapDomError(e, "create");
    // The authenticator refused because it already holds one of this account's
    // passkeys. That IS a fact about this device: record it, so sign-in leads
    // with the passkey it evidently has.
    if (err.code === "PASSKEY_ALREADY_ON_DEVICE" && opts.email) passkeyDeviceStore.add(opts.email);
    throw err;
  }
  if (!cred) throw new PasskeyError("NOT_ALLOWED", "Passkey creation was cancelled");

  const r = await tenant<{ credential_id: string; label?: string | null }>("/auth/passkey/register/verify", {
    method: "POST",
    body: { attestation: fromCredential(cred), label, challengeToken: options._challengeToken },
  });
  // Recorded only after the server verified the attestation — a credential the
  // server refused is not one this browser can sign in with.
  if (opts.email) passkeyDeviceStore.add(opts.email, r.credential_id);
  return r;
}

export const listPasskeys = () => tenant<PasskeyCredential[]>("/auth/passkey/credentials");
export const deletePasskey = (id: string) =>
  tenant<{ deleted: boolean }>(`/auth/passkey/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
