/**
 * Vaulted-file plumbing — reading a file off disk on its way IN, and opening a
 * stored one on its way OUT.
 *
 * Both halves existed already, each in one place and nowhere else: `document-
 * view.tsx` could open a vaulted PDF, and the entity dossier could upload one.
 * Neither could do the other, and no other screen could do either — which is why
 * a client or supplier KYC document had no way to receive a scan at all, and why
 * a scan attached to a corporate entity could never be looked at again.
 *
 * The upload itself is `masterdata-api.uploadVaultDocument` (POST /documents,
 * MOD-64). What lives here is everything around it that has no business being
 * re-typed per screen: the browser-side file read, the size/type guard that
 * turns a doomed 25 MB upload into an instant message, and the auth-gated
 * download — a plain `<a href>` cannot carry the bearer token, so the bytes are
 * fetched and handed to the tab as a blob URL.
 */
import { tokenStore } from "./token-store";
import { ApiError } from "./api-client";

/**
 * What the file picker offers for a scan.
 *
 * A subset of what the vault stores (it also takes csv/txt/docx/xlsx): a scanned
 * certificate is a PDF or a photograph, and widening the picker only invites
 * someone to file a spreadsheet as their tax clearance.
 */
export const SCAN_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

/** Mirrors MAX_BYTES in document_vault.service.js. Checked here so a too-large
 *  file is refused before it is base64-inflated and pushed over the wire. */
export const SCAN_MAX_BYTES = 25 * 1024 * 1024;

/** Human-readable size, for the message when a file is over the limit. */
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Refuse what the vault would refuse, before uploading it. Returns an error
 * message, or null when the file is acceptable.
 */
export function scanFileProblem(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > SCAN_MAX_BYTES) {
    return `That file is ${mb(file.size)} — the limit is ${mb(SCAN_MAX_BYTES)}. Scan at a lower resolution or split it.`;
  }
  // Some browsers report an empty type for an unknown extension; the API does
  // the authoritative check, so only an outright mismatch is rejected here.
  if (file.type && !SCAN_ACCEPT.split(",").includes(file.type.toLowerCase())) {
    return "Attach a PDF or an image (PNG, JPEG or WebP).";
  }
  return null;
}

/**
 * Read a picked file as the base64 data URL the vault upload endpoint expects.
 *
 * Rejects with `ApiError` despite never touching the network: `errMsg` — what
 * every screen renders a caught error through — passes the message of an
 * `ApiError` to the operator and replaces anything else with "Something went
 * wrong." A file the browser could not read has a cause worth naming.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError("FILE_READ_FAILED", "Could not read that file.", 0));
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch a vaulted document with the session's credentials and open it in a new
 * tab. Used by the document viewer for a signed copy, and by every scan
 * attachment for the file behind it.
 *
 * The blob URL is revoked on a delay rather than immediately: the new tab has to
 * finish loading from it first.
 */
export async function openVaultDoc(id: string): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`/api/tenant/documents/${id}/download`, {
    headers: { "X-Praxis-Env": tokenStore.getEnv(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    // ApiError so `errMsg` shows these rather than flattening them to
    // "Something went wrong." — a 409 in particular is not a fault to report,
    // it means the file is not there yet.
    const message =
      res.status === 409 ? "This document hasn't been rendered yet."
        : res.status === 404 ? "That file is no longer in the vault."
          : "Download failed.";
    throw new ApiError("DOWNLOAD_FAILED", message, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
