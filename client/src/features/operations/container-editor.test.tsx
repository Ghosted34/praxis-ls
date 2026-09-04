/**
 * The container editor's per-box detail.
 *
 * WHAT THESE PIN. A file in PER_BOX mode records more than a number per box —
 * the weights, the reefer temperature, the hazmat class and the port dates are
 * what make a per-container-per-day charge exact. They live behind a
 * disclosure, so the two properties worth protecting are: (1) they do NOT crowd
 * the dialog until asked for, and (2) once entered they are actually SENT, not
 * dropped on the way to the API. A regression in either is silent — the number
 * still saves — so it is asserted here.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const putDossierContainers = vi.fn();
const getDossierContainers = vi.fn();
const listDictRefs = vi.fn();

vi.mock("@/lib/operations-api", () => ({
  getDossierContainers: (...a: unknown[]) => getDossierContainers(...a),
  putDossierContainers: (...a: unknown[]) => putDossierContainers(...a),
}));
vi.mock("@/lib/masterdata-api", () => ({
  listDictRefs: (...a: unknown[]) => listDictRefs(...a),
}));

import { ContainerEditor } from "./container-editor";

/** `useResource` reads a QueryClient from context, so the editor needs a
 *  provider even in isolation. Retries off so a rejected fetch fails fast. */
const renderEditor = (ui: React.ReactElement) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
};

const TYPE = {
  ref_id: "t-40hc",
  code: "40HC",
  name_en: "40' High Cube",
  name_fr: "40' High Cube",
  extra: { family: "High Cube", teu: 2 },
  is_active: true,
};

/** One box, already identified, carrying a gross weight — so the load path is
 *  exercised, not only the save path. */
const BLOCK = {
  enabled: true,
  mode: "PER_BOX",
  lines: [
    {
      dossier_container_line_id: "l-1",
      container_type_ref_id: "t-40hc",
      load_mode_ref_id: null,
      qty: 1,
      units: [
        {
          dossier_container_unit_id: "u-1",
          container_no: "MSKU1234567",
          seal_no: "SL-9",
          gross_weight_kg: 21000,
          tare_kg: null,
          temperature_c: null,
          imdg_class: null,
          out_of_port_on: null,
          discharged_on: null,
          returned_on: null,
          notes: null,
        },
      ],
    },
  ],
  summary: { lines: 1, boxes: 1, teu: 2, identified: 1 },
};

beforeEach(() => {
  putDossierContainers.mockReset().mockResolvedValue(BLOCK);
  getDossierContainers.mockReset().mockResolvedValue(BLOCK);
  listDictRefs
    .mockReset()
    .mockImplementation((kind: string) =>
      Promise.resolve(kind === "CONTAINER_TYPE" ? [TYPE] : []),
    );
});

describe("ContainerEditor — per-box advanced detail", () => {
  it("keeps the advanced fields behind a disclosure until asked", async () => {
    renderEditor(
      <ContainerEditor dossierId="d-1" mode="PER_BOX" onClose={() => {}} />,
    );
    // The number loaded from the file shows straight away…
    expect(await screen.findByDisplayValue("MSKU1234567")).toBeInTheDocument();
    // …but the weights/dates grid does not, until "More detail" is clicked.
    expect(screen.queryByLabelText(/Gross weight kg/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /More detail/ }));

    // The loaded gross weight surfaces once expanded.
    expect(await screen.findByDisplayValue("21000")).toBeInTheDocument();
  });

  it("sends the advanced per-box fields, not only the number", async () => {
    renderEditor(
      <ContainerEditor
        dossierId="d-1"
        mode="PER_BOX"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await screen.findByDisplayValue("MSKU1234567");
    await userEvent.click(screen.getByRole("button", { name: /More detail/ }));

    await userEvent.type(
      await screen.findByLabelText(/Temperature °C/),
      "-18",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Save containers/ }),
    );

    expect(putDossierContainers).toHaveBeenCalledTimes(1);
    const [, lines] = putDossierContainers.mock.calls[0];
    expect(lines[0].units[0]).toMatchObject({
      container_no: "MSKU1234567",
      seal_no: "SL-9",
      gross_weight_kg: 21000,
      temperature_c: -18,
    });
  });
});
