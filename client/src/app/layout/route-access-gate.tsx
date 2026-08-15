/**
 * The gate between a URL and the screen behind it.
 *
 * WHY IT IS ONE COMPONENT AND NOT SIXTY GUARDS. There are sixty-odd routed
 * screens and one `<Outlet/>`. A per-screen guard is sixty places to forget,
 * and the one that gets forgotten is the one that renders someone else's ledger
 * for the half-second before its own fetch 403s.
 *
 * IT RENDERS INSTEAD OF, NOT AROUND. That is the property that makes the
 * friendly refusal safe. The gated screen never mounts, so its `useQuery` calls
 * never run, so no protected payload is ever requested — let alone received.
 * The page in `features/access/no-access-page.tsx` is not a nicer rendering of a
 * 403; it exists in place of the request that would have produced one. The
 * server's own refusal is unchanged and unconditional either way.
 *
 * WHILE THE ANSWER IS UNKNOWN it renders the same `PageSkeleton` the route's own
 * Suspense boundary would be showing anyway. Rendering the screen optimistically
 * would mean firing reads that may 403; rendering nothing would collapse the
 * content column, which is the shift the rest of this work exists to remove.
 * This is a first-login-only state — every later load resolves from the cache
 * before the first paint.
 */
import * as React from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { canOpenRoute, gatingModulesForPath } from "@/lib/route-access";
import { NoAccessPage } from "@/features/access/no-access-page";
import { useShell } from "./shell-context";

export function RouteAccessGate({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const { access, resolved } = useShell();
  const wanted = React.useMemo(
    () => gatingModulesForPath(pathname),
    [pathname],
  );

  if (!resolved) return <PageSkeleton />;
  if (canOpenRoute(access, pathname)) return <>{children}</>;
  // `canOpenRoute` only ever refuses once it has found at least one real module
  // key, so `wanted[0]` is present here — this is narrowing rather than a
  // fallback for a missing value. It is the module the page NAMES; for a hub
  // the user is missing all of them, and naming the first reads better than
  // reciting four.
  return <NoAccessPage moduleKey={wanted[0]} pathname={pathname} />;
}
