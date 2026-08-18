/**
 * Back and forward, driven through a real history stack.
 *
 * `BrowserRouter` rather than `MemoryRouter`, and that is the point of the
 * setup rather than an accident of it. The whole model is anchored on
 * `window.history.state.idx` — React Router's own stamp, and the one identifier
 * that survives a reload (see nav-trail.ts). A memory router never touches
 * `window.history`, so every entry would report the same `idx` and the trail
 * would appear to work while recording nothing. Testing against jsdom's real
 * history is what makes these assertions mean anything.
 *
 * THE FAILURES THIS EXISTS TO CATCH, all of which look fine in a screenshot:
 * an arrow that is enabled with nothing behind it and walks the user out of the
 * app; a forward arrow that greys out the moment you press back; and a tooltip
 * that says "Back" when it could say where back goes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter, Link, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavTrailProvider } from "./nav-trail-provider";
import { useTrailTitle } from "./nav-trail-context";
import { NavArrows } from "./nav-arrows";

/** A dossier stands in for any record that names its own history entry. */
function DossierScreen() {
  useTrailTitle("Dossier SLS-2481");
  return <h1>Dossier</h1>;
}

function Harness() {
  return (
    <BrowserRouter future={{ v7_startTransition: true }}>
      <TooltipProvider>
        <NavTrailProvider>
          <NavArrows />
          <nav>
            <Link to="/operations/files">Files</Link>
            <Link to="/operations/files?focus=abc">Open dossier</Link>
            <Link to="/finance/invoices">Invoices</Link>
          </nav>
          <Routes>
            <Route path="/operations/files" element={<DossierScreen />} />
            <Route path="*" element={<h1>Elsewhere</h1>} />
          </Routes>
        </NavTrailProvider>
      </TooltipProvider>
    </BrowserRouter>
  );
}

const back = () => screen.getByRole("button", { name: /^Back/ });
const forward = () => screen.getByRole("button", { name: /^Forward/ });

/** jsdom applies `history.go()` asynchronously, and React Router only hears
 *  about it on the resulting popstate. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("NavArrows", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("stays out of the rail until there is a trail", () => {
    render(<Harness />);
    // One entry is not a trail. A pair of permanently dead arrows on a first
    // visit teaches nothing and takes rail height from the shortcuts.
    expect(screen.queryByRole("button", { name: /^Back/ })).toBeNull();
  });

  it("appears once the user has moved, and names where back leads", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Files"));

    await waitFor(() => expect(back()).toBeTruthy());
    // The destination, not a bare "Back" — this is the whole reason the trail
    // is a labelled record rather than a call to history.back().
    expect(back().getAttribute("aria-label")).toMatch(/Control Tower/);
    expect(forward().getAttribute("aria-disabled")).toBe("true");
  });

  it("steps back and forward over an opened record", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Files"));
    await user.click(screen.getByText("Open dossier"));
    await waitFor(() =>
      expect(window.location.search).toBe("?focus=abc"),
    );

    // Back closes the record and lands on the list it was opened from.
    await user.click(back());
    await settle();
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.location.pathname).toBe("/operations/files");

    // Forward re-opens the same record — the half a plain history.back()
    // wired to a `useState` modal can never do.
    await waitFor(() => expect(forward().getAttribute("aria-disabled")).toBe("false"));
    await user.click(forward());
    await settle();
    await waitFor(() => expect(window.location.search).toBe("?focus=abc"));
  });

  it("names a step from the screen rather than the route", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Files"));
    await user.click(screen.getByText("Invoices"));

    await waitFor(() =>
      expect(back().getAttribute("aria-label")).toMatch(/Dossier SLS-2481/),
    );
  });

  it("declines to walk out of the app", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Files"));
    await user.click(back());
    await settle();

    // At the oldest entry we hold. The browser would happily keep going, into
    // whatever was open in this tab before Praxis — with no address bar to
    // return from in an installed window.
    await waitFor(() => expect(back().getAttribute("aria-disabled")).toBe("true"));
    const before = window.location.pathname;
    await user.click(back());
    await settle();
    expect(window.location.pathname).toBe(before);
  });

  it("answers Alt+ArrowLeft and Alt+ArrowRight", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Files"));
    await waitFor(() => expect(window.location.pathname).toBe("/operations/files"));

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await settle();
    await waitFor(() => expect(window.location.pathname).toBe("/"));

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await settle();
    await waitFor(() => expect(window.location.pathname).toBe("/operations/files"));
  });

  it("leaves Alt+Arrow alone while the user is typing", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <input aria-label="Search" />
      </>,
    );
    await user.click(screen.getByText("Files"));
    await waitFor(() => expect(window.location.pathname).toBe("/operations/files"));

    await user.click(screen.getByLabelText("Search"));
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await settle();
    // On Windows that chord also moves the caret; stealing it would navigate
    // away from a half-filled form.
    expect(window.location.pathname).toBe("/operations/files");
  });

  it("opens the trail on a right-click, listing steps nearest first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Files"));
    await user.click(screen.getByText("Invoices"));

    await user.pointer({ keys: "[MouseRight]", target: back() });

    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0].textContent).toMatch(/Dossier SLS-2481/);
    expect(items[1].textContent).toMatch(/Control Tower/);

    // And it jumps the whole distance in one go.
    await user.click(items[1]);
    await settle();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });
});
