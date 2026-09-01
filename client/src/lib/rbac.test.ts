/**
 * F-GAP-11 — the permission matrix could not save a grant that already existed.
 *
 * `upsertGrant` used to send the object it was handed (`body: g`), and what the
 * matrix hands it is a full database row: `/permissions/matrix` returns
 * `RETURNING *`, so every loaded grant carries `permission_id`. The `Grant`
 * annotation is erased at runtime and strips nothing. The server's validator is
 * `.strict()` — deliberately, because a misspelled `can_aprove` silently written
 * as `false` is a privilege change nobody asked for — so it answered
 * 422 "Unrecognized key(s) in object: 'permission_id'".
 *
 * Net effect: the screen you fix permissions on could not be used to fix
 * permissions. A cell with no row saved once (emptyGrant builds a clean object),
 * then its own `RETURNING *` response was stored in state and the second toggle
 * of that same cell failed.
 *
 * WHY THIS IS A TEST AND NOT A LINE IN check-schemas.mjs. That gate asks
 * whether a schema in `packages/shared` is imported by both halves — an
 * organisational question, answered statically. This is a wire-contract
 * question: what does this one call actually put on the request. Pinning the
 * payload is the check that would have caught the defect, and it fails loudly at
 * the call site rather than in a build script that has to infer the pairing.
 *
 * `permission_id` is not merely unwanted, it is unusable: the repo binds seven
 * parameters and resolves the row by ON CONFLICT (role_id, module_key), the
 * natural key. The id is database-generated and never in the DO UPDATE SET list.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import * as apiClient from "./api-client";
import { upsertGrant, emptyGrant, PERMS, type Grant } from "./rbac";

afterEach(() => vi.restoreAllMocks());

/** The seven fields the server's `.strict()` schema accepts — the wire contract. */
const CONTRACT_KEYS = ["role_id", "module_key", ...PERMS].sort();

/** What `/permissions/matrix` actually returns: the contract plus the row id. */
const rowFromServer = {
  ...emptyGrant(
    "a83d176b-0934-45b8-ba42-f32999079720",
    "MOD-04",
  ),
  can_approve: true,
  permission_id: "d2e70c2c-6cb2-4221-9f32-71aebc6d9d19",
} as Grant;

describe("upsertGrant — the PUT /permissions/grant wire contract", () => {
  it("sends exactly the seven contract fields", async () => {
    const spy = vi
      .spyOn(apiClient, "tenant")
      .mockResolvedValue({} as never);

    await upsertGrant(rowFromServer);

    expect(spy).toHaveBeenCalledTimes(1);
    const [path, init] = spy.mock.calls[0] as [string, { body: object }];
    expect(path).toBe("/permissions/grant");
    expect(Object.keys(init.body).sort()).toEqual(CONTRACT_KEYS);
  });

  /**
   * The regression itself. A row straight off `/permissions/matrix` carries
   * `permission_id`; if it reaches the wire the server rejects the whole write.
   */
  it("does not forward permission_id from a loaded row", async () => {
    const spy = vi
      .spyOn(apiClient, "tenant")
      .mockResolvedValue({} as never);

    await upsertGrant(rowFromServer);

    const [, init] = spy.mock.calls[0] as [string, { body: object }];
    expect(init.body).not.toHaveProperty("permission_id");
  });

  it("carries the toggled flag through unchanged", async () => {
    const spy = vi
      .spyOn(apiClient, "tenant")
      .mockResolvedValue({} as never);

    await upsertGrant(rowFromServer);

    const [, init] = spy.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(init.body.can_approve).toBe(true);
    expect(init.body.role_id).toBe("a83d176b-0934-45b8-ba42-f32999079720");
    expect(init.body.module_key).toBe("MOD-04");
  });
});
