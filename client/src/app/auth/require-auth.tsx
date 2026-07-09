import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { Spinner } from "@/components/ui/states";

/** Gate for protected routes: waits for boot, redirects to /login if anonymous. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  if (status === "anon") return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}
