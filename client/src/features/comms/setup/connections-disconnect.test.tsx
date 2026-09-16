import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, fixtures } from "@/test/screen-harness";
import { ConnectionsTab } from "./mailboxes";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

const connection = {
  email_connection_id: "c1", email_address: "me@example.com",
  provider: "microsoft_graph", status: "CONNECTED", is_default: true,
};

describe("connection actions after disconnect", () => {
  it("replaces Disconnect with Connect after the archived row reloads", async () => {
    const user = userEvent.setup();
    renderScreen(<ConnectionsTab />, { routes: { "/mail/connections": [connection] } });
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    fixtures.current.routes = { "/mail/connections": [{ ...connection, status: "ARCHIVED" }] };
    await user.click(screen.getByRole("button", { name: "Disconnect mailbox" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
  });
});
