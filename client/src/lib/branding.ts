import { tenant } from "./api-client";

export type Branding = {
  name: string | null;
  primary: string | null;
  primaryForeground: string | null;
  logoUrl: string | null;
};

/** Public — resolved by Host, no auth. Used to brand the login pre-auth. */
export const fetchBranding = () => tenant<Branding>("/branding", { auth: false });

/** Gated (MOD-70 edit). Upserts only the provided fields; returns the merged result. */
export const saveBranding = (patch: Partial<Branding>) =>
  tenant<Branding>("/branding", { method: "PUT", body: patch });

/** Gated (MOD-70 edit). Uploads a base64 image data URL to file storage; returns
 *  its public /media URL. Persist it with saveBranding(). */
export const uploadLogo = (dataUrl: string) =>
  tenant<{ logoUrl: string }>("/branding/logo", { method: "POST", body: { dataUrl } });
