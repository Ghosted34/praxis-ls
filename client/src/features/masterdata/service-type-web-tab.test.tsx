/**
 * Website tab (PR2) — pins every §7 client row and the §3.1 behaviours the
 * guide names: empty state, one upsert on first save, readiness gates Publish
 * (incl. name_en jump), unpublish keeps content, archived mute notice, slug
 * box previews via the client twin.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { MemoryRouter } from "react-router-dom";

const getServiceTypeWeb = vi.fn();
const upsertServiceTypeWeb = vi.fn();
const publishServiceTypeWeb = vi.fn();
const unpublishServiceTypeWeb = vi.fn();
const listServiceTypes = vi.fn();
const replaceServiceTypeWebFaq = vi.fn();
const replaceServiceTypeWebRelated = vi.fn();
const uploadServiceTypeWebMedia = vi.fn();
const removeServiceTypeWebMedia = vi.fn();

vi.mock("@/lib/operations-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations-api")>(
    "@/lib/operations-api",
  );
  return {
    ...actual,
    getServiceTypeWeb: (...a: unknown[]) => getServiceTypeWeb(...a),
    upsertServiceTypeWeb: (...a: unknown[]) => upsertServiceTypeWeb(...a),
    publishServiceTypeWeb: (...a: unknown[]) => publishServiceTypeWeb(...a),
    unpublishServiceTypeWeb: (...a: unknown[]) => unpublishServiceTypeWeb(...a),
    listServiceTypes: (...a: unknown[]) => listServiceTypes(...a),
    replaceServiceTypeWebFaq: (...a: unknown[]) =>
      replaceServiceTypeWebFaq(...a),
    replaceServiceTypeWebRelated: (...a: unknown[]) =>
      replaceServiceTypeWebRelated(...a),
    uploadServiceTypeWebMedia: (...a: unknown[]) =>
      uploadServiceTypeWebMedia(...a),
    removeServiceTypeWebMedia: (...a: unknown[]) =>
      removeServiceTypeWebMedia(...a),
  };
});

import { ServiceTypeWebTab } from "./service-type-web-tab";
import type { ServiceTypeWebTab as TabPayload } from "@/lib/operations-api";

const ST_ID = "11111111-1111-4111-8111-111111111111";
const ST_KEY = "SEA_FREIGHT_IMPORT";

function incompleteReadiness(
  overrides: Partial<TabPayload["readiness"]> = {},
): TabPayload["readiness"] {
  return {
    name_en_present: false,
    short_fr: false,
    short_en: false,
    long_fr: false,
    long_en: false,
    slug_fr: false,
    slug_en: false,
    cover: { present: false, allowed: false },
    publishable: false,
    missing: [
      "name_en",
      "short_description_fr",
      "short_description_en",
      "long_description_fr",
      "long_description_en",
      "slug_fr",
      "slug_en",
      "cover_image",
    ],
    ...overrides,
  };
}

function emptyTab(overrides: Partial<TabPayload> = {}): TabPayload {
  return {
    profile: null,
    faq: [],
    related: [],
    readiness: incompleteReadiness(),
    service_type: {
      is_active: true,
      name_fr: "Fret Aérien Import",
      name_en: null,
    },
    ...overrides,
  };
}

function draftTab(overrides: Partial<TabPayload> = {}): TabPayload {
  return {
    profile: {
      service_type_id: ST_ID,
      short_description_fr: "Court FR",
      short_description_en: "Short EN",
      long_description_fr: "Long FR body",
      long_description_en: "Long EN body",
      highlights_fr: ["a", "b", "c", "d"],
      highlights_en: ["a", "b", "c", "d"],
      slug_fr: "fret-aerien-import",
      slug_en: "air-freight-import",
      cover_vault_id: null,
      gallery_vault_ids: [],
      is_published: false,
      cover_allowed: false,
    },
    faq: [],
    related: [],
    readiness: incompleteReadiness({
      name_en_present: false,
      short_fr: true,
      short_en: true,
      long_fr: true,
      long_en: true,
      slug_fr: true,
      slug_en: true,
      cover: { present: false, allowed: false },
      publishable: false,
      missing: ["name_en", "cover_image"],
    }),
    service_type: {
      is_active: true,
      name_fr: "Fret Aérien Import",
      name_en: null,
    },
    ...overrides,
  };
}

function publishableTab(overrides: Partial<TabPayload> = {}): TabPayload {
  const base = draftTab();
  return {
    ...base,
    profile: {
      ...base.profile!,
      cover_vault_id: "22222222-2222-4222-8222-222222222222",
      cover_allowed: true,
      is_published: false,
    },
    readiness: {
      name_en_present: true,
      short_fr: true,
      short_en: true,
      long_fr: true,
      long_en: true,
      slug_fr: true,
      slug_en: true,
      cover: { present: true, allowed: true },
      publishable: true,
      missing: [],
    },
    service_type: {
      is_active: true,
      name_fr: "Fret Aérien Import",
      name_en: "Air freight import",
    },
    ...overrides,
  };
}

function view(ui: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0, staleTime: 0 },
          },
        })
      }
    >
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getServiceTypeWeb.mockReset();
  upsertServiceTypeWeb.mockReset();
  publishServiceTypeWeb.mockReset();
  unpublishServiceTypeWeb.mockReset();
  listServiceTypes.mockReset();
  replaceServiceTypeWebFaq.mockReset();
  replaceServiceTypeWebRelated.mockReset();
  uploadServiceTypeWebMedia.mockReset();
  removeServiceTypeWebMedia.mockReset();
  listServiceTypes.mockResolvedValue([]);
});

describe("ServiceTypeWebTab", () => {
  it("renders the no-profile empty state", async () => {
    getServiceTypeWeb.mockResolvedValue(emptyTab());
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    expect(await screen.findByTestId("web-empty-state")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create web page/i }),
    ).toBeTruthy();
  });

  it("first save on the empty state calls the one upsert", async () => {
    const user = userEvent.setup();
    getServiceTypeWeb.mockResolvedValue(emptyTab());
    const created = draftTab();
    upsertServiceTypeWeb.mockResolvedValue(created);

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-empty-state");
    await user.click(screen.getByTestId("web-create-page"));

    await waitFor(() => expect(upsertServiceTypeWeb).toHaveBeenCalledTimes(1));
    const [id, body] = upsertServiceTypeWeb.mock.calls[0];
    expect(id).toBe(ST_ID);
    // Seeded with accent-safe suggestions from the FR name / key.
    expect(body.slug_fr).toBe("fret-aerien-import");
    expect(publishServiceTypeWeb).not.toHaveBeenCalled();
  });

  it("readiness checklist gates Publish and exposes the name_en jump action", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    getServiceTypeWeb.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={onEdit}
      />,
    );
    const checklist = await screen.findByTestId("web-readiness-checklist");
    expect(
      within(checklist).getByText(/English name — set on the service type/i),
    ).toBeTruthy();
    // Publish disabled until readiness.publishable.
    const publish = screen.getByTestId("web-publish");
    expect(publish).toBeDisabled();

    await user.click(
      within(checklist).getByRole("button", { name: /Edit service type/i }),
    );
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("Publish is enabled only when readiness.publishable is true", async () => {
    getServiceTypeWeb.mockResolvedValue(publishableTab());
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");
    expect(screen.getByTestId("web-publish")).not.toBeDisabled();
  });

  it("unpublish keeps content — calls unpublish and re-renders the profile", async () => {
    const user = userEvent.setup();
    const published = publishableTab({
      profile: {
        ...publishableTab().profile!,
        is_published: true,
      },
    });
    const after: TabPayload = {
      ...published,
      profile: { ...published.profile!, is_published: false },
    };
    getServiceTypeWeb.mockResolvedValue(published);
    unpublishServiceTypeWeb.mockResolvedValue(after);

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-unpublish");
    // Content still visible while published.
    expect(screen.getByDisplayValue("Court FR")).toBeTruthy();
    await user.click(screen.getByTestId("web-unpublish"));
    await waitFor(() =>
      expect(unpublishServiceTypeWeb).toHaveBeenCalledWith(ST_ID),
    );
    // Content kept after unpublish (same short description still in the form).
    expect(await screen.findByDisplayValue("Court FR")).toBeTruthy();
  });

  it("archived service type shows the mute notice and is read-only", async () => {
    getServiceTypeWeb.mockResolvedValue(
      draftTab({
        service_type: {
          is_active: false,
          name_fr: "Fret Aérien Import",
          name_en: null,
        },
      }),
    );
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    expect(
      await screen.findByText(/Archived services are never public/i),
    ).toBeTruthy();
    // No publish / save affordances while archived.
    expect(screen.queryByTestId("web-publish")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save$/i })).toBeNull();
  });

  it("slug box previews via the client twin", async () => {
    getServiceTypeWeb.mockResolvedValue(draftTab());
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");
    // Default language is FR — preview shows the accent-safe slug.
    const preview = screen.getByTestId("web-slug-preview");
    expect(preview.textContent).toMatch(/fret-aerien-import/);
    expect(screen.getByTestId("web-slug-fr")).toHaveValue("fret-aerien-import");
  });

  it("does not disable FAQ / copy while published — only slug & media lock", async () => {
    getServiceTypeWeb.mockResolvedValue(
      publishableTab({
        profile: {
          ...publishableTab().profile!,
          is_published: true,
        },
      }),
    );
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");
    // Short description stays editable.
    const short = screen.getByDisplayValue("Court FR");
    expect(short).not.toBeDisabled();
    // Slug is locked while published.
    expect(screen.getByTestId("web-slug-fr")).toBeDisabled();
    // Lock message family from the guide.
    expect(
      screen.getAllByText(/Unpublish before changing slugs or media/i).length,
    ).toBeGreaterThan(0);
  });

  it("clearing a draft slug box sends null (server col = EXCLUDED.col clears)", async () => {
    const user = userEvent.setup();
    getServiceTypeWeb.mockResolvedValue(draftTab());
    upsertServiceTypeWeb.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");

    const slugFr = screen.getByTestId("web-slug-fr");
    expect(slugFr).toHaveValue("fret-aerien-import");
    await user.clear(slugFr);

    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(upsertServiceTypeWeb).toHaveBeenCalled());
    const [, body] = upsertServiceTypeWeb.mock.calls.at(-1)!;
    // Explicit null — not omitted, not "" — so the server clears the column.
    expect(body).toMatchObject({ slug_fr: null });
    expect(body.slug_fr).toBeNull();
  });
});
