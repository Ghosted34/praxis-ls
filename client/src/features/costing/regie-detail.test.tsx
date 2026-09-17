/**
 * Régie retirement — the proof box is a document, not a uuid to paste.
 *
 * THE LAST PASTE-A-UUID PROOF CAPTURE in the finance domain (guide §8.3).
 * It used to be a bare `<Input>` labelled "Proof document id" where the holder
 * pasted a vault uuid they had no way to get; it is now the upload engine
 * (CLAUDE.md rule 3, FRONTEND_GUIDE §3.13): `useUpload({ profile: "document",
 * autoStart: false })` + `<FilePicker>` + `<UploadList>`, uploading on Save.
 *
 * What the vault accepted for this box: `doc_type: "COST_PROOF"`, with the
 * form's own required Operations-file id as `dossier_id`. The dossier is
 * ALWAYS present on this path — RECEIPT demands it (4731 is analytic, and Save
 * is disabled without it), so the server's COST_PROOF widening (15 MB,
 * pdf/image/word/excel, sniffed — document_vault.controller.js, gated on
 * dossier_id) applies cleanly. There is no dossier-less path from this box.
 *
 * Semantics kept: the proof stays OPTIONAL client-side — whether an
 * undocumented receipt is refused is the tenant setting
 * `finance.regie.require_proof_for_receipt`, decided server-side in regie
 * service's retireCore. The form does not re-decide it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => {
  const mock = await apiClientMock();
  return {
    ...mock,
    // The multipart upload the engine performs on Save — the vault's answer
    // is the id the retirement carries.
    uploadFile: vi.fn(async (_path: string, _file: File, opts: { onProgress?: (p: number) => void } = {}) => {
      opts.onProgress?.(100);
      return { doc_id: "vault-proof-1" };
    }),
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as apiClient from "@/lib/api-client";
import { RegieDetail } from "./regie-detail";

const ADVANCE = {
  regie_advance_id: "r-1",
  ref: "REG-2026-0117",
  doc_number: "REG-2026-0117",
  state: "ISSUED",
  currency: "XAF",
  amount: 100000,
  open_balance: 100000,
  justified_amount: 0,
  returned_amount: 0,
  issued_on: "2026-09-01",
  days_to_window: 29,
  is_aged: false,
  next: ["RECEIPT", "CASH_RETURN", "QUERIED"],
  retirements: [],
};

const routes = (extra: Record<string, unknown> = {}) => ({
  "/regie/r-1": ADVANCE,
  "/operations": [{ dossier_id: "d-1", ref: "SLAS-OPS-2026-0117" }],
  ...extra,
});

const pdf = (name = "port-invoice.pdf") =>
  new File([new Uint8Array(1024)], name, { type: "application/pdf" });

async function openRetire(user: ReturnType<typeof userEvent.setup>) {
  renderScreen(<RegieDetail advanceId="r-1" />, { routes: routes() });
  await user.click(await screen.findByRole("button", { name: "Retire" }));
  await screen.findByText("Retire advance");
}

describe("the retirement proof box (guide §8.3)", () => {
  // The uploadFile mock is module-level (inside vi.mock), so its call history
  // would otherwise leak from one test to the next.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is the upload engine, not a paste-a-uuid textbox", async () => {
    const user = userEvent.setup();
    await openRetire(user);

    // The old control is gone — no field asks for an id to paste.
    expect(screen.queryByLabelText("Proof document id")).not.toBeInTheDocument();

    // The engine's control is there: a file input behind a named label, the
    // only raw file input in the form (FilePicker is one of the only two in
    // the whole client, by design).
    const picker = screen.getByLabelText("Attach the receipt or invoice");
    expect(picker).toHaveAttribute("type", "file");
    const form = screen.getByRole("dialog");
    const fileInputs = Array.from(form.querySelectorAll("input[type=file]"));
    expect(fileInputs).toHaveLength(1);
    // The hint keeps the tenant-setting semantics the server enforces.
    expect(screen.getByText(/required unless the tenant has relaxed require_proof_for_receipt/i)).toBeInTheDocument();
  });

  it("picks a file, uploads it on Save, and the vault id lands on the retirement", async () => {
    const user = userEvent.setup();
    const uploadFile = apiClient.uploadFile as ReturnType<typeof vi.fn>;
    const postSpy = vi.spyOn(apiClient, "tenant");

    await openRetire(user);

    await user.type(screen.getByLabelText(/^amount/i), "40000");
    await user.selectOptions(screen.getByLabelText(/^operations file/i), "d-1");
    await user.upload(screen.getByLabelText("Attach the receipt or invoice"), pdf());

    // The file is picked, not yet uploaded — autoStart is false; Save does it.
    expect(uploadFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Record retirement" }));

    // The upload went out with the box's own dossier and the COST_PROOF type.
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    const [uploadPath, , uploadOpts] = uploadFile.mock.calls[0];
    expect(String(uploadPath)).toContain("/tenant/documents");
    expect(uploadOpts?.fields).toMatchObject({
      doc_type: "COST_PROOF",
      dossier_id: "d-1",
      original_name: "port-invoice.pdf",
    });

    // …and the retirement carries the vault's answer, not a pasted uuid.
    await waitFor(() => {
      const call = postSpy.mock.calls.find(
        ([p, o]) => String(p).includes("/regie/r-1/retire") && (o as { method?: string })?.method === "POST",
      );
      expect(call).toBeTruthy();
      expect(call?.[1]).toMatchObject({
        body: {
          kind: "RECEIPT",
          amount: 40000,
          dossier_id: "d-1",
          proof_vault_id: "vault-proof-1",
        },
      });
    });
    postSpy.mockRestore();
  });

  it("stays optional when no file is picked — the server, not the form, decides", async () => {
    const user = userEvent.setup();
    const postSpy = vi.spyOn(apiClient, "tenant");
    const uploadFile = apiClient.uploadFile as ReturnType<typeof vi.fn>;

    await openRetire(user);

    await user.type(screen.getByLabelText(/^amount/i), "40000");
    await user.selectOptions(screen.getByLabelText(/^operations file/i), "d-1");
    await user.click(screen.getByRole("button", { name: "Record retirement" }));

    expect(uploadFile).not.toHaveBeenCalled();
    await waitFor(() => {
      const call = postSpy.mock.calls.find(
        ([p, o]) => String(p).includes("/regie/r-1/retire") && (o as { method?: string })?.method === "POST",
      );
      expect(call).toBeTruthy();
      expect(call?.[1]).toMatchObject({
        body: { kind: "RECEIPT", amount: 40000, dossier_id: "d-1" },
      });
      // No proof key at all: absent, not null — the server's policy applies.
      expect((call?.[1] as { body: Record<string, unknown> }).body.proof_vault_id).toBeUndefined();
    });
    postSpy.mockRestore();
  });

  it("never carries a proof off the RECEIPT leg — switching kind drops it", async () => {
    const user = userEvent.setup();

    await openRetire(user);
    await user.upload(screen.getByLabelText("Attach the receipt or invoice"), pdf());
    expect(screen.getByLabelText("Attach the receipt or invoice")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^kind/i), "CASH_RETURN");
    expect(screen.queryByLabelText("Attach the receipt or invoice")).not.toBeInTheDocument();
  });
});
