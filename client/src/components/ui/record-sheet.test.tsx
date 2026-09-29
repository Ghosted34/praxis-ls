/**
 * RecordSheet — a phone's open record, and the history step that lets Back
 * close it.
 *
 * The layout half (full screen, the ✕ top right, the list not moving) needs a
 * real browser and is measured in `e2e/phone-record-sheet.spec.ts`. What is
 * here is the half jsdom CAN see and the half that is easy to get subtly wrong:
 * the history. A sheet that is not a step in the history is closed by Back only
 * by leaving the screen; a sheet whose ✕ PUSHES rather than steps back leaves a
 * Forward that reopens nothing; and a sheet that adds a step on top of a
 * `?focus=` that already is one makes Back take two presses. Each case below is
 * one of those.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { RecordSheet } from "./record-sheet";
import { SplitPane } from "./split-pane";

const probe: {
  navigate: ReturnType<typeof useNavigate>;
  location: ReturnType<typeof useLocation>;
  setOpen: (open: boolean) => void;
  closes: number;
} = {} as never;

function Harness({ ownsHistory = true }: { ownsHistory?: boolean }) {
  const [open, setOpen] = React.useState(false);
  probe.navigate = useNavigate();
  probe.location = useLocation();
  probe.setOpen = setOpen;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Supplier A
      </button>
      <RecordSheet
        open={open}
        onClose={() => {
          probe.closes += 1;
          setOpen(false);
        }}
        eyebrow="Supplier"
        title="Supplier A"
        ownsHistory={ownsHistory}
      >
        <p>The record.</p>
      </RecordSheet>
    </>
  );
}

function renderAt(entries: string[], ui: React.ReactElement = <Harness />) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      {ui}
    </MemoryRouter>,
  );
}

const sheet = () => screen.queryByRole("dialog", { name: "Supplier A" });

beforeEach(() => {
  probe.closes = 0;
});

describe("RecordSheet — the history step", () => {
  it("opening adds a step, and Back closes the sheet without leaving the list", async () => {
    renderAt(["/home", "/list"]);
    await userEvent.click(screen.getByRole("button", { name: "Supplier A" }));

    expect(sheet()).toBeInTheDocument();
    expect(probe.location.search).toBe("?sheet=1");

    act(() => probe.navigate(-1));

    expect(sheet()).toBeNull();
    expect(probe.location.pathname).toBe("/list");
    expect(probe.location.search).toBe("");
    expect(probe.closes).toBe(1);
  });

  it("✕ steps BACK over its own step — one Back afterwards leaves the screen", async () => {
    renderAt(["/home", "/list"]);
    await userEvent.click(screen.getByRole("button", { name: "Supplier A" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(sheet()).toBeNull();
    expect(probe.location.search).toBe("");
    // Had the ✕ pushed a fresh `/list`, this Back would land on `/list?sheet=1`.
    act(() => probe.navigate(-1));
    expect(probe.location.pathname).toBe("/home");
  });

  it("a page that closes the record itself takes the step back off the stack", async () => {
    renderAt(["/home", "/list"]);
    await userEvent.click(screen.getByRole("button", { name: "Supplier A" }));

    // The record was deleted, say, and the page cleared its selection.
    act(() => probe.setOpen(false));

    expect(sheet()).toBeNull();
    expect(probe.location.search).toBe("");
    act(() => probe.navigate(-1));
    expect(probe.location.pathname).toBe("/home");
  });

  it("drops a stale ?sheet=1 it did not push — a reload with nothing open", () => {
    renderAt(["/list?sheet=1&tab=Spend"]);

    expect(sheet()).toBeNull();
    expect(probe.location.search).toBe("?tab=Spend");
  });

  it("keeps the page's own parameters while it adds and removes its step", async () => {
    renderAt(["/list?tab=Spend"]);
    await userEvent.click(screen.getByRole("button", { name: "Supplier A" }));
    expect(new URLSearchParams(probe.location.search).get("tab")).toBe("Spend");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(probe.location.search).toBe("?tab=Spend");
  });

  it("survives StrictMode's double effects — it does not open and close itself", async () => {
    renderAt(
      ["/list"],
      <React.StrictMode>
        <Harness />
      </React.StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Supplier A" }));

    expect(sheet()).toBeInTheDocument();
    expect(probe.location.search).toBe("?sheet=1");
    expect(probe.closes).toBe(0);
  });

  it("with the selection already in the URL, adds nothing and ✕ closes directly", async () => {
    renderAt(["/list"], <Harness ownsHistory={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Supplier A" }));

    expect(sheet()).toBeInTheDocument();
    expect(probe.location.search).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(sheet()).toBeNull();
    expect(probe.closes).toBe(1);
  });

  it("returns focus to the row that opened it", async () => {
    renderAt(["/list"]);
    const row = screen.getByRole("button", { name: "Supplier A" });
    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(row).toHaveFocus();
  });
});

describe("SplitPane below lg", () => {
  beforeEach(() => {
    // `useIsDesktop` answers true where matchMedia is missing, so the phone
    // branch has to be asked for, by stubbing it — the hook reads it on the
    // first render, as a real phone's does.
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

  function Split({ active, onClose }: { active: boolean; onClose?: () => void }) {
    return (
      <MemoryRouter>
        <SplitPane
          storageKey="test.split"
          label="List width"
          activeKind="Supplier"
          active={active}
          onClose={onClose}
          sheetTitle="Supplier A"
        >
          <p>The list.</p>
          <p>The record.</p>
        </SplitPane>
      </MemoryRouter>
    );
  }

  it("with onClose, the list is the page and nothing else shows until a record opens", () => {
    render(<Split active={false} onClose={() => {}} />);

    expect(screen.getByText("The list.")).toBeInTheDocument();
    expect(screen.queryByText("The record.")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with onClose, an open record is a sheet named after it", () => {
    render(<Split active onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Supplier A" });
    expect(dialog).toHaveTextContent("The record.");
  });

  it("without onClose, the panes stack as they always did — no sheet", () => {
    render(<Split active />);

    expect(screen.getByText("The list.")).toBeInTheDocument();
    expect(screen.getByText("The record.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
