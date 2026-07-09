import { Link } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const CARDS = [
  { to: "/security/permissions", title: "Permission matrix", desc: "Grant roles access to modules." },
  { to: "/security/roles", title: "Roles", desc: "Default + tenant-specific roles." },
  { to: "/security/users", title: "Users", desc: "Manage tenant users." },
  { to: "/audit", title: "Audit ledger", desc: "Immutable activity trail." },
  { to: "/notifications", title: "Notifications", desc: "Security-critical alerts." },
  { to: "/workflows", title: "Workflows", desc: "Approval chains." },
];

export function DashboardPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome{user?.display_name ? `, ${user.display_name}` : ""}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 0 foundations are live. Start with the Security &amp; Access screens.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.to} to={c.to}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-base">{c.title}</CardTitle>
                <CardDescription>{c.desc}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-primary">Open →</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
