/**
 * Control Tower components — render, keyboard reachability and axe.
 *
 * The audit's Phase 3 validation asks for "an axe scan of the dashboard —
 * previously impossible through the iframe boundary". This is that scan: axe
 * cannot cross into an `<iframe srcDoc>`, so for as long as the home screen was
 * a frame, the app's most-visited surface was the one surface no automated
 * accessibility check could see.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { axe } from "jest-axe";

import { AppLauncher, LAUNCHER } from "./components/app-launcher";
import { Briefing } from "./components/briefing";
import { KpiStrip, kpiCards } from "./components/kpi-strip";
import { LiveShipments } from "./components/live-shipments";
import { TowerHero } from "./components/tower-hero";
import { ShipmentMap } from "./map/shipment-map";
import type { Lane, LiveShipment } from "./model";
import type { ControlTowerKpis } from "./use-control-tower";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const KPIS: ControlTowerKpis = {
  revenue: 84_600_000,
  currency: "XAF",
  sla: 96,
  overdue: 18_200_000,
  fleetActive: 14,
  fleetTotal: 18,
};

const SHIPMENTS: LiveShipment[] = [
  {
    ref: "SBX-OPS-2026-0142",
    mode: "sea",
    from: "Shanghai",
    to: "Douala",
    status: "In progress",
    tone: "blue",
    stage: "Costing approval",
    eta: "04 Jul 2026",
    progress: 55,
  },
  {
    ref: "SBX-OPS-2026-0137",
    mode: "road",
    from: "Douala",
    to: "Garoua",
    status: "In transit",
    tone: "blue",
    stage: "On road",
    eta: "05 Jul 2026",
    progress: null,
  },
];

const LANES: Lane[] = [
  {
    ref: "SBX-OPS-2026-0142",
    mode: "sea",
    status: "In progress",
    from: { name: "Shanghai", lat: 31.2, lng: 121.5 },
    to: { name: "Douala", lat: 4.05, lng: 9.7 },
  },
];

describe("TowerHero", () => {
  it("renders the page's single h1", () => {
    wrap(<TowerHero firstName="Amara" activeFiles={7} approvals={2} isTest={false} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("greets the signed-in user, not the mock's hardcoded name", () => {
    wrap(<TowerHero firstName="Grace" activeFiles={1} approvals={0} isTest={false} />);
    expect(screen.getByText(/Grace/)).toBeInTheDocument();
  });

  it("says 'test' in the headline when the data environment is the sandbox", () => {
    // The mock hardcoded "Your network, live." — a lie in TEST mode, where every
    // figure on the page comes from the sandbox schema.
    wrap(<TowerHero firstName="Amara" activeFiles={3} approvals={0} isTest />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your network, test.");
  });

  it("pluralises and mentions approvals only when there are some", () => {
    const { unmount } = wrap(<TowerHero firstName="A" activeFiles={1} approvals={0} isTest={false} />);
    expect(screen.getByText("1 operation file in motion.")).toBeInTheDocument();
    unmount();
    wrap(<TowerHero firstName="A" activeFiles={7} approvals={2} isTest={false} />);
    expect(screen.getByText("7 operation files in motion — 2 awaiting your approval.")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(<TowerHero firstName="Amara" activeFiles={7} approvals={2} isTest={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("KpiStrip", () => {
  it("renders every available metric as a real button", () => {
    wrap(<KpiStrip kpis={KPIS} onOpen={vi.fn()} />);
    // In the iframe these were <div onclick> outside the parent's focus order,
    // so the drill-downs were unreachable by keyboard from the app at all.
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("hides a card whose metric is null rather than showing a false zero", () => {
    wrap(<KpiStrip kpis={{ ...KPIS, fleetTotal: null, fleetActive: null }} onOpen={vi.fn()} />);
    expect(screen.queryByText("Fleet utilisation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("hides the fleet card for a tenant with an empty register", () => {
    expect(kpiCards({ ...KPIS, fleetTotal: 0 }).some((c) => c.id === "fleet")).toBe(false);
  });

  it("renders nothing at all when no metric is readable", () => {
    const { container } = wrap(
      <KpiStrip
        kpis={{ revenue: null, currency: "XAF", sla: null, overdue: null, fleetActive: null, fleetTotal: null }}
        onOpen={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("labels revenue by what the query actually measures", () => {
    // The mock badged this card "MTD" and the injection script never rewrote the
    // badge, so an all-time SUM shipped labelled month-to-date.
    const revenue = kpiCards(KPIS).find((c) => c.id === "revenue")!;
    expect(revenue.badge).toBe("Locked");
    expect(revenue.hint).toBe("Locked final invoices, all periods");
  });

  it("opens the drill-down for the card that was activated", async () => {
    const onOpen = vi.fn();
    wrap(<KpiStrip kpis={KPIS} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /Receivables · past due/ }));
    expect(onOpen).toHaveBeenCalledWith("overdue");
  });

  it("is operable from the keyboard", async () => {
    const onOpen = vi.fn();
    wrap(<KpiStrip kpis={KPIS} onOpen={onOpen} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("revenue");
  });

  it("has no axe violations", async () => {
    const { container } = wrap(<KpiStrip kpis={KPIS} onOpen={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("LiveShipments", () => {
  it("makes each row a link into the dossier's operations file", () => {
    wrap(<LiveShipments shipments={SHIPMENTS} />);
    const link = screen.getByRole("link", { name: /SBX-OPS-2026-0142/ });
    expect(link).toHaveAttribute("href", "/operations/files?ref=SBX-OPS-2026-0142");
  });

  it("draws a progress bar only for dossiers that have milestones", () => {
    wrap(<LiveShipments shipments={SHIPMENTS} />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "55");
  });

  it("shows the milestone and ETA, not a raw vessel string", () => {
    wrap(<LiveShipments shipments={SHIPMENTS} />);
    expect(screen.getByText("Costing approval · 04 Jul 2026")).toBeInTheDocument();
  });

  it("offers a real empty state with a next step", () => {
    wrap(<LiveShipments shipments={[]} />);
    expect(screen.getByText("No live shipments")).toBeInTheDocument();
    expect(screen.getByText(/Create an operation file/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(<LiveShipments shipments={SHIPMENTS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Briefing", () => {
  it("lists only what needs doing", () => {
    wrap(<Briefing activeFiles={7} approvals={0} complianceFlags={2} unpostedJournals={0} isTest={false} />);
    expect(screen.getByRole("link", { name: /7 active operation files/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2 open compliance flags/ })).toBeInTheDocument();
    expect(screen.queryByText(/awaiting approval/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unposted journal/)).not.toBeInTheDocument();
  });

  it("routes every fact to the screen that resolves it", () => {
    wrap(<Briefing activeFiles={1} approvals={1} complianceFlags={1} unpostedJournals={1} isTest={false} />);
    expect(screen.getByRole("link", { name: /awaiting approval/ })).toHaveAttribute("href", "/approvals");
    expect(screen.getByRole("link", { name: /compliance flag/ })).toHaveAttribute("href", "/vault/compliance-flags");
    expect(screen.getByRole("link", { name: /unposted journal/ })).toHaveAttribute("href", "/finance/journals");
  });

  it("says so plainly when nothing is outstanding", () => {
    wrap(<Briefing activeFiles={0} approvals={0} complianceFlags={0} unpostedJournals={0} isTest={false} />);
    expect(screen.getByText(/Nothing is waiting on you/)).toBeInTheDocument();
  });

  it("names the data environment", () => {
    wrap(<Briefing activeFiles={1} approvals={0} complianceFlags={0} unpostedJournals={0} isTest />);
    expect(screen.getByText(/Sandbox data/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(
      <Briefing activeFiles={7} approvals={2} complianceFlags={1} unpostedJournals={3} isTest={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("AppLauncher", () => {
  it("sends every tile to its OWN destination", () => {
    // The mock hardcoded onclick="go('ops')" on all twelve, so every tile opened
    // its sample Operations view whichever one you clicked.
    wrap(<AppLauncher onBrowseAll={vi.fn()} />);
    const list = screen.getByRole("list");
    const hrefs = within(list)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(LAUNCHER.length);
    expect(new Set(hrefs).size).toBe(LAUNCHER.length);
  });

  it("opens the command palette through context, not a synthetic keyboard event", async () => {
    const onBrowseAll = vi.fn();
    wrap(<AppLauncher onBrowseAll={onBrowseAll} />);
    await userEvent.click(screen.getByRole("button", { name: /Browse everything/ }));
    expect(onBrowseAll).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(<AppLauncher onBrowseAll={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ShipmentMap", () => {
  it("describes its contents for assistive tech", () => {
    wrap(<ShipmentMap lanes={LANES} />);
    expect(screen.getByRole("img", { name: /1 sea, 0 road and 0 air routes/ })).toBeInTheDocument();
  });

  it("explains itself rather than drawing an empty ocean", () => {
    wrap(<ShipmentMap lanes={[]} />);
    expect(screen.getByText(/need a port of loading and discharge/)).toBeInTheDocument();
    expect(screen.getByText("No routes to plot")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(<ShipmentMap lanes={LANES} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
