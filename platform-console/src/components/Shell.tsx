import { type ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { clearSession, session, can } from "@/lib/api";
import { initials } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { NotificationBell } from "@/components/NotificationBell";

type Tab = { to: string; label: string; cap?: string };
// `cap` (when set) hides the tab unless the signed-in role has that capability.
// Primary tabs stay inline; the rest fold into a "More" menu so the bar doesn't
// overflow as sections grow.
const PRIMARY: Tab[] = [
  { to: "/overview", label: "Overview" },
  { to: "/tenants", label: "Tenants" },
  { to: "/plans", label: "Plans" },
  { to: "/users", label: "Users", cap: "users.read" },
  { to: "/integrations", label: "Integrations" },
];
const MORE: Tab[] = [
  { to: "/error-center", label: "Errors", cap: "errors.read" },
  { to: "/roles", label: "Roles", cap: "roles.read" },
  { to: "/catalogue", label: "Catalogue" },
  { to: "/audit", label: "Audit" },
  { to: "/support", label: "Support" },
];

export function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { toast } = useToast();
  const u = session.user;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTabs = MORE.filter((t) => !t.cap || can(t.cap));

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
          {PRIMARY.filter((t) => !t.cap || can(t.cap)).map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {t.label}
            </NavLink>
          ))}
          {moreTabs.length > 0 && (
            <div
              style={{ position: "relative" }}
              onMouseEnter={() => setMoreOpen(true)}
              onMouseLeave={() => setMoreOpen(false)}
            >
              <button type="button" className="btn ghost sm" onClick={() => setMoreOpen((o) => !o)} style={{ fontWeight: 550 }}>
                More ▾
              </button>
              {moreOpen && (
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, minWidth: 168,
                    background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10,
                    padding: 6, boxShadow: "0 10px 30px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", gap: 2,
                  }}
                >
                  {moreTabs.map((t) => (
                    <NavLink
                      key={t.to}
                      to={t.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) => (isActive ? "active" : "")}
                      style={{ padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 550 }}
                    >
                      {t.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="grow" />
        <div className="row" style={{ gap: 12 }}>
          {/* Not capability-gated: a notification addressed to you is yours,
              and hiding the bell from a role that can still be SENT something
              is how a message goes undelivered with no error anywhere. */}
          <NotificationBell />
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
