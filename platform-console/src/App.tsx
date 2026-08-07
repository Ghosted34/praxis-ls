import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { session } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { Login } from "@/features/Login";
import { Overview } from "@/features/Overview";
import { Tenants } from "@/features/Tenants";
import { TenantDetail } from "@/features/TenantDetail";
import { Plans } from "@/features/Plans";
import { Users } from "@/features/Users";
import { Roles } from "@/features/Roles";
import { Catalogue } from "@/features/Catalogue";
import { Audit } from "@/features/Audit";
import { Support } from "@/features/Support";
import { Integrations } from "@/features/Integrations";
import { ErrorCenter } from "@/features/ErrorCenter";
import { ErrorCenterSettings } from "@/features/ErrorCenterSettings";

function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation();
  if (!session.token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/overview" element={<RequireAuth><Overview /></RequireAuth>} />
      <Route path="/tenants" element={<RequireAuth><Tenants /></RequireAuth>} />
      <Route path="/tenants/:slug" element={<RequireAuth><TenantDetail /></RequireAuth>} />
      <Route path="/plans" element={<RequireAuth><Plans /></RequireAuth>} />
      <Route path="/users" element={<RequireAuth><Users /></RequireAuth>} />
      <Route path="/roles" element={<RequireAuth><Roles /></RequireAuth>} />
      <Route path="/catalogue" element={<RequireAuth><Catalogue /></RequireAuth>} />
      <Route path="/integrations" element={<RequireAuth><Integrations /></RequireAuth>} />
      {/* AI vendor keys now live under Integrations → AI providers. */}
      <Route path="/ai-vendors" element={<Navigate to="/integrations" replace />} />
      {/* Error Command Center. The spec names the route /admin/error-center;
          on this app the host IS admin (platform-console is host-gated to
          admin.praxisls.com), so the /admin prefix is redundant here and the
          canonical path is /error-center. The prefixed form is kept as a
          redirect so links written against the spec still resolve. */}
      <Route path="/error-center" element={<RequireAuth><ErrorCenter /></RequireAuth>} />
      <Route path="/error-center/settings" element={<RequireAuth><ErrorCenterSettings /></RequireAuth>} />
      <Route path="/admin/error-center" element={<Navigate to="/error-center" replace />} />
      <Route path="/admin/error-center/settings" element={<Navigate to="/error-center/settings" replace />} />
      <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
      <Route path="/support" element={<RequireAuth><Support /></RequireAuth>} />
      <Route path="*" element={<Navigate to={session.token ? "/overview" : "/login"} replace />} />
    </Routes>
  );
}
