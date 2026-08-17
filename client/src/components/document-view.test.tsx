/**
 * DocumentPage — pins the NATIVE rendering contract.
 *
 * The document page must stay in the app theme (the white print sheet does not
 * blend with the dark UI — the paper is what Download PDF produces), and the
 * operations documents must show their REAL fields, not the generic card body:
 * a delivery note is containers + reservations + who signed; a transit order
 * is vessel/BL/ports + regime + insurance + a document checklist.
 *
 * Each test asserts the bespoke blocks render AND that the white-sheet iframe
 * does not — the two halves of the same requirement.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  apiClientMock,
  authContextMock,
  renderScreen,
  fixtures,
} from "@/test/screen-harness";
import { DocumentPage } from "./document-view";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const PREVIEW = "/document-templates";

function dnPreview(over: Record<string, unknown> = {}) {
  return {
    html: "<html><body>the white sheet — never shown in-app</body></html>",
    sample: false,
    data: {
      number: "DN-2026-0052",
      date: "2026-07-27T10:00:00.000Z",
      delivery_date: "2026-07-28",
      dossier_ref: "SBX-2026-0001",
      status: "ISSUED",
      party: {
        name: "CIMENCAM SA",
        lines: ["Zone Industrielle, Douala", "+237 6 99 00 11 22"],
      },
      lines: [{ label: "Palettes ciment", qty: 24 }],
      containers: [
        { container_no: "TCLU1234567", seal_no: "SL889231" },
        { container_no: "MSKU7654321", seal_no: null },
      ],
      reservations: "Carton 3 crushed; contents intact.",
      received_by_name: "Jean Mballa",
      received_at: "2026-07-28T12:00:00.000Z",
      issued_by_name: "A. Njoya",
      currency: "XAF",
      ...over,
    },
    title: { fr: "Bon de livraison", en: "Delivery note" },
    entity: { legal_name: "Smart Logistics SA", niu: "P012345678" },
    suggested_to: null,
    report: false,
  };
}

function toPreview(over: Record<string, unknown> = {}) {
  return {
    html: "<html><body>the white sheet — never shown in-app</body></html>",
    sample: false,
    data: {
      number: "OT-2026-0001",
      date: "2026-07-27T10:00:00.000Z",
      status: "ISSUED",
      direction: "IMPORT",
      client: "CIMENCAM SA",
      dossier_ref: "SBX-2026-0001",
      conveyance: "CMA CGM IVORY COAST",
      transport_ref: "CMDU123456789",
      origin: "Shanghai",
      destination: "Douala",
      arrival_date: "2026-08-10",
      departure_date: "2026-08-14",
      place_of_delivery: "Warehouse 3, Bonabéri",
      lines: [
        {
          marks: "SLS/001",
          packages: "24",
          label: "Palettes ciment",
          weight: "24000",
          value: "12,000,000 CNY",
        },
      ],
      declared_value_text: "12,000,000 CNY",
      declared_value_xaf_text: "987,654,321 XAF",
      regimes: [
        { code: "IM4", on: true },
        { code: "IM7", on: false },
      ],
      customs_regime_other: null,
      insurance_type: "CLIENT",
      surveyor_party: "COMPANY",
      documents: [
        { code: "BL", label: "Bill of lading / Connaissement", on: true },
        { code: "PACKING", label: "Packing list / Liste de colisage", on: false },
      ],
      instructions: "Call ahead at the gate.",
      currency: "CNY",
      ...over,
    },
    title: { fr: "Ordre de transit", en: "Transit order" },
    entity: { legal_name: "Smart Logistics SA", niu: "P012345678" },
    suggested_to: null,
    report: false,
  };
}

const renderDoc = (docType: string, preview: unknown) =>
  renderScreen(<DocumentPage />, {
    path: `/documents/${docType}/abc`,
    pattern: "/documents/:docType/:id",
    routes: { [`${PREVIEW}/${docType}/preview`]: preview },
  });

/** The white sheet must never appear in-app for a record. */
const expectNoPaper = () =>
  expect(screen.queryByTitle("document")).toBeNull();

beforeEach(() => {
  fixtures.current = {};
});

