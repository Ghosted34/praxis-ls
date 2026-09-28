import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "@/lib/i18n";
import { BrandingProvider } from "@/app/branding";
import { PortalError } from "@/lib/portal-api";
import { PortalApp } from "./portal-app";
import { parseAmount } from "./lib/numbers";
import { errorText } from "./ui/kit";
import { en } from "./portal-copy";

/**
 * The client portal, rendered for real against a stubbed API.
 *
 * What is pinned here is what the redesign PROMISED, not how it is built:
 * sign-in starts from an email (a code, a password or Face ID come after it);
 * Home puts what we are waiting for first, each with its own verb; a colleague
 * given only Billing never reaches a shipment, even by typing the URL; and an
 * error reads in the client's language from its code, never as the server's
 * English message.
 */

type Json = Record<string, unknown> | unknown[];

const ME = (scope: "ALL" | "OPERATIONS" | "BILLING" = "ALL") => ({
  portal_user: { portal_user_id: "u1", email: "marie@acme.cm", full_name: "Marie Nguema" },
  grants: {
    CLIENT: { allowed: true, client_id: "c1", expires_at: null, access_scope: scope, is_client_admin: true },
    INVESTOR: { allowed: false, client_id: null, expires_at: null },
    AUDITOR: { allowed: false, client_id: null, expires_at: null },
  },
  company: { client_id: "c1", name: "Acme Trading", legal_name: null, language: "en" },
});

const REQUEST = (over: Record<string, unknown> = {}) => ({
  client_request_id: "r1",
  dossier_id: "d1",
  dossier_ref: "PRX-1",
  source: "RULE",
  kind: "DOCUMENT",
  doc_type_code: "PACKING_LIST",
  doc_type_en: "Packing list",
  doc_type_fr: "Liste de colisage",
  title: null,
  note: null,
  due_on: null,
  status: "OPEN",
  answer_text: null,
  answer_doc_id: null,
  answer_doc_name: null,
  answered_at: null,
  review_note: null,
  created_at: "2026-09-01T10:00:00Z",
  ...over,
});

const HOME = {
  company: ME().company,
  scope: "ALL",
  shipments: { active_count: 0, items: [] },
  requests: {
    open_count: 2,
    in_review_count: 0,
    items: [REQUEST(), REQUEST({ client_request_id: "r2", kind: "INFO", doc_type_code: null, doc_type_en: null, title: "Consignee tax number" })],
  },
  billing: { totals: [], due_count: 0, overdue_count: 0, in_review_count: 0, next_due: null },
};

let routes: Record<string, (init?: RequestInit) => [number, Json]> = {};
const calls: string[] = [];

function stubApi(signedIn: boolean, extra: typeof routes = {}) {
  routes = {
    "/branding": () => [200, { data: { name: "Atlas Freight", primary: null, primaryForeground: null, logoUrl: null } }],
    "/portal/auth/refresh": () => (signedIn ? [200, { data: { access_token: "tok", refresh_token: null } }] : [401, { error: { code: "AUTH_REQUIRED" } }]),
    "/portal/me": () => [200, { data: ME() }],
    "/portal/client/home": () => [200, { data: HOME }],
    ...extra,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace("/api/tenant", "");
      calls.push(`${init?.method || "GET"} ${path}`);
      const hit = routes[path];
      const [status, body] = hit ? hit(init) : [404, { error: { code: "NOT_FOUND" } }];
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

function Loc() {
  const l = useLocation();
  return <span data-testid="loc">{`${l.pathname}${l.search}`}</span>;
}

async function mount(at: string) {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={[at]}>
        <Loc />
        <Routes>
          <Route path="/portal/*" element={<PortalApp />} />
        </Routes>
      </MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

beforeEach(() => {
  calls.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  void i18n.changeLanguage("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("amounts, the way people type them", () => {
  it.each([
    ["3270500", 3270500],
    ["3,270,500", 3270500],
    ["3 270 500", 3270500],
    ["3.270.500", 3270500],
    ["1850,50", 1850.5],
    ["1850.50", 1850.5],
    ["1.850,50", 1850.5],
    ["1,850.50", 1850.5],
    ["18,000", 18000],
  ])("%s → %s", (raw, want) => {
    expect(parseAmount(raw)).toBe(want);
  });

  it("refuses what is not an amount", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("errors read in the client's language", () => {
  it("maps a server code to its sentence, never the server's words", async () => {
    await i18n.changeLanguage("fr");
    await import("./portal-i18n");
    const text = errorText(new PortalError("LAST_ADMIN", "Server English message", 409));
    expect(text).not.toContain("Server English");
    expect(text).toMatch(/administrateur/);
  });

  it("falls back to the generic line for a code it does not know", async () => {
    await import("./portal-i18n");
    expect(errorText(new PortalError("SOMETHING_NEW", "x", 500))).toBe(en.err.generic);
  });
});

describe("signing in", () => {
  it("starts from the email, and a valid one asks for a code", async () => {
    stubApi(false, { "/portal/auth/code": () => [200, { data: { ok: true } }] });
    const { container, findByText } = await mount("/portal/login");
    const email = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('input[type="email"]');
      expect(el).toBeTruthy();
      return el!;
    });
    const go = await findByText(en.signin.continue);
    expect(go.closest("button")?.disabled).toBe(true);
    fireEvent.change(email, { target: { value: "marie@acme.cm" } });
    expect(go.closest("button")?.disabled).toBe(false);
    fireEvent.click(go);
    await findByText(en.signin.checkEmail);
    expect(calls).toContain("POST /portal/auth/code");
    // Six boxes, one code.
    expect(container.querySelectorAll(".pt-otp input")).toHaveLength(6);
  });

  it("greets a returning person by name on a device that remembers them", async () => {
    stubApi(false);
    localStorage.setItem("praxis.portal.known", JSON.stringify({ email: "marie@acme.cm", firstName: "Marie", company: "Acme Trading", passkeys: [] }));
    const { findByText } = await mount("/portal/login");
    await findByText(en.signin.welcomeBackNamed.replace("{{name}}", "Marie"));
    await findByText("Acme Trading");
  });
});

describe("home", () => {
  it("puts what we are waiting for first, each with its own verb", async () => {
    stubApi(true);
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { findByText, getByText } = await mount("/portal");
    await findByText(en.home.needsYou);
    getByText("Packing list");
    getByText("Consignee tax number");
    getByText(en.req.upload);
    getByText(en.req.answer);
  });
});

describe("a colleague given only Billing", () => {
  it("never reaches a shipment, even by typing the address", async () => {
    stubApi(true, { "/portal/me": () => [200, { data: ME("BILLING") }] });
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { getByTestId, container } = await mount("/portal/shipments");
    await waitFor(() => expect(getByTestId("loc").textContent).toBe("/portal"));
    // …and the tab bar does not offer it either.
    const labels = [...container.querySelectorAll(".pt-tab")].map((n) => n.textContent);
    expect(labels).not.toContain(en.nav.shipments);
    expect(calls).not.toContain("GET /portal/client/shipments");
  });
});
