/**
 * The delivery note 360 — one body, two shells.
 *
 * WHAT THESE PIN, beyond the shape the other two 360s share:
 *
 *   · THE PROGRESS TAB IS ABOUT THE FILE, NOT THE NOTE. It is the tab that
 *     answers "is another note needed", and the KPI strip above it publishes
 *     the same three figures. A strip that read this note's own boxes would be
 *     the exact mistake the panel was written to prevent.
 *   · THE STRIP IS ABSENT WHEN THERE IS NOTHING TO COUNT. A customs-brokerage
 *     file is not "0 of 0 delivered", and a row of zeros teaches operators to
 *     ignore rows. Asserted in both directions, because "renders nothing" is
 *     the half that rots.
 *   · The header names the note from the response, the tab is in the URL, and
 *     the desktop/phone branch works in both directions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DeliveryNote360Page } from "./delivery-note-360";
import { DeliveryNotesPage } from "./delivery-notes";

/** Renders the router's current location, so a test can assert a navigation
 *  rather than a rendered side effect of one. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

const ID = "dn-1";

const NOTE = {
  delivery_note_id: ID,
  ref: "DN-2026-0231",
  dossier_id: "d-1",
  dossier_ref: "SBX-2026-0001",
  status: "ISSUED",
  consignee: "Brasseries du Cameroun SA",
  address: "Zone Industrielle, Rue 4321, Douala",
  contact_person: "M. Ateba",
  phone: "+237 6 99 00 11 22",
  delivery_date: "2026-08-22",
  received_by_name: null,
  received_at: null,
  reservations: null,
  cancel_reason: null,
  allowed_transitions: ["DELIVERED", "CANCELLED"],
  issue_blockers: [],
  containers: [
    {
      delivery_note_container_id: "c-1",
      container_no: "TCLU1234567",
      container_type_code: "40HC",
      seal_no: "SL-99812",
    },
    {
      delivery_note_container_id: "c-2",
      container_no: "MSKU7654321",
      container_type_code: "20DV",
      seal_no: null,
    },
  ],
  lines: [{ delivery_note_line_id: "gl-1", label: "2 pallets, unlisted spares", qty: 2 }],
};

/** The FILE's boxes: twelve in all, four signed for, two on the road. */
const PROGRESS = {
  total: 12,
  delivered: 4,
  in_transit: 2,
  outstanding: 6,
  complete: false,
  containerised: true,
  captures_containers: true,
  boxes: [
    {
      kind: "unit",
      id: "b-1",
      container_no: "TCLU1234567",
      seal_no: "SL-99812",
      container_type_code: "40HC",
      state: "IN_TRANSIT",
      delivered_on_note: null,
      delivered_at: null,
      issued_on_note: "DN-2026-0231",
    },
  ],
  groups: [],
};

/** A file whose service type captures no containers at all. */
const NO_BOXES = { ...PROGRESS, total: 0, delivered: 0, in_transit: 0, outstanding: 0, captures_containers: false, boxes: [] };

const routes = {
  [`/delivery-notes/${ID}`]: NOTE,
  "/delivery-notes/progress": PROGRESS,
  "/delivery-notes/summary": { DRAFT: 0, ISSUED: 1, DELIVERED: 0, CANCELLED: 0 },
  "/delivery-notes": [NOTE],
  "/operations": [{ dossier_id: "d-1", ref: "SBX-2026-0001", status: "OPEN" }],
};

const renderPage = (path = `/operations/delivery-notes/${ID}`, extra = {}) =>
  renderScreen(<DeliveryNote360Page />, {
    routes: { ...routes, ...extra },
    path,
    pattern: "/operations/delivery-notes/:noteId",
  });

afterEach(() => {
  fixtures.current = {};
});

describe("Delivery note 360 · the page", () => {
  it("names the note from the response alone — no list row in hand", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "DN-2026-0231" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Brasseries du Cameroun SA · File SBX-2026-0001 · Delivered 22 Aug 2026",
      ),
    ).toBeInTheDocument();
  });

  it("publishes the FILE's boxes in the strip, not this note's", async () => {
    renderPage();

    // This note carries two containers; the file has twelve, four signed for.
    // A strip reading the note's own boxes is the mistake that dispatches a
    // second truck for a box somebody already signed for.
    const delivered = await screen.findByRole("button", {
      name: /Delivered — open the Progress tab/,
    });
    expect(delivered).toHaveTextContent("4 / 12");
    expect(
      screen.getByRole("button", { name: /Still to go — open the Progress tab/ }),
    ).toHaveTextContent("6");
    // …and this note's own count is its own tile, named as such.
    expect(
      screen.getByRole("button", {
        name: /Containers on this note — open the Cargo tab/,
      }),
    ).toHaveTextContent("2");
  });

  it("shows no strip at all when the file captures no containers", async () => {
    renderPage(`/operations/delivery-notes/${ID}`, {
      "/delivery-notes/progress": NO_BOXES,
    });

    await screen.findByRole("heading", { level: 1, name: "DN-2026-0231" });
    // "0 of 0 delivered" on a brokerage file is a row that teaches operators to
    // ignore rows, so there is no row.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /open the Progress tab/ }),
      ).toBeNull(),
    );
  });

  it("says why the Progress tab is empty rather than showing a blank frame", async () => {
    renderPage(`/operations/delivery-notes/${ID}?tab=progress`, {
      "/delivery-notes/progress": NO_BOXES,
    });

    expect(await screen.findByText("Nothing to count")).toBeInTheDocument();
  });

  it("opens the tab the URL asks for, not the first one", async () => {
    renderPage(`/operations/delivery-notes/${ID}?tab=cargo`);

    expect(await screen.findByText("TCLU1234567")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Cargo/ })).toBeChecked();
  });

  it("counts the cargo tab from the containers on the note", async () => {
    renderPage();
    expect(
      await screen.findByRole("radio", { name: "Cargo · 2" }),
    ).toBeInTheDocument();
  });

  it("offers the lifecycle step the note is actually at", async () => {
    renderPage();
    // ISSUED, so the next act is the handover. Issue is behind it and gone.
    expect(
      await screen.findByRole("button", { name: /Confirm delivery/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Issue & number/ })).toBeNull();
  });
});

describe("Delivery notes list · how the 360 opens", () => {
  const renderList = (path = "/operations/delivery-notes") =>
    renderScreen(
      <>
        <DeliveryNotesPage />
        <LocationProbe />
      </>,
      { routes, path, pattern: "/operations/*" },
    );

  it("sends a desktop click to the note's own page", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(
      (await screen.findAllByRole("button", { name: /DN-2026-0231/ }))[0],
    );

    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/delivery-notes/${ID}`,
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exchanges a desktop ?focus= for the route, so old deep links land", async () => {
    renderList(`/operations/delivery-notes?focus=${ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/delivery-notes/${ID}`,
      ),
    );
  });

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "matchMedia",
        (query: string) =>
          ({
            matches: false,
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList,
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("opens the sheet over the list, and keeps it in the URL", async () => {
      const user = userEvent.setup();
      renderList();

      await user.click(
        (await screen.findAllByRole("button", { name: /DN-2026-0231/ }))[0],
      );

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("DN-2026-0231");
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/delivery-notes?focus=${ID}`,
      );
    });

    it("hands a shared desktop link to the sheet", async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.queryByRole("heading", { level: 1, name: "DN-2026-0231" }),
        ).toBeNull();
      });
    });
  });
});
