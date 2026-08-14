/**
 * ScanAttachment — the contract every register's Documents tab now rests on.
 *
 * WHAT THIS PROTECTS. Two calls, in order: the bytes go to the vault, and only
 * then does the caller get an id to patch onto its record. Collapse that into
 * one and a party document silently keeps `scan_status: PENDING` for good, which
 * is precisely the state clients and suppliers were stuck in before this control
 * existed — the API accepted `vault_id` the whole time and nothing could send
 * one.
 *
 * It also pins the `doc_type` the file is filed under. That string is not
 * cosmetic: `moduleKeyForDocType` turns it into the grant needed to READ the
 * file back, and an unregistered value falls through to MOD-70 (Settings). Pass
 * the master-data document type here instead of the vault's own code and the
 * operator who uploaded a scan cannot open it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const uploadVaultDocument = vi.fn();
vi.mock("@/lib/masterdata-api", () => ({ uploadVaultDocument: (b: unknown, p?: (percent: number) => void) => uploadVaultDocument(b, p) }));

import { ScanAttachment } from "./scan-attachment";
import { SCAN_MAX_BYTES } from "@/lib/vault-file";
import { ApiError } from "@/lib/api-client";

const pdf = (name = "clearance.pdf", size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  uploadVaultDocument.mockReset().mockResolvedValue({ doc_id: "vault-1" });
});
afterEach(() => vi.restoreAllMocks());

describe("ScanAttachment", () => {
  it("uploads the picked file to the vault, then hands the id back to the record", async () => {
    const onAttached = vi.fn();
    render(
      <ScanAttachment
        docType="CLIENT_DOCUMENT"
        entityRef="client_document:d1"
        onAttached={onAttached}
      />,
    );

    await userEvent.upload(screen.getByLabelText("Attach scan"), pdf());

    await waitFor(() => expect(onAttached).toHaveBeenCalledWith("vault-1"));
    expect(uploadVaultDocument).toHaveBeenCalledWith(
      expect.objectContaining({ doc_type: "CLIENT_DOCUMENT", entity_ref: "client_document:d1" }),
      expect.any(Function),
    );
    // The file is sent as the base64 data URL POST /documents parses, not as a
    // FormData part — the endpoint accepts nothing else.
    expect(String(uploadVaultDocument.mock.calls[0][0].data_url)).toMatch(/^data:application\/pdf;base64,/);
  });

  it("refuses a file the vault would reject, without uploading it", async () => {
    const onError = vi.fn();
    const onAttached = vi.fn();
    render(
      <ScanAttachment
        docType="ENTITY_DOCUMENT"
        entityRef="entity_document:d1"
        onAttached={onAttached}
        onError={onError}
      />,
    );

    await userEvent.upload(screen.getByLabelText("Attach scan"), pdf("huge.pdf", SCAN_MAX_BYTES + 1));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("25.0 MB")));
    expect(uploadVaultDocument).not.toHaveBeenCalled();
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("reports the upload failure instead of marking the document scanned", async () => {
    const onError = vi.fn();
    const onAttached = vi.fn();
    uploadVaultDocument.mockRejectedValue(new ApiError("FILE_TOO_LARGE", "File exceeds 25 MB", 413));
    render(
      <ScanAttachment docType="ENTITY_DOCUMENT" entityRef="entity_document:d1" onAttached={onAttached} onError={onError} />,
    );

    await userEvent.upload(screen.getByLabelText("Attach scan"), pdf());

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("File exceeds 25 MB"));
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("offers the stored file back, fetched with the session's credentials", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["%PDF"]) }));
    // jsdom implements neither half of the blob-URL pair.
    URL.createObjectURL = vi.fn(() => "blob:vault-1");
    URL.revokeObjectURL = vi.fn();

    render(
      <ScanAttachment vaultId="vault-1" docType="CLIENT_DOCUMENT" entityRef="client_document:d1" onAttached={vi.fn()} />,
    );

    // An already-scanned row offers to replace, not to attach.
    expect(screen.getByLabelText("Replace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => expect(open).toHaveBeenCalledWith("blob:vault-1", "_blank", "noopener"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/tenant/documents/vault-1/download",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Praxis-Env": expect.any(String) }) }),
    );
  });
});
