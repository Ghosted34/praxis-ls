/**
 * The one operations-file picker (13930).
 *
 * ── WHAT IS WORTH ASSERTING HERE ───────────────────────────────────────────
 *
 * Not that a combobox opens — Radix's job. The three things that are THIS
 * component's contract, each of which was a real defect before it existed:
 *
 *   · it never renders a raw uuid. The screens it replaces looked an id up in
 *     a list clamped to fifty files and printed `dossier_id.slice(0, 8)` when
 *     it missed;
 *   · it names its own value from an id alone, so no call site threads a
 *     reference that can fall out of step with the record;
 *   · an id it cannot resolve is a SENTENCE, not an empty control. A deleted
 *     file, or one this reader may not see, must not look like "nothing was
 *     ever chosen" — that reads as a bug in the form and invites the user to
 *     re-pick something that is already correct.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fixtures, apiClientMock } from "@/test/screen-harness";
import { OperationsFilePicker } from "./file-picker";

vi.mock("@/lib/api-client", async () => apiClientMock());

const FILE = {
  dossier_id: "11111111-1111-1111-1111-111111111111",
  ref: "SL-7Z3K9QW2M4XB-SM",
  client_name: "Brasseries du Cameroun",
  title: "Export of Beer",
  bl_mawb: "MAEU123456",
  service_name_en: "Sea Freight Export",
  created_at: "2026-07-27T00:00:00.000Z",
};

function renderPicker(props: Partial<React.ComponentProps<typeof OperationsFilePicker>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <OperationsFilePicker onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect };
}

beforeEach(() => {
  fixtures.current = { routes: { "/operations": [FILE] } };
});

describe("OperationsFilePicker — choosing a file", () => {
  it("is a combobox, not a select, so the whole tenant is reachable", () => {
    renderPicker();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("hands back the id when a row is chosen", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();
    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /SL-7Z3K9QW2M4XB-SM/ });
    await user.click(option);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      dossier_id: FILE.dossier_id,
      ref: FILE.ref,
    });
  });

  it("shows the client beside the reference, because a reference alone is not recognisable", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText(/Brasseries du Cameroun/)).toBeInTheDocument();
  });
});

describe("OperationsFilePicker — naming a value it was given", () => {
  it("resolves an id to its reference, so a caller passes no label", async () => {
    renderPicker({ value: FILE.dossier_id });
    expect(await screen.findByText(FILE.ref)).toBeInTheDocument();
    // The thing the clamped lists did instead.
    expect(screen.queryByText(/^11111111/)).not.toBeInTheDocument();
  });

  it("says so when an id resolves to nothing, rather than looking empty", async () => {
    fixtures.current = { routes: { "/operations": [] } };
    renderPicker({ value: "99999999-9999-9999-9999-999999999999" });
    expect(await screen.findByText(/cannot view/i)).toBeInTheDocument();
  });

  it("offers a way out only when the caller can take one", async () => {
    const onClear = vi.fn();
    renderPicker({ value: FILE.dossier_id, onClear });
    const change = await screen.findByRole("button", { name: /change/i });
    await userEvent.setup().click(change);
    expect(onClear).toHaveBeenCalled();
  });

  it("renders no Change button on a required field with no way out", async () => {
    renderPicker({ value: FILE.dossier_id });
    await screen.findByText(FILE.ref);
    expect(screen.queryByRole("button", { name: /change/i })).not.toBeInTheDocument();
  });
});
