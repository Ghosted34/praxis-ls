/**
 * The operations-file link field — several stages per task (13950).
 *
 * What is proved here is the part a form gets wrong silently: that the
 * picked file's chain renders as toggleable checkboxes in chain order, that
 * ticking two stages reports a set of two (and un-ticking one reports one),
 * that "Clear milestones" empties the set and keeps the file, that clearing
 * the file empties everything, and that a file with no chain shows no stage
 * control at all. Plus the value helpers a card and a form both lean on.
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";

import { apiClientMock, fixtures } from "@/test/screen-harness";

// The picker names the chosen file itself through `/operations?ids=…`; the
// harness fake answers that from a fixture so the field renders a reference,
// not a spinner, and no real request is attempted.
vi.mock("@/lib/api-client", async () => apiClientMock());

const milestonesByDossier = vi.fn();
vi.mock("@/lib/operations-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations-api")>("@/lib/operations-api");
  return {
    ...actual,
    milestonesByDossier: (...a: unknown[]) => milestonesByDossier(...a),
  };
});

import { FileLinkField } from "./file-link-field";
import { EMPTY_LINK, linkOf, stageSummary, toggleStage } from "./file-link";
import type { FileLink } from "./file-link";

const FILE_ROW = { dossier_id: "d1", ref: "SL3213P44RG55ZSM", client_name: "Brasseries du Cameroun", title: "Export of beer" };

const CHAIN = [
  { milestone_instance_id: "m1", dossier_id: "d1", stage_seq: 1, code: "PRE", label: "Pré-alerte et ordre de travail", label_en: "Pre-alert & work order", status: "DONE" },
  { milestone_instance_id: "m2", dossier_id: "d1", stage_seq: 2, code: "DOC", label: "Documents vérifiés", label_en: "Shipping documents verified", status: "PENDING" },
  { milestone_instance_id: "m3", dossier_id: "d1", stage_seq: 7, code: "DEC", label: "Déclaration déposée", label_en: "Customs declaration lodged", status: "PENDING" },
];

const LINKED: FileLink = { dossier_id: "d1", milestone_instance_ids: [] };

function Harness({ initial, onChange }: { initial: FileLink; onChange?: (v: FileLink) => void }) {
  const [value, setValue] = React.useState(initial);
  // The picker resolves its value through TanStack Query, so the field needs
  // a client above it exactly as the dialog has one.
  const [qc] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <FileLinkField
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fixtures.current = { routes: { "/operations": [FILE_ROW] } };
});

afterEach(() => {
  cleanup();
  milestonesByDossier.mockReset();
});

describe("FileLinkField — the stage set", () => {
  it("renders the picked file's chain as checkboxes, in chain order, none ticked", async () => {
    milestonesByDossier.mockResolvedValue(CHAIN);
    const { container } = render(<Harness initial={LINKED} />);
    const group = await screen.findByRole("group", { name: "Milestones" });
    // The group is rendered WHILE the chain loads (aria-busy, "Loading
    // milestones…"), so finding it proves nothing about the chips. Await the
    // chips themselves — on a loaded runner the group can settle before the
    // setStages re-render commits, and getAllByRole then reads a spinner.
    const boxes = await within(group).findAllByRole("checkbox");
    expect(boxes.map((b) => b.textContent)).toEqual([
      "1Pre-alert & work order",
      "2Shipping documents verified",
      "3Customs declaration lodged",
    ]);
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByText("No milestone — the work is on the file as a whole")).toBeTruthy();
    expect(milestonesByDossier).toHaveBeenCalledWith("d1");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ticking two stages reports a set of two; un-ticking one reports one", async () => {
    milestonesByDossier.mockResolvedValue(CHAIN);
    const onChange = vi.fn();
    render(<Harness initial={LINKED} onChange={onChange} />);
    const group = await screen.findByRole("group", { name: "Milestones" });
    // Same race as above: the group exists from the first loading paint, the
    // checkboxes only once the chain resolves. Await one chip before ticking.
    await within(group).findByRole("checkbox", { name: /Shipping documents verified/ });
    fireEvent.click(within(group).getByRole("checkbox", { name: /Shipping documents verified/ }));
    fireEvent.click(within(group).getByRole("checkbox", { name: /Customs declaration lodged/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ milestone_instance_ids: ["m2", "m3"] }));
    expect(within(group).getByRole("checkbox", { name: /Shipping documents verified/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("2 stages selected")).toBeTruthy();

    fireEvent.click(within(group).getByRole("checkbox", { name: /Shipping documents verified/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ milestone_instance_ids: ["m3"] }));
    expect(screen.getByText("1 stage selected")).toBeTruthy();
  });

  it("\"Clear milestones\" empties the set and keeps the file", async () => {
    milestonesByDossier.mockResolvedValue(CHAIN);
    const onChange = vi.fn();
    render(<Harness initial={{ ...LINKED, milestone_instance_ids: ["m1", "m3"] }} onChange={onChange} />);
    await screen.findByRole("group", { name: "Milestones" });
    fireEvent.click(screen.getByRole("button", { name: "Clear milestones" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...LINKED, milestone_instance_ids: [] });
    // The file is still shown (named by the picker itself), the set is
    // empty, the button is gone.
    expect(await screen.findByText("SL3213P44RG55ZSM")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear milestones" })).toBeNull();
  });

  it("changing away from the file clears everything", async () => {
    milestonesByDossier.mockResolvedValue(CHAIN);
    const onChange = vi.fn();
    render(<Harness initial={{ ...LINKED, milestone_instance_ids: ["m2"] }} onChange={onChange} />);
    await screen.findByRole("group", { name: "Milestones" });
    // The picker's own "Change" — the one control that unpicks a file.
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_LINK);
    await waitFor(() => expect(screen.queryByRole("group", { name: "Milestones" })).toBeNull());
  });

  it("a file with no chain offers no stage control", async () => {
    milestonesByDossier.mockResolvedValue([]);
    render(<Harness initial={LINKED} />);
    await waitFor(() => expect(milestonesByDossier).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading milestones…")).toBeNull());
    expect(screen.queryByRole("group", { name: "Milestones" })).toBeNull();
  });
});

describe("file-link values", () => {
  it("linkOf reads the set, and falls back to 13920's single column for an older row", () => {
    expect(linkOf({ dossier_id: "d1", milestone_instance_ids: ["m2", "m3", "m2"] }).milestone_instance_ids).toEqual(["m2", "m3"]);
    expect(linkOf({ dossier_id: "d1", milestone_instance_id: "m1" }).milestone_instance_ids).toEqual(["m1"]);
    expect(linkOf({ dossier_id: "d1", milestone_instance_id: "m1", milestone_instance_ids: [] }).milestone_instance_ids).toEqual([]);
    expect(linkOf(null)).toEqual(EMPTY_LINK);
  });

  it("toggleStage adds an absent stage and removes a present one, never duplicating", () => {
    expect(toggleStage([], "m1")).toEqual(["m1"]);
    expect(toggleStage(["m1"], "m2")).toEqual(["m1", "m2"]);
    expect(toggleStage(["m1", "m2"], "m1")).toEqual(["m2"]);
  });

  it("stageSummary names the first stage and counts the rest", () => {
    expect(stageSummary({ milestones: [{ label: "Pre-alert" }, { label: "Customs" }, { label: "Delivery" }] })).toBe("Pre-alert +2");
    expect(stageSummary({ milestones: [{ label: "Pre-alert" }] })).toBe("Pre-alert");
    expect(stageSummary({ milestones: [], milestone_label: "Old column" })).toBe("Old column");
    expect(stageSummary({ milestones: [] })).toBeNull();
  });
});
