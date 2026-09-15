/**
 * THE DOCUMENT FIELD ASKED FOR A UUID.
 *
 * Comms → Setup → Secure links → Create a link had a text box captioned "The
 * vault document id this link should serve". Nobody knows a document's uuid, so
 * the box got the document's NAME, `target_ref` reached Postgres as a string
 * that is not one, and 22P02 came back to the operator as "One of the values is
 * in the wrong format" — a sentence naming neither the field nor the format.
 *
 * A link points at a document, so the control offers documents. These tests are
 * about the property that makes the screen usable at all: nothing here can be
 * completed by typing, and what leaves the browser is the id.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import * as mailApi from "@/lib/mail-api";
import { SecureLinksTab } from "./secure-links";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

/**
 * Only the mint call is faked. The harness matches fixtures by PATH, and
 * `/mail/secure-links` is both the list (an array) and the mint (one row), so a
 * fixture cannot serve both — and the mint's own argument is what these tests
 * are about.
 */
vi.mock("@/lib/mail-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mail-api")>("@/lib/mail-api");
  return {
    ...actual,
    createSecureLink: vi.fn(async () => ({
      secure_link_id: "s-new",
      target_kind: "VAULT_DOC" as const,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      token: "tok-123",
      url: "https://praxis.test/s/tok-123",
    })),
  };
});

const mint = () => mailApi.createSecureLink as unknown as Mock;

const documents = [
  { doc_id: "11111111-2222-3333-4444-555555555555", original_name: "Proposal 235.pdf", status: "VERIFIED" },
  { doc_id: "99999999-8888-7777-6666-555555555555", original_name: "Old quote.pdf", status: "ARCHIVED" },
];

beforeEach(() => vi.clearAllMocks());

async function openMintDialog() {
  const user = userEvent.setup();
  renderScreen(<SecureLinksTab />, {
    routes: { "/mail/secure-links": [], "/documents": documents },
  });
  const buttons = await screen.findAllByRole("button", { name: "Create a link" });
  await user.click(buttons[0]);
  return user;
}

describe("choosing what a secure link serves", () => {
  it("offers the vault's documents by name rather than asking for an id", async () => {
    const user = await openMintDialog();

    expect(screen.queryByPlaceholderText("doc id")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Document" }));
    expect(await screen.findByRole("option", { name: "Proposal 235.pdf" })).toBeInTheDocument();
  });

  it("does not offer an archived document — a link would serve withdrawn bytes", async () => {
    const user = await openMintDialog();

    await user.click(screen.getByRole("button", { name: "Document" }));
    expect(await screen.findByRole("option", { name: "Proposal 235.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old quote.pdf" })).not.toBeInTheDocument();
  });

  it("sends the chosen document's id, and cannot be submitted without one", async () => {
    const user = await openMintDialog();

    // The name is what the operator reads; the id is what the API is given.
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Document" }));
    await user.click(await screen.findByRole("option", { name: "Proposal 235.pdf" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(mint()).toHaveBeenCalledTimes(1);
    expect(mint().mock.calls[0][0]).toMatchObject({
      target_kind: "VAULT_DOC",
      target_ref: documents[0].doc_id,
    });
  });
});
