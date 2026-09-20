/**
 * Links in a bubble: what becomes clickable, what becomes a card, and what the
 * bubble refuses to render.
 *
 * Three behaviours here are security properties rather than cosmetics, and they
 * are tested as such: an `href` can only ever be http(s)/mailto (a `javascript:`
 * in a message must not become a clickable same-origin document), an external
 * link shows its address (a reader decides whether to leave the app), and the
 * card's image is fetched through the tenant's own proxy rather than from the
 * third party — so a preview never phones home on the reader's behalf.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MessageText } from "./message-text";
import { LinkCard, LinkCards } from "./link-card";
import * as api from "@/lib/smartcomm-api";
import type { LinkPreview } from "@/lib/smartcomm-api";

vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  linkImageObjectUrl: vi.fn(),
}));
const linkImageObjectUrl = vi.mocked(api.linkImageObjectUrl);

const inRouter = (ui: React.ReactNode, path = "/workspace/tasks") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      {ui}
      <Routes>
        <Route path="/workspace/tasks" element={<div>task screen</div>} />
        <Route path="/operations/files/:id" element={<div>file screen</div>} />
      </Routes>
    </MemoryRouter>,
  );

const card = (over: Partial<LinkPreview> = {}): LinkPreview => ({
  url: "https://maersk.com/vessel/1",
  state: "OK",
  title: "Vessel tracking — Maersk",
  description: "Current position, ETA and voyage history for MAEU.",
  site_name: "maersk.com",
  image_src: null,
  icon_src: null,
  link_hash: null,
  media: null,
  fetched_at: "2026-09-01T08:00:00.000Z",
  stale: false,
  ...over,
});

beforeEach(() => {
  linkImageObjectUrl.mockReset();
  linkImageObjectUrl.mockResolvedValue("blob:preview");
});

describe("MessageText — what becomes clickable", () => {
  it("turns an https link into a real anchor that opens safely", () => {
    inRouter(<MessageText body="see https://maersk.com/vessel/1 for the ETA" />);
    // Exact string rather than a pattern: an unanchored URL regex matches any host
    // that CONTAINS the one under test, which is the assertion to avoid in a test
    // about a link that must not be a look-alike domain.
    const a = screen.getByRole("link", { name: "https://maersk.com/vessel/1" });
    expect(a).toHaveAttribute("href", "https://maersk.com/vessel/1");
    expect(a).toHaveAttribute("target", "_blank");
    // `noreferrer` is the reason this test exists: without it the destination
    // learns which tenant's chat sent the reader there.
    expect(a.getAttribute("rel")).toMatch(/noopener/);
    expect(a.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("keeps the address visible for an outside link", () => {
    inRouter(<MessageText body="https://maersk.com.example/steal" />);
    // A prettified label is how a look-alike domain passes. The bubble shows the
    // characters the sender typed, whole.
    expect(screen.getByRole("link").textContent).toBe("https://maersk.com.example/steal");
  });

  it("refuses a javascript: href, at the tokenizer rather than at the renderer", () => {
    const { container } = inRouter(<MessageText body="click javascript:alert(document.cookie)//" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(document.cookie)//");
  });

  it("renders a list with links inside its items", () => {
    inRouter(<MessageText body={"- doc https://a.example/x\n- done"} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://a.example/x");
  });

  it("turns our own record route into an in-app chip and navigates without a reload", () => {
    linkImageObjectUrl.mockResolvedValue("blob:x");
    inRouter(<MessageText body={"blocked\n/workspace/tasks?task=4f873a78-9790-460d"} />, "/elsewhere");
    const chip = screen.getByRole("link", { name: /Task/ });
    // No target=_blank: it stays in the SPA. And the raw UUID is not the label.
    expect(chip).not.toHaveAttribute("target");
    expect(chip.textContent).toContain("Task");
    fireEvent.click(chip);
    expect(screen.getByText("task screen")).toBeInTheDocument();
  });

  it("leaves an unknown path as plain text", () => {
    const { container } = inRouter(<MessageText body="read /not/a/route for details" />);
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("LinkCard — which previews render", () => {
  it("renders title, description and site for an OK card", () => {
    inRouter(<LinkCard preview={card()} tone="surface" />);
    expect(screen.getByText("Vessel tracking — Maersk")).toBeInTheDocument();
    expect(screen.getByText(/Current position, ETA/)).toBeInTheDocument();
    expect(screen.getByText("maersk.com")).toBeInTheDocument();
  });

  // The four non-OK states, and the four different reasons behind them, render the
  // same nothing: a card is either a card or it is not, and a reader cannot act on
  // the difference between "not yet", "declined" and "dead".
  it.each(["PENDING", "EMPTY", "UNREACHABLE", "REFUSED"] as const)("renders nothing for %s", (state) => {
    const { container } = render(<LinkCard preview={card({ state, title: null, description: null, site_name: null })} tone="surface" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the card is all empty strings", () => {
    const { container } = render(
      <LinkCard preview={card({ title: null, description: null, site_name: null, image_src: null })} tone="surface" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the provider, the length and a watch action for a video link", () => {
    inRouter(
      <LinkCard
        preview={card({
          media: { kind: "YOUTUBE", id: "dQw4w9WgXcQ", open_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", duration: 3725, author: "Maersk" },
        })}
        tone="surface"
      />,
    );
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    // 3725 seconds is 1:02:05 — the hour has to be shown, because "62:05" on a
    // card is the number a reader mis-reads as an hour and twenty minutes when
    // they are deciding whether to press play now or save it for later.
    expect(screen.getByText("1:02:05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Watch on YouTube/ })).toBeInTheDocument();
    expect(screen.getByText("Maersk")).toBeInTheDocument();
  });

  it("fetches its picture through the proxy, never from the linked host", async () => {
    const { container } = inRouter(
      <LinkCard preview={card({ link_hash: "a".repeat(64), image_src: "/smartcomm/links/image?link=" + "a".repeat(64) })} tone="surface" />,
    );
    // The key handed to the loader is the link's hash and nothing else — so there
    // is no URL in the request for a reader's browser to be steered by, and the
    // site being previewed never learns that this chat looked at it.
    expect(linkImageObjectUrl).toHaveBeenCalledWith("a".repeat(64), "image", expect.anything());
    await waitFor(() => expect(container.querySelector("img")).toBeInTheDocument());
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:preview");
  });

  it("drops the image entirely rather than showing a placeholder", () => {
    linkImageObjectUrl.mockRejectedValue(new Error("404"));
    const { container } = render(
      <LinkCard preview={card({ link_hash: "b".repeat(64), image_src: "/smartcomm/links/image?link=" + "b".repeat(64) })} tone="surface" />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  // On tone="primary" the bubble's ground IS the tenant accent, so the one
  // control on the card must invert to the theme surface (`bg-card`) rather than
  // wear an accent tint that vanishes into the bubble — the exact defect a
  // tenant with orange branding reported: an orange "Open link" on an orange
  // bubble that did not read as a button at all.
  it("inverts the Open link button against the sender's accent bubble", () => {
    inRouter(<LinkCard preview={card()} tone="primary" />);
    const button = screen.getByRole("button", { name: /Open link/ });
    expect(button.className).toContain("bg-card");
    expect(button.className).toContain("text-primary-ink");
    expect(button.className).not.toContain("bg-primary-foreground/15");
  });

  // The card is a footnote, not the message: it is capped at 65% of the bubble
  // so a pasted link never dominates the pane the way a full-width og:image did.
  it("caps the card's width below the bubble's", () => {
    const { container } = inRouter(<LinkCard preview={card()} tone="surface" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("max-w-[65%]");
  });

  it("caps a link-flood at three cards, in order", () => {
    const links = Object.fromEntries(
      ["1", "2", "3", "4", "5"].map((n) => [`https://a.example/${n}`, card({ url: `https://a.example/${n}`, title: `Card ${n}` })]),
    );
    render(
      <LinkCards
        urls={["https://a.example/1", "https://a.example/2", "https://a.example/3", "https://a.example/4", "https://a.example/5"]}
        links={links}
        tone="surface"
      />,
    );
    expect(screen.getByText("Card 1")).toBeInTheDocument();
    expect(screen.getByText("Card 3")).toBeInTheDocument();
    expect(screen.queryByText("Card 4")).toBeNull();
  });

  it("renders nothing at all when the server sent no previews", () => {
    const { container } = render(<LinkCards urls={["https://a.example/1"]} links={undefined} tone="surface" />);
    expect(container).toBeEmptyDOMElement();
  });
});
