/**
 * Face ID / fingerprint sign-in for the portal — the browser half.
 *
 * The native WebAuthn API with base64url conversion, and nothing else: the
 * server speaks SimpleWebAuthn's JSON shapes (the same ones the staff app's
 * `client/src/lib/webauthn.ts` produces), so this is that file's ceremony
 * trimmed to what the portal needs. No npm dependency — the portal chunk is
 * downloaded on a phone, and the whole job is twenty lines of byte shuffling.
 */

function b64urlToBuf(b64url: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

function hydrate(opt: JsonOptions) {
  const { _challengeToken: _drop, ...o } = opt;
  void _drop;
  const id = (c: Descriptor) => ({ ...c, id: typeof c.id === "string" ? b64urlToBuf(c.id) : c.id });
  if (typeof o.challenge === "string") o.challenge = b64urlToBuf(o.challenge);
  if (o.user && typeof o.user.id === "string") o.user = { ...o.user, id: b64urlToBuf(o.user.id) };
  if (o.allowCredentials) o.allowCredentials = o.allowCredentials.map(id);
  if (o.excludeCredentials) o.excludeCredentials = o.excludeCredentials.map(id);
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

function serialise(cred: PublicKeyCredential) {
  const r = cred.response as unknown as AnyResponse;
  const response: Record<string, unknown> = {};
  if (r.clientDataJSON) response.clientDataJSON = bufToB64url(r.clientDataJSON);
  if (r.attestationObject) response.attestationObject = bufToB64url(r.attestationObject);
  if (r.authenticatorData) response.authenticatorData = bufToB64url(r.authenticatorData);
  if (r.signature) response.signature = bufToB64url(r.signature);
  if (r.userHandle) response.userHandle = bufToB64url(r.userHandle);
  if (typeof r.getTransports === "function") {
    try {
      response.transports = r.getTransports();
    } catch {
      /* @silent:parse — transports are a hint; the credential is fine without them. */
    }
  }
  const out: Record<string, unknown> = { id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type, response };
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

let probe: Promise<boolean> | null = null;
/** Does THIS device have its own screen-lock authenticator? Cached. */
export function deviceCanUsePasskey(): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
      const PKC = window.PublicKeyCredential as unknown as {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      };
      if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
      return PKC.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
    })();
  }
  return probe;
}

/** The person cancelled or let it time out — never an error worth showing. */
export function isCancel(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

/** The words the phone itself uses for its lock. */
export function biometricKind(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): "face" | "touch" | "hello" | "finger" {
  if (/iPhone|iPad/.test(ua)) return "face";
  if (/Macintosh|Mac OS X/.test(ua)) return "touch";
  if (/Windows/.test(ua)) return "hello";
  return "finger";
}

export async function createPasskey(options: Record<string, unknown>) {
  const publicKey = hydrate(options as JsonOptions) as unknown as PublicKeyCredentialCreationOptions;
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
  return serialise(cred);
}

export async function signWithPasskey(options: Record<string, unknown>) {
  const publicKey = hydrate(options as JsonOptions) as unknown as PublicKeyCredentialRequestOptions;
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
  return serialise(cred);
}
