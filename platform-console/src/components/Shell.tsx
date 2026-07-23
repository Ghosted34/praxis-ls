import { type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { clearSession, session } from "@/lib/api";
import { initials } from "@/lib/format";
import { useToast } from "@/components/Toast";

const TABS = [
  { to: "/overview", label: "Overview" },
  { to: "/tenants", label: "Tenants" },
  { to: "/plans", label: "Plans" },
  { to: "/catalogue", label: "Catalogue" },
  { to: "/audit", label: "Audit" },
  { to: "/support", label: "Support" },
];

export function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { toast } = useToast();
  const u = session.user;

  const signOut = () => {
    clearSession();
    toast("Signed out");
    nav("/login");
  };

  return (
    <>
      <div className="topbar">
        <div className="mark">
          <div className="glyph">P</div>
          <div>
            Praxis Console
            <small>Platform · Root Admin</small>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="grow" />
        <div className="row" style={{ gap: 12 }}>
          <div style={{ textAlign: "right", lineHeight: 1.15 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{u?.full_name || u?.email || "—"}</div>
            <div className="muted" style={{ fontSize: 11 }}>{u?.role || ""}</div>
          </div>
          <div className="avatar" title={u?.email || ""}>{initials(u?.full_name, u?.email)}</div>
          <button className="btn ghost sm" onClick={signOut}>Sign out</button>
        </div>
      </div>
      <div className="main">{children}</div>
    </>
  );
}
