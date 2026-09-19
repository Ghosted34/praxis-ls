/**
 * Service-type 360 — the active tab lives in `?tab=`, not in component state.
 *
 * The bug this pins: the dossier held its tab in `React.useState`, so a reload
 * dumped the reader back on Overview. `useUrlTab` is the house pattern
 * (entity-360 & co): the URL is the state, "Overview" is the fallback so the
 * param is omitted there, and a remount at the same URL — which is what a
 * browser reload IS — lands on the same tab.
 *
 * This dossier has one wrinkle the other two don't: a reset-to-Overview effect
 * when `serviceTypeId` changes (so a switch from a service with milestones to
 * one without does not land on an empty tab). That effect used to run on FIRST
 * render too, which was harmless against local state and would silently wipe
 * `?tab=` now — so the arrival case is pinned here explicitly.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { ServiceTypeDossier } from "./service-type-dossier";

const ST_ID = "st-url-tab-1";

const DOSSIER_360 = {
  service_type: {
    service_type_id: ST_ID,
    key: "SEA_FREIGHT_IMPORT",
    name_fr: "Fret maritime",
    name_en: "Sea freight",
    is_active: true,
    is_system: false,
  },
  stats: {
    dossiers_total: 0,
    dossiers_open: 0,
    dossiers_in_progress: 0,
    dossiers_completed: 0,
    dossiers_cancelled: 0,
    template_versions: 1,
    active_template_version: 1,
    dictionary_items: 0,
    margin_simulations: 0,
  },
  readiness: {
    has_active_template: true,
    active_template_version: 1,
    has_dictionary_line: true,
    has_active_field_set: true,
    active_field_set_version: 1,
    ever_used: false,
    ever_billed: null,
  },
  templates: [],
  dictionary_items: [],
  dictionary_items_generic: [],
  dossiers: [],
  dossiers_more: 0,
  margin_simulations: [],
  margin_simulations_more: 0,
  invoices: [],
  money: { planned: [], billed: [], actual_total: 0, masked: true },
  containers: {
    captures_containers: false,
    container_detail_mode: "GROUPED" as const,
  },
};

const ROUTES = {
  [`/service-types/${ST_ID}/360`]: DOSSIER_360,
  "/public/services": [],
  [`/service-types/${ST_ID}/assumptions`]: [],
};

/** The URL as the router sees it, captured on every navigation. */
let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

const mount = (path = "/") =>
  renderScreen(
    <>
      <ServiceTypeDossier
        serviceTypeId={ST_ID}
        onEdit={() => {}}
        onPublishTemplate={() => {}}
        onEditPolicy={() => {}}
      />
      <LocationProbe />
    </>,
    { routes: ROUTES, path },
  );

describe("ServiceTypeDossier · tab state is URL state", () => {
  it("switching tab writes ?tab=, and a remount at that URL restores the tab", async () => {
    const user = userEvent.setup();
    const first = mount();

    // Starts on Overview with no param — the fallback keeps the URL clean.
    expect(
      await screen.findByRole("button", { name: /^Overview$/ }),
    ).toBeInTheDocument();
    expect(lastSearch).toBe("");

    await user.click(screen.getByRole("button", { name: /^Automation$/ }));
    expect(await screen.findByText("Auto-instantiation")).toBeInTheDocument();
    expect(lastSearch).toBe("?tab=Automation");

    // The remount is the reload: a fresh tree at the URL the click produced
    // must land on Automation, not Overview.
    first.unmount();
    mount("/?tab=Automation");
    expect(await screen.findByText("Auto-instantiation")).toBeInTheDocument();
  });

  it("the reset-on-id-change effect does not wipe the param a deep link arrived with", async () => {
    // Mounting fresh IS the id "changing" from nothing — the effect must skip
    // that first render or every reload lands back on Overview.
    mount("/?tab=Automation");
    expect(await screen.findByText("Auto-instantiation")).toBeInTheDocument();
    expect(lastSearch).toBe("?tab=Automation");
  });

  it("an unknown ?tab= value falls back to Overview instead of rendering nothing", async () => {
    mount("/?tab=Renamed%20Since");
    // Overview's own content: the service-type key line rendered by OverviewTab.
    expect(
      await screen.findByText("SEA_FREIGHT_IMPORT"),
    ).toBeInTheDocument();
  });
});
