import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());
import { OpportunitiesPage } from "./opportunities";

const stage = (code: string, id: string, i: number) => ({
  pipeline_stage_id: id, code, name: code, sort_order: i,
  is_won: code === "WON", is_lost: code === "LOST", default_probability: 10 * (i + 1),
});
const STAGES = [stage("NEW","s1",0), stage("QUALIFIED","s2",1), stage("WON","s3",2)];
const OPPS = [
  { opportunity_id: "o1", name: "Oslo reefer", pipeline_stage_id: "s1", status: "OPEN", estimated_value: 8000000, currency: "XAF", probability: 10 },
  { opportunity_id: "o2", name: "Tema lane",  pipeline_stage_id: "s2", status: "OPEN", estimated_value: 2000000, currency: "XAF", probability: 30 },
  // The case the board used to swallow: a stage this tenant does not have.
  { opportunity_id: "o3", name: "Ghost deal", pipeline_stage_id: "gone", status: "OPEN", estimated_value: 5000000, currency: "XAF", probability: 50 },
  // And one with no stage at all.
  { opportunity_id: "o4", name: "Stageless deal", pipeline_stage_id: null, status: "OPEN", estimated_value: 1000000, currency: "XAF", probability: 0 },
];
const METRICS = { pipeline_value: 10000000, weighted_value: 1400000, won_value: 0, open_count: 2,
  won_count: 0, lost_count: 0, settled_count: 0, total_count: 2, win_rate_settled: null, win_rate_all_deals: 0 };

/**
 * The pipeline board must account for EVERY deal it is given.
 *
 * Reported live: "the endpoints on that page return data, but nothing is shown
 * on the board". The columns render deals whose `pipeline_stage_id` equals the
 * column's own id — so a deal with no stage, or one pointing at a stage the
 * tenant no longer has, matched nothing and was drawn nowhere. The API returned
 * it and the List view showed it; the board silently held it back.
 *
 * This is the same rule the KPI tiles are held to (they must partition the
 * register — quote_request.rules.assertPartitions): every deal is in a column,
 * or in the column that says it is in no column. Silence is not an option.
 */
describe("Sales · pipeline board", () => {
  it("draws every deal — including the ones no stage claims", async () => {
    renderScreen(<OpportunitiesPage />, {
      routes: {
        "/opportunities/stages": STAGES,
        "/opportunities?limit=200": OPPS,
        "/opportunities": OPPS,
        "/opportunities/metrics?limit=200": METRICS,
        "/opportunities/metrics": METRICS,
        "/leads": [], "/clients": [], "/entities": [],
      },
    });
    await waitFor(() => expect(screen.queryByText(/No pipeline stages/i)).toBeNull(), { timeout: 3000 });
    // eslint-disable-next-line no-console
    const body = document.body.textContent || "";
    // eslint-disable-next-line no-console
    console.log("VISIBLE >>>", ["Oslo reefer","Tema lane","Ghost deal","Stageless deal","No stage"]
      .map((t) => `${t}=${body.includes(t)}`).join("  "));
    expect(body).toContain("Ghost deal");
    expect(body).toContain("Stageless deal");
    expect(body).toContain("No stage");
  });
});
