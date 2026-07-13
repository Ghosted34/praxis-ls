/**
 * Shared placeholder for menu items whose real screen isn't built yet.
 * The nav (app-shell) and routes (app.tsx) reference every screen in the
 * target IA map (see doc/FE_IA_HANDOFF.md); the ones without a page yet route
 * here so nothing 404s. Title/group are derived from the current path.
 */
import { useLocation, Link } from "react-router-dom";

function titleCase(segment: string): string {
  const s = segment.replace(/-/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Derive a "Group / Screen" label from the pathname. */
function labelsFromPath(pathname: string): { group?: string; screen: string } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { screen: "Home" };
  if (parts.length === 1) return { screen: titleCase(parts[0]) };
  return { group: titleCase(parts[0]), screen: titleCase(parts[parts.length - 1]) };
}

export function ComingSoon({ title }: { title?: string }) {
  const { pathname } = useLocation();
  const { group, screen } = labelsFromPath(pathname);
  const heading = title || screen;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="lux-card p-8 text-center">
        {group && <p className="micro mb-2">{group}</p>}
        <h1 className="font-display text-2xl tracking-tight">{heading}</h1>
        <span className="status st-warn mt-4 inline-flex">Coming soon</span>
        <p className="mt-4 text-sm text-muted-foreground">
          This screen is on the roadmap but hasn't been built yet. The backend module exists
          in most cases &mdash; see <code className="text-xs">doc/FE_IA_HANDOFF.md</code> for the
          full screen map and any backend gaps.
        </p>
        <p className="mt-6 text-sm">
          <Link to="/" className="text-primary underline-offset-4 hover:underline">
            &larr; Back to Control Tower
          </Link>
        </p>
      </div>
    </div>
  );
}

export default ComingSoon;
