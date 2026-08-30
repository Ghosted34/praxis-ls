import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrandingProvider } from "@/app/branding";
import { QuoteWizard } from "@/components/site/quote-wizard";
import { en } from "@/lib/i18n-dict";

/**
 * The wizard, judged against what WS2 said it must beat.
 *
 * Their form is `onsubmit="return false;"` with the real submit on a button's
 * onclick, so every `required` on the page is decorative and native validation
 * never runs. The cases below are therefore mostly about REFUSALS — a step that
 * will not advance, an incoterm that cannot be skipped, a warehousing branch
 * that never asks for one — because a wizard that always advances looks
 * identical to a correct one until somebody submits.
 *
 * The three that are about the payload are the ones a reviewer should read
 * first: the incoterm is always sent, `project_cargo_flag: false` survives the
 * empty-value filter, and no coordinate is ever posted.
 */

const responses: Array<{ url: RegExp; body: unknown; status?: number }> = [];

const stubFetch = () =>
  vi.fn(async (url: unknown) => {
    const u = String(url);
    const match = responses.find((r) => r.url.test(u));
    const body = match ? match.body : { error: { code: "NOT_FOUND", message: "no" } };
    return new Response(JSON.stringify(body), {
      status: match?.status ?? (match ? 200 : 404),
      headers: { "content-type": "application/json" },
    });
  });

let fetchMock: ReturnType<typeof stubFetch>;

const mount = async () => {
  const view = render(
    <BrandingProvider>
      <QuoteWizard />
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
};

/**
 * Match a field by the START of its label.
 *
 * `field.tsx` renders the required marker INSIDE the `<label>`, so a required
 * field's accessible name is "Service*" and an exact string match finds
 * nothing — while the same query works for every optional field, which is the
 * kind of half-passing that hides a real breakage.
 */
const labelRe = (label: string) =>
  new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

const field = (label: string) => screen.getByLabelText(labelRe(label));

const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });

const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

/** Fill step 0 and advance. */
async function stepNeed(mode = en.site.quote.modeSEA) {
  press(mode);
  type(en.site.quote.service, "Sea freight import");
  press(en.site.quote.next);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Fill the freight route step and advance. */
async function stepRoute() {
  type(en.site.quote.originPort, "Shanghai");
  type(en.site.quote.destinationPort, "Douala");
  fireEvent.change(field(en.site.quote.incoterm), { target: { value: "FOB" } });
  press(en.site.quote.next);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  responses.length = 0;
  responses.push({
    url: /\/public\/intake\/quote-requests/,
    body: { data: { received: true, reference: "SQ-2026-0007" } },
    status: 201,
  });
  fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const sentBody = () => {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/public/intake/quote-requests"),
  );
  return JSON.parse(String((call?.[1] as RequestInit)?.body));
};

describe("a step will not advance while it is incomplete", () => {
  it("refuses the first step with nothing chosen", async () => {
    // Their `required` attributes never fire because the form's own submit is
    // cancelled. Ours is the reason the button exists.
    await mount();
    press(en.site.quote.next);
    expect(await screen.findByText(en.site.quote.errMode)).toBeInTheDocument();
    expect(screen.getByText(en.site.quote.errService)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: en.site.quote.stepNeed })).toBeInTheDocument();
  });

  it("says nothing until an attempt is made", async () => {
    // Pointing at a field somebody has not reached yet is nagging.
    await mount();
    expect(screen.queryByText(en.site.quote.errMode)).not.toBeInTheDocument();
  });

  it("refuses the route step without an incoterm", async () => {
    // Resolved decision 3, and the bug it was resolving: the shipped form left
    // this optional, so a blank Incoterm became a 422 nobody could explain.
    await mount();
    await stepNeed();
    type(en.site.quote.originPort, "Shanghai");
    type(en.site.quote.destinationPort, "Douala");
    press(en.site.quote.next);
    expect(await screen.findByText(en.site.quote.errIncoterm)).toBeInTheDocument();
  });

  it("asks for nothing on the details step", async () => {
    // Every field there is a nicety that makes a better quote; gating on one
    // would be inventing a requirement the desk never had.
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: en.site.quote.stepContact }),
      ).toBeInTheDocument(),
    );
  });
});

describe("the branch", () => {
  it("asks a warehousing enquiry for storage, not for a route", async () => {
    // Asking a storage prospect for an Incoterm is asking a question with no
    // answer.
    await mount();
    press(en.site.quote.modeWAREHOUSE);
    type(en.site.quote.service, "Warehousing");
    press(en.site.quote.next);
    expect(
      await screen.findByLabelText(labelRe(en.site.quote.warehouseLocation)),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(labelRe(en.site.quote.incoterm))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(labelRe(en.site.quote.originPort))).not.toBeInTheDocument();
  });

  it("names the route fields after the mode", async () => {
    // Port of loading for sea, Airport of departure for air. Their site does
    // this and it is right.
    await mount();
    press(en.site.quote.modeAIR);
    type(en.site.quote.service, "Air freight");
    press(en.site.quote.next);
    expect(
      await screen.findByLabelText(labelRe(en.site.quote.originAirport)),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(labelRe(en.site.quote.originPort))).not.toBeInTheDocument();
  });
});

