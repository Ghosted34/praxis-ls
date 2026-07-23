import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { platform, saveSession, session, setBase } from "@/lib/api";
import { Button, Field } from "@/components/ui";
import { useToast } from "@/components/Toast";

export function Login() {
  const nav = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [base, setBaseVal] = useState(session.base);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const clean = base.trim().replace(/\/$/, "");
    setBase(clean);
    try {
      const data = await platform.login(email.trim(), password);
      saveSession(clean, data.access_token, data.user);
      toast("Welcome, " + (data.user.full_name || data.user.email));
      nav("/overview");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="bd" style={{ padding: 22 }}>
          <div className="login-head">
            <div className="glyph">P</div>
            <h2 style={{ fontSize: 18 }}>Platform Console</h2>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>Praxis-internal · Root Admin sign-in</div>
          </div>
          <form className="stack" style={{ gap: 13 }} onSubmit={submit}>
            <Field label="Email">
              <input type="email" autoComplete="username" placeholder="admin@praxisls.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <details style={{ fontSize: 12 }}>
              <summary className="muted" style={{ cursor: "pointer" }}>API endpoint</summary>
              <input style={{ marginTop: 8 }} value={base} onChange={(e) => setBaseVal(e.target.value)} />
            </details>
            <Button variant="primary" type="submit" loading={busy} style={{ justifyContent: "center", marginTop: 4 }}>Sign in</Button>
            {err && <div className="pill bad" style={{ justifyContent: "center" }}>{err}</div>}
          </form>
          <div className="banner info" style={{ margin: "16px 0 0" }}>
            You see tenant&nbsp;<b>metadata &amp; health</b>&nbsp;only — never tenant business data.
          </div>
        </div>
      </div>
    </div>
  );
}
