import { NavLink } from "react-router-dom";

/**
 * Shared sub-navigation for the ops screens.
 *
 * One tab per §3 sub-section (health, backup, uptime, maintenance, comms calls,
 * usage) rather than one enormous page: they are read at different moments —
 * health when something looks wrong, backups when planning or after a failure
 * alert, uptime for a report, maintenance before a deploy, call health when
 * somebody reports that a call went badly — and stacking them all in one route
 * means every visit pays for six sets of queries to read one.
 */
const TABS = [
  { to: "/ops", label: "Health", end: true },
  { to: "/ops/backups", label: "Backup & restore" },
  { to: "/ops/uptime", label: "Uptime" },
  { to: "/ops/maintenance", label: "Maintenance" },
  { to: "/ops/comms", label: "Comms calls" },
  { to: "/ops/usage", label: "Usage & limits" },
];

export function OpsNav() {
  return (
    <nav className="row" style={{ gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => "btn sm " + (isActive ? "" : "ghost")}
          style={{ textDecoration: "none" }}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
