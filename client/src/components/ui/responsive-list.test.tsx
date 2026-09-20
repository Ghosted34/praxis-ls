/**
 * ResponsiveList — a table on a desktop, cards on a phone, and only ever ONE of
 * them in the document.
 *
 * THE SECOND ASSERTION IS THE POINT. The tempting implementation wraps both
 * renderings in `hidden md:block` / `md:hidden`, which passes every visual check
 * and puts two copies of every row action in the accessibility tree. jsdom does
 * not implement `matchMedia` (so the hook's default — "the desktop branch" —
 * applies, which is why the tests above this file see the table), so the compact
 * branch is exercised by stubbing it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ResponsiveList, RecordCard } from "./responsive-list";

/** Force the compact branch: every query above `md` answers false. */
function stubCompact() {
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
}

afterEach(() => vi.unstubAllGlobals());

const DOCS = [
  { id: "d1", title: "Certificate of incorporation" },
  { id: "d2", title: "Tax clearance 2026" },
];

const table = (
  <table>
    <thead>
      <tr>
        <th>Document</th>
      </tr>
    </thead>
    <tbody>
      {DOCS.map((d) => (
        <tr key={d.id}>
          <td>
            {d.title} <button type="button">Verify</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

describe("ResponsiveList", () => {
  it("renders the table it was given when matchMedia is absent (the default branch)", () => {
    render(
      <ResponsiveList
        items={DOCS}
        renderItem={(d) => (
          <div data-testid="card">{d.title}</div>
        )}
      >
        {table}
      </ResponsiveList>,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    // The cards did not render as well. Rendering both shells and hiding one
    // with CSS is the thing this primitive exists to make impossible: it would
    // put two of every row action in the accessibility tree.
    expect(screen.queryAllByTestId("card")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Verify" })).toHaveLength(
      DOCS.length,
    );
  });

  it("renders cards instead of the table below md — one of each control, not two", () => {
    stubCompact();
    render(
      <ResponsiveList
        items={DOCS}
        renderItem={(d) => (
          <RecordCard
            title={d.title}
            actions={<button type="button">Verify</button>}
          />
        )}
      >
        {table}
      </ResponsiveList>,
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(DOCS.length);
    expect(screen.getAllByRole("button", { name: "Verify" })).toHaveLength(
      DOCS.length,
    );
    expect(screen.getByText("Tax clearance 2026")).toBeInTheDocument();
  });

  it("has nothing to render below md when there are no records", () => {
    stubCompact();
    render(
      <ResponsiveList
        items={[]}
        empty={<p>Nothing here yet.</p>}
        renderItem={() => <RecordCard title="unreachable" />}
      >
        {table}
      </ResponsiveList>,
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});

describe("RecordCard", () => {
  it("states the record in reading order: title, pills, facts, actions", () => {
    render(
      <RecordCard
        title="Tax clearance 2026"
        subtitle="CM · 12/03/2026"
        pills={<span>Verified</span>}
        meta={[
          ["Type", "Tax clearance"],
          ["Expires", "12/03/2026"],
          // Empty facts are dropped rather than rendered as an em dash in a
          // card that already has a "no data" story of its own.
          ["Number", "—"],
        ]}
        actions={<button type="button">View</button>}
      />,
    );

    expect(screen.getByText("Tax clearance 2026")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.queryByText("Number")).toBeNull();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
  });

  it("keeps the leading control in the card's first line, where the selection lives", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <RecordCard
        leading={
          <input type="checkbox" aria-label="Select RCCM" onChange={onToggle} />
        }
        title="RCCM"
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Select RCCM" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