describe("DocumentPage — delivery note", () => {
  it("renders the note's real fields natively, not the white sheet", async () => {
    renderDoc("DELIVERY_NOTE", dnPreview());
    expect(
      await screen.findByText("DN-2026-0052"),
    ).toBeInTheDocument();
    // Parties.
    expect(screen.getByText("Smart Logistics SA")).toBeInTheDocument();
    expect(screen.getByText("CIMENCAM SA")).toBeInTheDocument();
    // Delivery details.
    expect(screen.getByText("Delivery date")).toBeInTheDocument();
    expect(screen.getByText("SBX-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("A. Njoya")).toBeInTheDocument();
    // Containers — the part the generic view had no vocabulary for.
    expect(screen.getByText("TCLU1234567")).toBeInTheDocument();
    expect(screen.getByText(/seal SL889231/)).toBeInTheDocument();
    expect(screen.getByText("MSKU7654321")).toBeInTheDocument();
    // Cargo lines.
    expect(screen.getByText("Palettes ciment")).toBeInTheDocument();
    // Reservations and the named handover.
    expect(
      screen.getByText("Carton 3 crushed; contents intact."),
    ).toBeInTheDocument();
    expect(screen.getByText("Jean Mballa")).toBeInTheDocument();
    expectNoPaper();
  });

  it("omits the received-by card on a note nobody has signed yet", async () => {
    renderDoc(
      "DELIVERY_NOTE",
      dnPreview({
        status: "DRAFT",
        received_by_name: null,
        received_at: null,
      }),
    );
    await screen.findByText("DN-2026-0052");
    expect(screen.queryByText("Received by")).toBeNull();
  });
});

describe("DocumentPage — transit order", () => {
  it("renders the shipment facts, cargo, regime and checklist natively", async () => {
    renderDoc("TRANSIT_ORDER", toPreview());
    expect(await screen.findByText("OT-2026-0001")).toBeInTheDocument();
    // Shipment facts.
    expect(screen.getByText("CMA CGM IVORY COAST")).toBeInTheDocument();
    expect(screen.getByText("CMDU123456789")).toBeInTheDocument();
    expect(screen.getByText("Shanghai")).toBeInTheDocument();
    expect(screen.getByText("Warehouse 3, Bonabéri")).toBeInTheDocument();
    // Direction renders humanized (the app convention — Pill/StatusPill).
    expect(screen.getByText("Import")).toBeInTheDocument();
    // Cargo + declared value (the declared value echoes the line value).
    expect(screen.getByText("SLS/001")).toBeInTheDocument();
    expect(
      screen.getAllByText("12,000,000 CNY").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("987,654,321 XAF")).toBeInTheDocument();
    // Regime tick-row.
    expect(screen.getByText(/✓ IM4/)).toBeInTheDocument();
    expect(screen.getByText("IM7")).toBeInTheDocument();
    // Insurance / surveyor elections.
    expect(
      screen.getByText("Insurance carried by the client"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Damage surveyor appointed by us"),
    ).toBeInTheDocument();
    // Attached-document checklist.
    expect(
      screen.getByText("Bill of lading / Connaissement"),
    ).toBeInTheDocument();
    expect(screen.getByText("Call ahead at the gate.")).toBeInTheDocument();
    expectNoPaper();
  });
});

describe("DocumentPage — other doc types", () => {
  it("keeps the generic native view for non-operations documents", async () => {
    renderDoc("FINAL_INVOICE", {
      html: "<html><body>paper</body></html>",
      sample: false,
      data: {
        number: "FCT-2026-0001",
        date: "2026-07-27",
        status: "PAID",
        party: { name: "CIMENCAM SA", lines: ["Douala"] },
        lines: [{ label: "Transit maritime", qty: 2, unit: 450000, amount: 900000 }],
        totals: { service_ht: 900000, vat_total: 173250, total_ttc: 1073250 },
        currency: "XAF",
      },
      title: { fr: "Facture", en: "Invoice" },
      entity: { legal_name: "Smart Logistics SA" },
      suggested_to: null,
      report: false,
    });
    expect(await screen.findByText("FCT-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("CIMENCAM SA")).toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expectNoPaper();
  });

  it("shows the paper preview for reports (no record shape)", async () => {
    renderDoc("income_statement", {
      html: "<html><body>statement</body></html>",
      sample: true,
      data: null,
      title: { fr: "Compte de résultat", en: "Income statement" },
      entity: { legal_name: "Smart Logistics SA" },
      suggested_to: null,
      report: true,
    });
    expect(await screen.findByTitle("document")).toBeInTheDocument();
  });
});
