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

describe("an invoice's supporting documents", () => {
  const INVOICE = {
    invoice_id: "i1",
    doc_number: "FAC-2026-1182",
    issued_on: "2026-09-20",
    payment_due_on: "2026-10-20",
    days_to_due: 22,
    currency: "XAF",
    total: 1850000,
    paid: 0,
    in_review: 0,
    outstanding: 1850000,
    state: "DUE",
    dossier_id: "d1",
    dossier_ref: "PRX-1",
    documents_count: 2,
  };
  const DETAIL = {
    invoice: {
      invoice_id: "i1",
      doc_number: "FAC-2026-1182",
      issued_on: "2026-09-20",
      payment_due_on: "2026-10-20",
      status: "ISSUED_LOCKED",
      currency: "XAF",
      service_ht: 350000,
      disbursement_total: 1400000,
      vat_total: 100000,
      total_ttc: 1850000,
    },
    lines: [{ label: "Port charges (PAD)", amount: 900000, tax: null, is_disbursement: true }],
    summary: INVOICE,
    how_to_pay: null,
    documents: {
      published_at: "2026-09-27T10:00:00Z",
      items: [
        { doc_id: "v1", position: 1, label: "Port charges (PAD)", name: "pad-receipt", ext: "pdf" },
        { doc_id: "v2", position: 2, label: "Demurrage", name: "Maersk demurrage", ext: "pdf" },
      ],
    },
  };
  const billing = (zip: [number, Json]) => ({
    "/portal/client/billing": () => [200, { data: { totals: [], invoices: [INVOICE], proofs: [], how_to_pay: null } }] as [number, Json],
    "/portal/client/invoice/i1": () => [200, { data: DETAIL }] as [number, Json],
    "/portal/client/invoice/i1/documents/zip": () => zip,
  });

  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:zip"), revokeObjectURL: vi.fn() }));
    // The Save-As anchor: jsdom would try to navigate to the blob.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the paperclip on the row, and one tap downloads the invoice and every document as a ZIP", async () => {
    stubApi(true, billing([200, { ok: true }]));
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { findByText, getByText, getByRole } = await mount("/portal/billing");
    // The row says how many documents come with the invoice, in words for a screen reader.
    getByText("Supporting documents: 2", { selector: ".sr-only" });
    fireEvent.click(getByText("FAC-2026-1182"));
    await findByText(en.bill.docs.title);
    fireEvent.click(getByRole("button", { name: en.bill.docs.all }));
    await waitFor(() => expect(calls).toContain("GET /portal/client/invoice/i1/documents/zip"));
    // The single files wait behind a tap.
    expect(document.body.textContent).not.toContain("Maersk demurrage");
    fireEvent.click(getByRole("button", { name: en.bill.docs.show }));
    getByText("Maersk demurrage");
  });

  it("says so when the documents are too large to download together", async () => {
    stubApi(true, billing([413, { error: { code: "BUNDLE_TOO_LARGE", message: "server words" } }]));
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { findByText, getByText, getByRole } = await mount("/portal/billing");
    fireEvent.click(getByText("FAC-2026-1182"));
    await findByText(en.bill.docs.title);
    fireEvent.click(getByRole("button", { name: en.bill.docs.all }));
    await findByText(en.err.BUNDLE_TOO_LARGE);
  });
});

