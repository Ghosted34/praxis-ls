/**
 * WHICH MAILBOX A SCREEN OPENS ON, WHEN NOBODY HAS SAID.
 *
 * This is not a cosmetic default. The inbox is mailbox-scoped — folders, their
 * unread counts and the People/Notices totals all belong to one connection — so
 * a screen with no mailbox selected is a screen with no folders, and that is
 * exactly what the inbox used to show: "No folders yet — sync the mailbox to
 * discover them", over a mailbox that had synced fine, with no way out for
 * anyone who had only one (the picker appears at two).
 *
 * The order below is duplicated in `thread.repo.defaultConnectionFor` on the
 * server, so that an API call naming no mailbox and a screen opening with none
 * land on the SAME mailbox. If one of the two changes, change both — a person
 * whose client and server disagree about their primary address sees counts that
 * do not match the rows.
 */
import { describe, it, expect } from "vitest";
import { primaryMailbox, type Mailbox } from "./mail-api";

const box = (over: Partial<Mailbox>): Mailbox =>
  ({
    email_connection_id: "c",
    email_address: "someone@company.cm",
    provider: "imap_smtp",
    kind: "SHARED",
    status: "CONNECTED",
    health: { level: "OK", reason: "Syncing normally" },
    ...over,
  }) as Mailbox;

describe("primaryMailbox", () => {
  it("takes the person's own choice first", () => {
    const chosen = box({ email_connection_id: "c3", is_default: true });
    expect(
      primaryMailbox([box({ email_connection_id: "c1", kind: "PERSONAL" }), chosen])
        ?.email_connection_id,
    ).toBe("c3");
  });

  it("falls back to the address that is theirs, not one they were granted", () => {
    const mine = box({ email_connection_id: "c2", kind: "PERSONAL" });
    expect(
      primaryMailbox([box({ email_connection_id: "c1" }), mine])?.email_connection_id,
    ).toBe("c2");
  });

  it("prefers a mailbox that is actually connected to one that is broken", () => {
    const working = box({ email_connection_id: "c2" });
    expect(
      primaryMailbox([box({ email_connection_id: "c1", status: "ERROR" }), working])
        ?.email_connection_id,
    ).toBe("c2");
  });

  it("still answers when every mailbox is broken — a rail on a bad mailbox beats no rail", () => {
    expect(
      primaryMailbox([
        box({ email_connection_id: "c1", status: "ERROR" }),
        box({ email_connection_id: "c2", status: "PENDING" }),
      ])?.email_connection_id,
    ).toBe("c1");
  });

  it("is null only when the person genuinely has no mailbox", () => {
    // The screen has its own answer for this one: "No mailbox is connected to
    // your account yet", with a link to set one up. It must not be reached by
    // someone who HAS a mailbox.
    expect(primaryMailbox([])).toBeNull();
  });
});
