/**
 * The API client, replaced for the preview. Aliased in by
 * `scripts/portal-preview/vite.config.ts`; never reachable from the app build.
 *
 * It keys on the verification code in the path, which is the only thing
 * VerifyPage puts on the wire — so six independent pages render on one canvas
 * without the component knowing it is in a harness.
 */
import { SCENES } from "./scenes";

class StubApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function tenant<T>(path: string): Promise<T> {
  const code = decodeURIComponent(String(path).split("/v/")[1] || "").split("?")[0];
  const scene = SCENES.find((s) => s.code === code);
  if (!scene || scene.status !== 200) throw new StubApiError(404, "No verification matches that code.");
  return scene.body as T;
}

export const api = tenant;
export const tenantPaged = tenant;
export const platform = tenant;
export const SESSION_ENDED_EVENT = "praxis:session-ended";
export const NETWORK_DOWN = "NETWORK_DOWN";
export const isNetworkError = () => false;
export async function download() { /* not reachable from this page */ }
export const tenantDownload = download;
