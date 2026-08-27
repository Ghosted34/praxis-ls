/**
 * Website tab visibility on the service-type dossier.
 *
 * `useWebsiteFeature` probes `GET /public/services` — the only client-visible
 * signal until the auth session surfaces `website`. Hide ONLY on
 * FEATURE_DISABLED; a 429 (or any non-feature failure) must keep the tab visible
 * so a paid package is never hidden on a transient.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import {
  apiClientMock,
  authContextMock,
  apiError,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { ServiceTypeDossier } from "./service-type-dossier";

const ST_ID = "st-website-1";

/** Minimal 360 payload — enough for the dossier shell + tab bar to settle. */
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
    template_versions: 0,
    active_template_version: null,
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

function baseRoutes(publicServices: unknown) {
  return {
    [`/service-types/${ST_ID}/360`]: DOSSIER_360,
    "/public/services": publicServices,
    // Assumptions tab is not opened; still listed so a stray fetch stays quiet.
    [`/service-types/${ST_ID}/assumptions`]: [],
  };
}

function mount(publicServices: unknown) {
  return renderScreen(
    <ServiceTypeDossier
      serviceTypeId={ST_ID}
      onEdit={() => {}}
      onPublishTemplate={() => {}}
      onEditPolicy={() => {}}
    />,
    { routes: baseRoutes(publicServices) },
  );
}

beforeEach(() => {
  fixtures.current = {};
});

describe("ServiceTypeDossier · Website tab feature gate", () => {
  it("hides the Website tab when the public probe returns FEATURE_DISABLED", async () => {
    mount(
      apiError(
        403,
        "Feature 'website' is off for this tenant",
        "FEATURE_DISABLED",
      ),
    );

    // Dossier shell settled (Overview is always present).
    expect(
      await screen.findByRole("button", { name: /^Overview$/i }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^Website$/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the Website tab when the public probe returns 429 (not a feature denial)", async () => {
    mount(apiError(429, "Too many requests", "RATE_LIMITED"));

    expect(
      await screen.findByRole("button", { name: /^Overview$/i }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Website$/i }),
      ).toBeInTheDocument();
    });
  });
});