describe("the chat", () => {
  const THREADS = [
    { thread: "general", dossier_id: null, dossier_ref: null, dossier_status: null, unread: 1, last: { direction: "STAFF", mine: false, preview: "Your statement is ready.", kind: "TEXT", at: "2026-09-28T08:00:00Z" } },
    { thread: "11111111-1111-4111-8111-111111111111", dossier_id: "11111111-1111-4111-8111-111111111111", dossier_ref: "PRX-9", dossier_status: "IN_PROGRESS", unread: 2, last: { direction: "STAFF", mine: false, preview: null, kind: "IMAGE", at: "2026-09-28T09:00:00Z" } },
  ];
  const PAGE = {
    thread: "general",
    dossier_ref: null,
    has_more: false,
    messages: [
      {
        message_id: "m1", dossier_id: null, dossier_ref: null, direction: "STAFF", body: "Your statement is ready.", created_at: "2026-09-28T08:00:00Z",
        author: { name: "Paul Ekambi", email: null }, mine: false, seen: null, milestone: null, location: null, attachments: [],
      },
    ],
  };
  const chatRoutes = (sent: RequestInit[] = []) => ({
    "/portal/client/home": () => [200, { data: { ...HOME, chat: { unread: 3 } } }] as [number, Json],
    "/portal/client/chat/threads": () => [200, { data: THREADS }] as [number, Json],
    "/portal/client/chat/unread": () => [200, { data: { unread: 0 } }] as [number, Json],
    "/portal/client/chat/messages": (init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push(init);
        return [201, { data: { ...PAGE.messages[0], message_id: "m2", direction: "CLIENT", body: "Thank you!", mine: true, seen: false, author: { name: null, email: "marie@acme.cm" } } }] as [number, Json];
      }
      return [200, { data: PAGE }] as [number, Json];
    },
    "/portal/client/chat/read": () => [200, { data: { thread: "general" } }] as [number, Json],
  });

  it("puts the unread count on the chat button and lists General before the shipments", async () => {
    stubApi(true, chatRoutes());
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { container, findByText, getByText } = await mount("/portal");
    const fab = container.querySelector(".pt-fab") as HTMLButtonElement;
    await waitFor(() => expect(fab.textContent).toContain("3"));
    fireEvent.click(fab);
    await findByText(en.chat.general);
    const rows = [...document.querySelectorAll(".pt-chat-thread")].map((n) => n.textContent || "");
    expect(rows[0]).toContain(en.chat.general);
    expect(rows[1]).toContain("PRX-9");
    // A photo with no words reads as what it is.
    expect(rows[1]).toContain(en.chat.kind.IMAGE);
    getByText(en.chat.newAbout);
  });

  /** The upload path is XHR (for its progress events); route it through the same table. */
  class FakeXHR {
    status = 0;
    responseText = "";
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private method = "GET";
    private url = "";
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader() {}
    send(body: FormData) {
      const path = new URL(this.url, "http://localhost").pathname.replace("/api/tenant", "");
      calls.push(`${this.method} ${path}`);
      const hit = routes[path];
      const [status, json] = hit ? hit({ method: this.method, body } as RequestInit) : [404, { error: { code: "NOT_FOUND" } }];
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
        this.status = status;
        this.responseText = JSON.stringify(json);
        this.onload?.();
      }, 0);
    }
  }

  it("opens a conversation, marks it read, and sends as a multipart message", async () => {
    const sent: RequestInit[] = [];
    stubApi(true, chatRoutes(sent));
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { container, findByText, getByLabelText, getByRole } = await mount("/portal");
    fireEvent.click(container.querySelector(".pt-fab") as HTMLButtonElement);
    fireEvent.click(await findByText(en.chat.general));
    await findByText("Your statement is ready.", { selector: ".pt-chat-text" });
    await waitFor(() => expect(calls).toContain("POST /portal/client/chat/read"));
    const box = getByLabelText(en.chat.placeholder);
    fireEvent.change(box, { target: { value: "Thank you!" } });
    fireEvent.click(getByRole("button", { name: en.chat.send }));
    await findByText("Thank you!", { selector: ".pt-chat-text" });
    await waitFor(() => expect(sent).toHaveLength(1));
    const form = sent[0].body as FormData;
    expect(form.get("thread")).toBe("general");
    expect(form.get("body")).toBe("Thank you!");
    // The new thread API, never the first portal's flat endpoint.
    expect(calls).not.toContain("POST /portal/client/messages");
  });

  it("opens straight into a conversation from a notification's link, then drops the parameter", async () => {
    stubApi(true, chatRoutes());
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { findByText, getByTestId } = await mount("/portal?chat=general");
    // General, opened — its message on screen without touching the list.
    await findByText("Your statement is ready.", { selector: ".pt-chat-text" });
    await waitFor(() => expect(getByTestId("loc").textContent).toBe("/portal"));
  });

  it("gives a Billing-only colleague no way to start a shipment conversation", async () => {
    stubApi(true, { ...chatRoutes(), "/portal/me": () => [200, { data: ME("BILLING") }] });
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { container, findByText, queryByText } = await mount("/portal");
    fireEvent.click(container.querySelector(".pt-fab") as HTMLButtonElement);
    await findByText(en.chat.general);
    expect(queryByText(en.chat.newAbout)).toBeNull();
  });
});

