/**
 * The branding context, replaced for the preview. The real one fetches the
 * tenant's branding on mount; the portal only reads the name, so the stub is
 * the smallest thing that shape can be.
 */
export const useBranding = () => ({
  branding: { name: "SMART LOGISTICS SARL" },
});

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
