"use strict";
const lead = require("../../src/modules/sales/lead/lead.rules");
const opp = require("../../src/modules/sales/opportunity/opportunity.events");
const proposal = require("../../src/modules/sales/proposal/proposal.rules");
const campaign = require("../../src/modules/sales/marketing_campaign/marketing_campaign.rules");

describe("Sales funnel rules (MOD-20–26)", () => {
  test("lead lifecycle", () => {
    expect(lead.assertTransition("NEW", "CONTACTED")).toBe(true);
    expect(lead.assertTransition("CONTACTED", "QUALIFIED")).toBe(true);
    expect(lead.assertTransition("QUALIFIED", "CONVERTED")).toBe(true);
    expect(() => lead.assertTransition("NEW", "CONVERTED")).toThrow();
    expect(() => lead.assertTransition("LOST", "CONTACTED")).toThrow();
  });
  test("proposal lifecycle + total", () => {
    expect(proposal.assertTransition("DRAFT", "IN_REVIEW")).toBe(true);
    expect(proposal.assertTransition("SENT", "ACCEPTED")).toBe(true);
    expect(() => proposal.assertTransition("DRAFT", "SENT")).toThrow();
    expect(proposal.totalHt([{ qty: 2, unit_price: 100 }, { qty: 1, unit_price: 50.5 }])).toBe(250.5);
  });
  test("campaign lifecycle", () => {
    expect(campaign.assertTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(campaign.assertTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(() => campaign.assertTransition("ENDED", "ACTIVE")).toThrow();
  });
  test("opportunity emits stage/won/lost events", () => {
    expect(opp.WON).toBe("opportunity.won");
    expect(opp.STAGE_MOVED).toBe("opportunity.stage_moved");
  });
});
