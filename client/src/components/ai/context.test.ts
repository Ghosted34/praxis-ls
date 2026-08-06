/**
 * The two pure decisions behind "the assistant knows where it was opened from":
 * which scope a route falls in, and which starters that screen deserves.
 *
 * The hooks around them (`useAiScopes`, `useScreenContext`) are thin readers
 * over `useShell` and the screen registry and are covered by the shell's own
 * suite; these are the parts that would go wrong silently. A screen whose area
 * quietly stops matching does not throw — it just serves the generic starters
 * forever, which is precisely the behaviour this design set out to remove.
 */
import { describe, it, expect } from "vitest";
import { DESK_STARTERS, scopeByKey, scopeForPath, suggestionsFor, type AiScope } from "./context";
import { groupConversations } from "./thread";
import type { AiConversationMeta } from "@/lib/ai-api";

const Blank = () => null as unknown as React.JSX.Element;
const scope = (key: string, basePath: string): AiScope => ({ key, label: key, Icon: Blank, basePath });

const SCOPES: AiScope[] = [
  scope("all", ""),
  scope("finance", "/finance"),
  scope("operations", "/operations"),
  scope("tower", ""),
];

describe("scopeForPath", () => {
  it("opens pre-scoped to the area you are standing in", () => {
    expect(scopeForPath(SCOPES, "/finance/receivables").key).toBe("finance");
  });

  it("matches the area's own landing page, not just its sections", () => {
    expect(scopeForPath(SCOPES, "/finance").key).toBe("finance");
  });

  it("falls back to `all` off-area rather than guessing", () => {
    expect(scopeForPath(SCOPES, "/hr/payroll").key).toBe("all");
  });

  it("does not match a route that merely starts with the same characters", () => {
    // `/financements` is not inside `/finance`, and a prefix test without the
    // separator would say it was.
    expect(scopeForPath(SCOPES, "/financements").key).toBe("all");
  });

  it("ignores scopes with no base path, so `all` cannot swallow everything", () => {
    expect(scopeForPath(SCOPES, "/operations/files").key).toBe("operations");
  });
});

describe("scopeByKey", () => {
  it("resolves a stored key", () => {
    expect(scopeByKey(SCOPES, "operations").key).toBe("operations");
  });

  it("falls back to the first scope when a stored key no longer exists", () => {
    // A user whose Finance grant was revoked has a stored scope pointing at a
    // scope they can no longer see. That must degrade to `all`, not to nothing.
    expect(scopeByKey(SCOPES, "vault").key).toBe("all");
    expect(scopeByKey(SCOPES, null).key).toBe("all");
  });
});

describe("suggestionsFor", () => {
  it("offers the questions that desk actually asks", () => {
    const s = suggestionsFor({ route: "/finance/receivables", label: "Receivables", actions: [], area: "finance" });
    expect(s).toHaveLength(3);
    expect(s[0].prompt).toMatch(/overdue/i);
  });

  it("templates on the screen when its area has no curated set", () => {
    const s = suggestionsFor({ route: "/hr/appraisals", label: "Appraisals", actions: [], area: "appraisals" });
    expect(s.map((x) => x.label)).toContain("Summarise Appraisals");
  });

  it("falls back to desk-level questions off-registry", () => {
    // A drawer opened from an unregistered detail route must still offer
    // something, and the cross-module questions are never wrong.
    expect(suggestionsFor(null)).toEqual(DESK_STARTERS.slice(0, 3));
  });

  it("never offers more than fits the drawer's empty state", () => {
    for (const area of ["finance", "operations", "procurement", "sales", "vault", "comms"]) {
      expect(suggestionsFor({ route: "/x", label: "X", actions: [], area }).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("groupConversations", () => {
  const at = (daysAgo: number, id: string): AiConversationMeta => ({
    conversation_id: id,
    title: id,
    last_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    message_count: 2,
  });

  it("buckets by how a person remembers, not by date", () => {
    const groups = groupConversations([at(0.2, "a"), at(1.2, "b"), at(4, "c"), at(20, "d"), at(200, "e")]);
    expect(groups.map((g) => g.heading)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Previous 30 days",
      "Older",
    ]);
  });

  it("drops empty buckets so the rail never shows a heading with nothing under it", () => {
    const groups = groupConversations([at(0.1, "a"), at(200, "e")]);
    expect(groups.map((g) => g.heading)).toEqual(["Today", "Older"]);
  });

  it("orders within a bucket newest first", () => {
    const groups = groupConversations([at(0.6, "older"), at(0.1, "newer")]);
    expect(groups[0].items.map((c) => c.conversation_id)).toEqual(["newer", "older"]);
  });

  it("returns nothing for a user with no threads", () => {
    expect(groupConversations([])).toEqual([]);
  });
});
