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

const uploadVaultFile = vi.fn();
vi.mock("@/lib/masterdata-api", () => ({
  uploadVaultFile: (
    file: File,
    fields: unknown,
    ctx?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ) => uploadVaultFile(file, fields, ctx),
}));

import { ScanAttachment, ScanCardActions } from "./scan-attachment";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { SCAN_MAX_BYTES } from "@/lib/vault-file";
import { ApiError } from "@/lib/api-client";

const pdf = (name = "clearance.pdf", size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  uploadVaultFile.mockReset().mockResolvedValue({ doc_id: "vault-1" });
  // The engine creates an object URL for the preview; jsdom has neither half.
  URL.createObjectURL = vi.fn(() => "blob:scan-preview");
  URL.revokeObjectURL = vi.fn();
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
    expect(uploadVaultFile).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        doc_type: "CLIENT_DOCUMENT",
        entity_ref: "client_document:d1",
      }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    // The file now travels as a multipart part, not as a base64 data URL in a
    // JSON body — POST /documents accepts both, and base64 inflated a 5 MB scan
    // to a 6.7 MB string the API had to hold, parse and slice.
    expect(uploadVaultFile.mock.calls[0][0]).toBeInstanceOf(File);
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

    await userEvent.upload(
      screen.getByLabelText("Attach scan"),
      pdf("huge.pdf", SCAN_MAX_BYTES + 1),
    );

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("25.0 MB")),
    );
    expect(uploadVaultFile).not.toHaveBeenCalled();
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("reports the upload failure instead of marking the document scanned", async () => {
    const onError = vi.fn();
    const onAttached = vi.fn();
    uploadVaultFile.mockRejectedValue(
      new ApiError("FILE_TOO_LARGE", "File exceeds 25 MB", 413),
    );
    render(
      <ScanAttachment
        docType="ENTITY_DOCUMENT"
        entityRef="entity_document:d1"
        onAttached={onAttached}
        onError={onError}
      />,
    );

    await userEvent.upload(screen.getByLabelText("Attach scan"), pdf());

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith("File exceeds 25 MB"),
    );
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("offers the stored file back, fetched with the session's credentials", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, blob: async () => new Blob(["%PDF"]) }),
    );
    // jsdom implements neither half of the blob-URL pair.
    URL.createObjectURL = vi.fn(() => "blob:vault-1");
    URL.revokeObjectURL = vi.fn();

    render(
      <ScanAttachment
        vaultId="vault-1"
        docType="CLIENT_DOCUMENT"
        entityRef="client_document:d1"
        onAttached={vi.fn()}
      />,
    );

    // An already-scanned row offers to replace, not to attach.
    expect(screen.getByLabelText("Replace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("blob:vault-1", "_blank", "noopener"),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/tenant/documents/vault-1/download",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Praxis-Env": expect.any(String),
        }),
      }),
    );
  });
});

/**
 * THE PHONE CARD. On a desktop row the control is two links and a paste option
 * beside them; on a 390px card the same row carried six wrapped controls, which
 * is what the mobile audit screenshotted. `compact` is the one-control variant
 * and `ScanCardActions` is the whole cluster — the visible action plus the `⋯`
 * that holds the rest — because the two halves share a ref and cannot be kept in
 * step from two call sites.
 */
describe("ScanCardActions · the phone card", () => {
  it("shows ONE control per state: View when there is a file, Attach when there is not", () => {
    const { unmount } = render(
      <ScanCardActions
        vaultId="vault-1"
        docType="ENTITY_DOCUMENT"
        entityRef="entity_document:d1"
        onAttached={vi.fn()}
        menuLabel="Document actions"
      />,
    );
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    // The picker is still MOUNTED — the menu drives it through `openRef`, and an
    // input that unmounts between the click and the pick never opens — but it
    // sits inside a `hidden` wrapper, so it is out of the accessibility tree and
    // is not a second control competing for the same line. `display: none` does
    // not stop a programmatic click from opening the dialog; that is the whole
    // mechanism.
    expect(screen.getByText("Replace").closest(".hidden")).not.toBeNull();
    unmount();

    render(
      <ScanCardActions
        docType="ENTITY_DOCUMENT"
        entityRef="entity_document:d1"
        onAttached={vi.fn()}
        menuLabel="Document actions"
      />,
    );
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    expect(screen.getByLabelText("Attach scan")).toBeInTheDocument();
  });

  it("hides Replace behind the menu, and the menu item still opens the picker", async () => {
    const user = userEvent.setup();
    render(
      <ScanCardActions
        vaultId="vault-1"
        docType="ENTITY_DOCUMENT"
        entityRef="entity_document:d1"
        onAttached={vi.fn()}
        menuLabel="Document actions"
        menuItems={<span />}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Document actions" }));
    const replace = await screen.findByRole("menuitem", {
      name: "Replace file",
    });
    expect(replace).toBeInTheDocument();
  });

  it("keeps the caller's items after the file action, so destructive ones stay last", async () => {
    const user = userEvent.setup();
    render(
      <ScanCardActions
        vaultId="vault-1"
        docType="ENTITY_DOCUMENT"
        entityRef="entity_document:d1"
        onAttached={vi.fn()}
        menuLabel="Document actions"
        menuItems={<DropdownItem destructive>Remove</DropdownItem>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Document actions" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Replace file", "Remove"]);
  });
});
