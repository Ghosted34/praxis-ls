/**
 * Harness for `scripts/dev/render-portal.js` — mounts the REAL VerifyPage
 * against canned API responses so it can be photographed.
 *
 * Nothing here is shipped: the vite config that builds it lives beside this
 * file and is invoked by the dev script, never by `npm run build`. The point is
 * to look at the page, so the component is the real one and only its two
 * outside edges — the API client and the branding context — are stubbed.
 */
import * as React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { VerifyPage } from "@/features/public/verify-page";
import { SignPage } from "@/features/public/sign-page";
import "@fontsource-variable/inter";
import "@/index.css";
import { SCENES, SIGN_SCENES } from "./scenes";

function Frame({ id, caption, children }: { id: string; caption: string; children: React.ReactNode }) {
  return (
    <section data-scene={id} style={{ marginBottom: "48px" }}>
      <p
        style={{
          font: "600 11px/1.4 ui-sans-serif, system-ui",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#6b7280",
          margin: "0 0 8px",
        }}
      >
        {caption}
      </p>
      <div style={{ border: "1px solid #d1d5db", borderRadius: "12px", overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

function Scene({ code, lang }: { code: string; lang: string }) {
  return (
    <MemoryRouter initialEntries={[`/v/${code}?lang=${lang}`]}>
      <Routes>
        <Route path="/v/:code" element={<VerifyPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function SignScene({ token, lang }: { token: string; lang: string }) {
  return (
    <MemoryRouter initialEntries={[`/sign/${token}?lang=${lang}`]}>
      <Routes>
        <Route path="/sign/:token" element={<SignPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/*
 * The app's stylesheet pins `html, body { height: 100%; overflow: hidden }` —
 * the shell owns scrolling, so the DOCUMENT never scrolls. That is right for
 * the app and wrong for a canvas of six stacked pages: the document reported
 * itself as exactly one viewport tall, and a full-page screenshot came back
 * cropped to the first scene with no error.
 *
 * Harness-only, and undone nowhere else.
 */
const unpin = document.createElement("style");
unpin.textContent = "html, body { height: auto !important; overflow: visible !important; }";
document.head.appendChild(unpin);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ padding: "24px", maxWidth: "760px", margin: "0 auto" }}>
    {SCENES.map((s) => (
      <Frame key={s.id} id={s.id} caption={s.caption}>
        <Scene code={s.code} lang={s.id === "fr" ? "fr" : "en"} />
      </Frame>
    ))}
    {SIGN_SCENES.map((s) => (
      <Frame key={s.id} id={s.id} caption={s.caption}>
        <SignScene token={s.token} lang={s.id === "sign-fr" ? "fr" : "en"} />
      </Frame>
    ))}
  </div>,
);
