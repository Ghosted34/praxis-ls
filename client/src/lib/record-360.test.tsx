/**
 * The list and the route, together — the hand-off between them in BOTH
 * directions, in one router.
 *
 * Each half is pinned on its own elsewhere (transit-order-360, file-360): a
 * phone on the route is handed to `?focus=`, and a desktop on `?focus=` is
 * handed to the route. What neither can see is the two composed. A phone that
 * arrived on the list with `?focus=` already in the address — a reload with the
 * sheet open, the back arrow, a notification, the route's own hand-off — was
 * sent to the route by the list, which sent it straight back, forever: the
 * costing screen flashing between blank, the list, the sheet and the page
 * several times a second. Both halves passed their own tests throughout.
 *
 * The cause was the first frame. `useIsDesktop` answered its `true` fallback on
 * mount even where `matchMedia` could say otherwise, and the list's exchange
 * effect ran in that same commit, so a phone was a desktop for exactly long
 * enough to navigate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useRecordOpener } from "./record-360";
import { Record360Page } from "@/components/record-360";

type Row = { id: string; ref: string };
const ROWS: Row[] = [{ id: "r-1", ref: "SBX-CST-0002" }];

/** The router's own navigate, for the steps a test takes outside the list. */
const nav: { go: ReturnType<typeof useNavigate> } = {} as never;

/** Every address the router has shown, in order — a bounce is a visit. */
function LocationLog({ into }: { into: string[] }) {
  const loc = useLocation();
  nav.go = useNavigate();
  const at = loc.pathname + loc.search;
  if (into[into.length - 1] !== at) into.push(at);
  return <output data-testid="loc">{at}</output>;
}

function List() {
  const { sheetId, openRecord } = useRecordOpener("/things", ROWS, (r) => r.id);
  return (
    <>
      <button type="button" onClick={() => openRecord(ROWS[0])}>
        SBX-CST-0002
      </button>
      {sheetId ? <div role="dialog">{sheetId}</div> : <p>the list</p>}
    </>
  );
}

function Page({ onPaint }: { onPaint: () => void }) {
  return (
    <Record360Page basePath="/things" backLabel="Things" id="r-1">
      <Body onPaint={onPaint} />
    </Record360Page>
  );
}

function Body({ onPaint }: { onPaint: () => void }) {
  onPaint();
  return <h1>SBX-CST-0002</h1>;
}

function renderApp(at: string, log: string[], onPaint = () => {}) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/things" element={<List />} />
        <Route path="/things/:id" element={<Page onPaint={onPaint} />} />
        <Route path="/documents/:docType/:id" element={<p>the document</p>} />
      </Routes>
      <LocationLog into={log} />
    </MemoryRouter>,
  );
}

const stubViewport = (desktop: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: desktop,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );

describe("record 360 · on a phone", () => {
  beforeEach(() => stubViewport(false));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a ?focus= it landed on as the sheet — never visits the route", async () => {
    const log: string[] = [];
    renderApp("/things?focus=r-1", log);

    expect(await screen.findByRole("dialog")).toHaveTextContent("r-1");
    // Give a bounce every chance to happen before asserting it did not.
    await new Promise((r) => setTimeout(r, 50));
    expect(log).toEqual(["/things?focus=r-1"]);
  });

  it("hands the route to the sheet once, and stays there", async () => {
    const log: string[] = [];
    renderApp("/things/r-1", log);

    expect(await screen.findByRole("dialog")).toHaveTextContent("r-1");
    await new Promise((r) => setTimeout(r, 50));
    expect(log).toEqual(["/things/r-1", "/things?focus=r-1"]);
  });

  it("comes Back from a page the sheet opened onto the sheet, and stays", async () => {
    // The reported path: tap a row, Print / preview (a route of its own),
    // Back. Back remounts the list with `?focus=` already in the address —
    // exactly the first frame that used to bounce.
    const log: string[] = [];
    renderApp("/things", log);
    act(() => screen.getByRole("button", { name: "SBX-CST-0002" }).click());
    await screen.findByRole("dialog");
    act(() => nav.go("/documents/COSTING/r-1"));
    await screen.findByText("the document");
    act(() => nav.go(-1));

    expect(await screen.findByRole("dialog")).toHaveTextContent("r-1");
    await new Promise((r) => setTimeout(r, 50));
    expect(log).toEqual([
      "/things",
      "/things?focus=r-1",
      "/documents/COSTING/r-1",
      "/things?focus=r-1",
    ]);
  });

  it("never paints the page body, not even for the first frame", async () => {
    const paint = vi.fn();
    renderApp("/things/r-1", [], paint);

    await screen.findByRole("dialog");
    // A body that renders once still mounts and fires its fetches — and on
    // the costing sheet, painted the full worksheet for a frame mid-loop.
    expect(paint).not.toHaveBeenCalled();
  });
});

describe("record 360 · on a desktop", () => {
  beforeEach(() => stubViewport(true));
  afterEach(() => vi.unstubAllGlobals());

  it("still exchanges ?focus= for the route, so old deep links land", async () => {
    const log: string[] = [];
    renderApp("/things?focus=r-1", log);

    expect(
      await screen.findByRole("heading", { name: "SBX-CST-0002" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/things/r-1"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