describe("notifications", () => {
  const SETTINGS = {
    language: null,
    topics: [
      { topic: "MESSAGES", email: true, push: true },
      { topic: "REQUESTS", email: true, push: true },
      { topic: "BILLING", email: true, push: true },
      { topic: "PROPOSALS", email: true, push: true },
      { topic: "SHIPMENTS", email: false, push: true },
    ],
    push: { configured: true, public_key: "BPUBLIC", devices: 0 },
  };

  it("lists each topic with its two switches, and saves a change at once", async () => {
    const saved: unknown[] = [];
    stubApi(true, {
      "/portal/client/team": () => [200, { data: { can_manage: false, members: [] } }],
      "/portal/auth/passkeys": () => [200, { data: [] }],
      "/portal/auth/sessions": () => [200, { data: [] }],
      "/portal/client/notifications": (init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          saved.push(body);
          return [200, { data: { language: null, topics: body.topics } }];
        }
        return [200, { data: SETTINGS }];
      },
    });
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { findByRole, getByRole } = await mount("/portal/account");
    const shipments = await findByRole("group", { name: en.notify.topic.SHIPMENTS });
    const email = shipments.querySelector("button") as HTMLButtonElement;
    expect(email.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(email);
    await waitFor(() => expect(saved).toHaveLength(1));
    const body = saved[0] as { topics: { topic: string; email: boolean }[] };
    expect(body.topics.find((x) => x.topic === "SHIPMENTS")?.email).toBe(true);
    await waitFor(() => expect(email.getAttribute("aria-pressed")).toBe("true"));
    // jsdom has no service worker: this device says so instead of offering a switch.
    expect(getByRole("group", { name: en.notify.topic.MESSAGES })).toBeTruthy();
  });
});

describe("a proposal", () => {
  const P = "77777777-7777-4777-8777-777777777777";
  const SUMMARY = {
    proposal_id: P, doc_number: "PRP-2026-0004", title: "Door-to-door, Shanghai to Douala", status: "SENT",
    currency: "XAF", total: 4850000, route: "Shanghai → Douala", sent_on: "2026-09-20", valid_until: "2099-12-31",
  };
  const DETAIL = {
    proposal: { proposal_id: P, doc_number: "PRP-2026-0004", title: SUMMARY.title, status: "SENT", currency: "XAF", total: 4850000, valid_until: "2099-12-31" },
    presentation: {
      language: "EN", title: SUMMARY.title, document_number: "PRP-2026-0004", client_name: "Acme Trading", route: "Shanghai → Douala",
      labels: { service: "Service", quantity: "Qty", unit: "Unit", total: "Total" },
      sections: [], lines: [{ label: "Sea freight 1×40HC", quantity: 1, unit_price_display: "4 850 000", total_display: "4 850 000" }],
    },
    signature: null,
    signing: { available: true, cards: [{ preset_code: "STAMP", label: "Stamp", blurb: null }] },
    decline_reasons: [{ reason_code: "PRICE", label: "The price" }, { reason_code: "TIMING", label: "The timing" }],
  };

  it("opens from its link and is declined with a reason the team can act on", async () => {
    const declined: unknown[] = [];
    stubApi(true, {
      "/portal/client/quote-requests": () => [200, { data: [] }],
      "/portal/client/proposals": () => [200, { data: [SUMMARY] }],
      [`/portal/client/proposals/${P}`]: () => [200, { data: DETAIL }],
      [`/portal/client/proposals/${P}/decline`]: (init?: RequestInit) => {
        declined.push(JSON.parse(String(init?.body)));
        return [200, { data: { declined: true } }];
      },
    });
    sessionStorage.setItem("praxis.portal.token", "tok");
    const { findByText, findByRole, getByRole } = await mount(`/portal/quotes?proposal=${P}`);
    await findByText("Sea freight 1×40HC");
    // Accepting is signing on a tenant that offers a signature card.
    expect(getByRole("button", { name: en.prop.acceptSign })).toBeTruthy();
    fireEvent.click(getByRole("button", { name: en.prop.decline }));
    const send = await findByRole("button", { name: en.prop.declineSend });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await findByRole("button", { name: "The price" }));
    fireEvent.click(send);
    await waitFor(() => expect(declined).toEqual([{ reason_code: "PRICE" }]));
  });
});