describe("the step dots", () => {
  it("go back to a completed step without losing what is ahead", async () => {
    // A visitor four steps in who wants to correct step two must not lose
    // steps three and four.
    await mount();
    await stepNeed();
    await stepRoute();
    const nav = within(screen.getByRole("navigation", { name: en.site.quote.stepsLabel }));
    fireEvent.click(nav.getByRole("button", { name: new RegExp(en.site.quote.stepNeed) }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: en.site.quote.stepNeed })).toBeInTheDocument(),
    );
    // The route answers are still there when we come forward again.
    press(en.site.quote.next);
    await waitFor(() =>
      expect(field(en.site.quote.originPort)).toHaveValue("Shanghai"),
    );
  });

  it("offers no way to jump forward past a step's validation", async () => {
    await mount();
    const nav = within(screen.getByRole("navigation", { name: en.site.quote.stepsLabel }));
    // A control that refuses when pressed is worse than no control: the visitor
    // presses it twice and concludes the page is broken.
    expect(
      nav.queryByRole("button", { name: new RegExp(en.site.quote.stepContact) }),
    ).not.toBeInTheDocument();
  });
});

describe("what reaches the endpoint", () => {
  it("sends the incoterm, the route and the service", async () => {
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: en.site.quote.stepContact })).toBeInTheDocument(),
    );
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    await waitFor(() => expect(sentBody()).toBeTruthy());
    const body = sentBody();
    expect(body.incoterm).toBe("FOB");
    expect(body.origin_location).toBe("Shanghai");
    expect(body.destination_location).toBe("Douala");
    expect(body.requester_email).toBe("ada@example.cm");
  });

  it("sends N/A as the incoterm for storage, which is an answer", async () => {
    // The schema requires one and a warehousing enquiry genuinely has none.
    // Blank would be a 422; N/A is the truth.
    await mount();
    press(en.site.quote.modeWAREHOUSE);
    type(en.site.quote.service, "Warehousing");
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.warehouseLocation));
    type(en.site.quote.warehouseLocation, "Douala");
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.weight));
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    await waitFor(() => expect(sentBody()).toBeTruthy());
    expect(sentBody().incoterm).toBe("N/A");
    expect(sentBody().warehouse_location).toBe("Douala");
    expect(sentBody()).not.toHaveProperty("origin_location");
  });

  it("never posts a coordinate", async () => {
    // A body that could carry one could carry any, and have it stored as
    // provider-vouched. The server re-asks the provider; the browser sends an
    // id and the text that produced it, or nothing.
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    await waitFor(() => expect(sentBody()).toBeTruthy());
    const json = JSON.stringify(sentBody());
    expect(json).not.toContain("latitude");
    expect(json).not.toContain("longitude");
  });

  it("stamps the timer the spam trap needs, and carries a FILLED honeypot", async () => {
    // The trap is asymmetric on purpose. A person leaves `website_url` empty
    // and the payload cleaner drops it — omitted passes, because the schema
    // marks it optional. A bot fills it, the value travels, and
    // `z.string().max(0)` refuses the submission. So the assertion that
    // matters is that a filled honeypot is NOT cleaned away.
    //
    // `form_started_at` is the partner: under 1500 ms after it, the middleware
    // answers SPAM_REJECTED.
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");

    // What a form-filling bot does to every input it can find.
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website_url"]');
    expect(honeypot).not.toBeNull();
    fireEvent.change(honeypot as HTMLInputElement, { target: { value: "http://spam.example" } });

    press(en.site.quote.submit);
    await waitFor(() => expect(sentBody()).toBeTruthy());
    expect(sentBody().website_url).toBe("http://spam.example");
    expect(typeof sentBody().form_started_at).toBe("number");
  });
});

describe("the draft", () => {
  it("survives a remount, so a refresh does not wipe four steps", async () => {
    const first = await mount();
    await stepNeed();
    type(en.site.quote.originPort, "Shanghai");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    first.unmount();

    await mount();
    // Back on step one — the step index is not persisted, only the answers —
    // and the answers are there.
    press(en.site.quote.next);
    await waitFor(() =>
      expect(field(en.site.quote.originPort)).toHaveValue("Shanghai"),
    );
  });

  it("is kept out of localStorage", async () => {
    // A quote draft names a company, a route and a phone number. On the shared
    // machine in an internet café, localStorage would still have it tomorrow.
    await mount();
    await stepNeed();
    expect(sessionStorage.length).toBeGreaterThan(0);
    expect(localStorage.length).toBe(0);
  });

  it("is cleared once the request is filed", async () => {
    // A surviving draft reappears pre-filled and invites a duplicate.
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    await waitFor(() =>
      expect(screen.getByText(en.site.quote.sent)).toBeInTheDocument(),
    );
    expect(sessionStorage.getItem("praxis.quote.draft")).toBeNull();
  });
});

describe("the receipt", () => {
  it("shows the reference the API generated", async () => {
    // The one thing that lets a client chase their request by phone instead of
    // by hope.
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    expect(await screen.findByText("SQ-2026-0007")).toBeInTheDocument();
  });

  it("shows a designed error rather than an alert when the post fails", async () => {
    responses.length = 0;
    responses.push({
      url: /\/public\/intake\/quote-requests/,
      body: { error: { code: "ERROR", message: "boom" } },
      status: 500,
    });
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(en.site.quote.err)).toBeInTheDocument();
  });
});
