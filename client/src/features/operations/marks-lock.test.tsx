/**
 * Marks & numbers, in the detail form, is locked to the containers on an
 * equipment file.
 *
 * The field is generated from the boxes. On a containerised service type there
 * is no way to type over it here — the container editor is the only place it
 * changes, and the server refuses a manual value anyway. On a non-equipment
 * service type (break-bulk, whose marks are the shipper's own) the manual
 * override stays, because that is the case the unlock was built for.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DetailFieldGroups } from "./detail-fields";

const marksGroup = {
  code: "CARGO",
  label: "Cargo",
  seq: 10,
  fields: [
    {
      key: "marks_numbers",
      label: "Marks & numbers",
      data_type: "TEXTAREA",
      width: "FULL",
      is_required: false,
      is_client_visible: true,
      is_readonly: true,
    },
  ],
};

function renderMarks(capturesContainers: boolean) {
  renderScreen(
    <DetailFieldGroups
      groups={[marksGroup] as never}
      values={{ marks_numbers: "03*45'HC, 02*40'HC" }}
      onChange={vi.fn()}
      capturesContainers={capturesContainers}
    />,
    { routes: {} },
  );
}

describe("marks & numbers in the detail form", () => {
  it("is read-only and points to the container editor on an equipment file", () => {
    renderMarks(true);
    expect(screen.getByText("03*45'HC, 02*40'HC")).toBeInTheDocument();
    // No unlock — the value cannot be typed over on a containerised file.
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.getByText(/Mirrors the boxes/)).toBeInTheDocument();
  });

  it("keeps the manual override on a non-equipment file", () => {
    renderMarks(false);
    // Break-bulk marks are the shipper's own — the unlock stays.
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });
});
