import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { session } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { Login } from "@/features/Login";
import { Overview } from "@/features/Overview";
import { Tenants } from "@/features/Tenants";
import { TenantDetail } from "@/features/TenantDetail";
import { Plans } from "@/features/Plans";
import { Catalogue } from "@/features/Catalogue";
import { Audit } from "@/features/Audit";
import { Support } from "@/features/Support";

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
      <Route path="/catalogue" element={<RequireAuth><Catalogue /></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
      <Route path="/support" element={<RequireAuth><Support /></RequireAuth>} />
      <Route path="*" element={<Navigate to={session.token ? "/overview" : "/login"} replace />} />
    </Routes>
  );
}
