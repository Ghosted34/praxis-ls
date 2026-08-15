/**
 * Regression coverage for the garbled-sentence bugs found on the Control
 * Tower "Recent activity" widget: "You did applicant updated on a vacancy"
 * and "You did converted from client on a supplier" (both read verbatim off
 * a real ledger row), plus the "role.changed" / "*_status_changed" shapes
 * found while tracing the same root cause (VERBS is an exact-match lookup
 * on the whole last action segment, so any multi-word segment falls all the
 * way to the "You did <verb> on <noun>" generic layer).
 */
import { describe, expect, it } from "vitest";
import { humanize } from "./audit-humanize";
import type { AuditFeedRow } from "@/features/dashboard/use-my-audit-feed";

function row(action: string, entity_ref: string | null = null): AuditFeedRow {
  return {
    ledger_id: 1,
    created_at: new Date().toISOString(),
    action,
    module_key: null,
    entity_ref,
    metadata: null,
    is_sensitive: false,
    actor_name_snapshot: null,
  };
}

describe("humanize", () => {
  it("reads a vacancy applicant update as a sentence, not 'You did applicant updated on a vacancy'", () => {
    expect(humanize(row("vacancy.applicant_updated", "vacancy:v1")).text).toBe(
      "You updated an applicant",
    );
    expect(humanize(row("vacancy.applicant_added", "vacancy:v1")).text).toBe(
      "You added an applicant to a vacancy",
    );
  });

  it("reads the hire-provisioning event", () => {
    expect(humanize(row("employee_provisioned", "employee:e1")).text).toBe(
      "You hired an applicant",
    );
  });

  it("reads a client/supplier Smart Copy conversion, not 'You did converted from client on a supplier'", () => {
    expect(
      humanize(row("supplier.converted_from_client", "supplier:s1")).text,
    ).toBe("You converted a client into a supplier");
    expect(
      humanize(row("client.converted_from_supplier", "client:c1")).text,
    ).toBe("You converted a supplier into a client");
  });

  it("reads a role change — the actually-emitted key is 'role.changed', not 'role.updated'", () => {
    const r = humanize(row("role.changed", "role:r1"));
    expect(r.text).toBe("You changed a role");
    expect(r.sensitive).toBe(true);
  });

  it("reads a user capability change", () => {
    expect(
      humanize(row("user.capability.changed", "user_capability:u1")).text,
    ).toBe("You changed a user's capabilities");
  });

  it("reads party block/unblock/verify via the generic verb+noun composition", () => {
    expect(humanize(row("supplier.blocked", "supplier:s1")).text).toBe(
      "You blocked a supplier",
    );
    expect(humanize(row("client.unblocked", "client:c1")).text).toBe(
      "You unblocked a client",
    );
    expect(humanize(row("client.verified", "client:c1")).text).toBe(
      "You verified a client",
    );
    expect(
      humanize(row("campaign_sender.verified", "campaign_sender:cs1")).text,
    ).toBe("You verified a campaign sender");
  });

  it("composes '<field>_changed' actions instead of the ungrammatical generic fallback", () => {
    expect(humanize(row("vehicle.status_changed", "vehicle:v1")).text).toBe(
      "You changed a vehicle's status",
    );
    expect(humanize(row("entity.structure_changed", "entity:e1")).text).toBe(
      "You changed a corporate entity's structure",
    );
    expect(humanize(row("party.bank_account_changed", null)).text).toBe(
      "You changed a party's bank account",
    );
  });

  it("still falls back to readable English for a genuinely unknown action", () => {
    // No domain segment and no entity_ref — nothing to name as the noun, so
    // this exercises the bare "You did <verb>" tail of the generic fallback.
    const r = humanize(row("totally_unmapped"));
    expect(r.text).toBe("You did totally unmapped");
    expect(r.kind).toBe("generic");
  });
});
