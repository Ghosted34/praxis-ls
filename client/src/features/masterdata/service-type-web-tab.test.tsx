/**
 * Website tab (PR2) — pins every §7 client row and the §3.1 behaviours the
 * guide names: empty state, one upsert on first save, readiness gates Publish
 * (incl. name_en jump), unpublish keeps content, archived mute notice, slug
 * box previews via the client twin.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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
const listServiceTypeWebGroups = vi.fn();
const createServiceTypeWebGroup = vi.fn();
const updateServiceTypeWebGroup = vi.fn();
const deleteServiceTypeWebGroup = vi.fn();

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
    listServiceTypeWebGroups: (...a: unknown[]) => listServiceTypeWebGroups(...a),
    createServiceTypeWebGroup: (...a: unknown[]) => createServiceTypeWebGroup(...a),
    updateServiceTypeWebGroup: (...a: unknown[]) => updateServiceTypeWebGroup(...a),
    deleteServiceTypeWebGroup: (...a: unknown[]) => deleteServiceTypeWebGroup(...a),
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
  listServiceTypeWebGroups.mockReset();
  createServiceTypeWebGroup.mockReset();
  updateServiceTypeWebGroup.mockReset();
  deleteServiceTypeWebGroup.mockReset();
  listServiceTypes.mockResolvedValue([]);
  listServiceTypeWebGroups.mockResolvedValue(PILLARS);
});

const FREIGHT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGISTICS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RETIRED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PILLARS = [
  {
    group_id: FREIGHT, key: "freight", name_fr: "Fret international",
    name_en: "International freight", icon: "ship", sort_order: 10,
    is_active: true, service_count: 8,
  },
  {
    group_id: LOGISTICS, key: "logistics", name_fr: "Transport et logistique",
    name_en: "Transport and logistics", icon: "truck", sort_order: 20,
    is_active: true, service_count: 5,
  },
  {
    group_id: RETIRED, key: "retired", name_fr: "Retiré",
    name_en: null, icon: null, sort_order: 30,
    is_active: false, service_count: 0,
  },
];

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

  /* ── Cover upload ─────────────────────────────────────────────────────── */
  //
  // A real WebP off a Windows machine frequently arrives with `file.type === ""`
  // — the browser reads the media type from the OS registry and `.webp` is the
  // extension still missing from it. The picker's own guard used to read that as
  // "not one of PNG/JPEG/WebP" and refuse the file with a message telling the
  // person to choose a WebP, which is the least actionable refusal possible. The
  // vault sniffs the magic bytes and is the authority; this guard exists to save
  // a round trip, not to second-guess it.
  //
  // Driven with fireEvent rather than `user.upload`, and the reason is the same
  // fact the fix is about: user-event filters the file against the input's
  // `accept` list and an empty type matches nothing, so it would refuse to
  // deliver the very file under test. A browser does not behave that way —
  // `accept` steers the file dialog and does not apply to a DRAGGED file at all,
  // which is how most covers get here.

  const COVER_LABEL = "Cover image · required to publish";

  /** A WebP's opening bytes: "RIFF", a four-byte length, then "WEBP". Written as
   *  a string because that is what `BlobPart` accepts without a cast, and the
   *  client never looks at the bytes anyway — the vault's sniffer does, and it
   *  reads exactly these twelve. */
  const WEBP_HEADER = "RIFF\u0000\u0000\u0000\u0000WEBPVP8 ";

  it("uploads a WebP whose media type the browser could not name", async () => {
    getServiceTypeWeb.mockResolvedValue(draftTab());
    uploadServiceTypeWebMedia.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");

    const file = new File([WEBP_HEADER], "cover.webp", { type: "" });
    fireEvent.change(screen.getByLabelText(COVER_LABEL), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(uploadServiceTypeWebMedia).toHaveBeenCalledTimes(1),
    );
    const [id, body] = uploadServiceTypeWebMedia.mock.calls[0];
    expect(id).toBe(ST_ID);
    expect(body.role).toBe("COVER");
    expect(body.original_name).toBe("cover.webp");
    expect(screen.queryByText(/Choose a PNG, JPEG or WebP image/i)).toBeNull();
  });

  it("uploads a WebP the browser did name", async () => {
    getServiceTypeWeb.mockResolvedValue(draftTab());
    uploadServiceTypeWebMedia.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");

    const file = new File([WEBP_HEADER], "cover.webp", { type: "image/webp" });
    fireEvent.change(screen.getByLabelText(COVER_LABEL), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(uploadServiceTypeWebMedia).toHaveBeenCalledTimes(1),
    );
  });

  it("shows the chosen picture in the box instead of a truncated UUID", async () => {
    // The report: "I don't know if it uploaded, there is no preview of the
    // image inline." Every dropzone here was handed `file={null}`, so
    // <FileDrop>'s thumbnail, filename and upload state were dead code and the
    // only feedback was the first eight characters of a document id.
    getServiceTypeWeb.mockResolvedValue(draftTab());
    uploadServiceTypeWebMedia.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");

    const file = new File([WEBP_HEADER], "services-hero.webp", {
      type: "image/webp",
    });
    fireEvent.change(screen.getByLabelText(COVER_LABEL), {
      target: { files: [file] },
    });

    // The name is in the box straight away — before the round trip resolves.
    expect(await screen.findByText("services-hero.webp")).toBeTruthy();
    // And the box offers a preview of it rather than nothing.
    expect(
      await screen.findByRole("button", { name: /Expand preview/i }),
    ).toBeTruthy();

    await waitFor(() =>
      expect(uploadServiceTypeWebMedia).toHaveBeenCalledTimes(1),
    );
    // It stays put afterwards, so the answer to "did it upload?" is the
    // picture, and it is confirmed rather than replaced by an id.
    expect(screen.getByText("services-hero.webp")).toBeTruthy();
    expect(await screen.findByText(/Upload successful/i)).toBeTruthy();
  });

  it("still refuses a file the browser DID name, and named as something else", async () => {
    // The guard is relaxed for "" only. An outright mismatch is still worth a
    // sentence here rather than a round trip and a 422.
    getServiceTypeWeb.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await screen.findByTestId("web-profile-editor");

    const file = new File(["%PDF-1.7"], "notes.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(COVER_LABEL), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(/Choose a PNG, JPEG or WebP image/i),
    ).toBeTruthy();
    expect(uploadServiceTypeWebMedia).not.toHaveBeenCalled();
  });

});

describe("ServiceTypeWebTab · the card (12755)", () => {
  // These four columns — group_id, claim_fr, claim_en, accent — shipped with
  // migration 12755, are accepted by the PUT, and are written by seed 9084. The
  // tab rendered no control for any of them and `applyTab` did not seed them
  // into the draft, so `dirtyPatch` could not have sent one even if a control
  // had existed. A tenant could be shown a pillar and a closing line on their own
  // public site with no way in the product to change either.

  it("round-trips the closing line, the pillar and the accent through the one upsert", async () => {
    const user = userEvent.setup();
    getServiceTypeWeb.mockResolvedValue(
      draftTab({
        profile: {
          ...draftTab().profile!,
          claim_fr: "Une étude de transport avant le premier levage.",
          claim_en: "A transport study before the first lift.",
          group_id: FREIGHT,
          accent: "SUCCESS",
        },
      }),
    );
    upsertServiceTypeWeb.mockImplementation(async () => draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );

    // Seeded from the GET, not blank — the bug was that these never reached the draft.
    const claim = (await screen.findByTestId("web-claim-fr")) as HTMLInputElement;
    expect(claim.value).toBe("Une étude de transport avant le premier levage.");
    const pillar = screen.getByTestId("web-pillar") as HTMLSelectElement;
    expect(pillar.value).toBe(FREIGHT);
    expect(
      within(screen.getByTestId("web-accent-picker"))
        .getByRole("radio", { name: /Success/i })
        .getAttribute("aria-checked"),
    ).toBe("true");

    // Change all three, then save once.
    await user.clear(claim);
    await user.type(claim, "Étudié avant d'être déplacé.");
    await user.selectOptions(pillar, LOGISTICS);
    await user.click(
      within(screen.getByTestId("web-accent-picker")).getByRole("radio", {
        name: /Brand/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(upsertServiceTypeWeb).toHaveBeenCalledTimes(1));
    const [, body] = upsertServiceTypeWeb.mock.calls[0];
    expect(body).toMatchObject({
      claim_fr: "Étudié avant d'être déplacé.",
      group_id: LOGISTICS,
      accent: "PRIMARY",
    });
    // Only what changed: the EN claim was not touched, so it is not in the patch.
    expect(body).not.toHaveProperty("claim_en");
  });

  it("clearing the closing line sends null, not an empty string", async () => {
    const user = userEvent.setup();
    getServiceTypeWeb.mockResolvedValue(
      draftTab({
        profile: { ...draftTab().profile!, claim_fr: "Une phrase." },
      }),
    );
    upsertServiceTypeWeb.mockResolvedValue(draftTab());

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await user.clear(await screen.findByTestId("web-claim-fr"));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(upsertServiceTypeWeb).toHaveBeenCalledTimes(1));
    expect(upsertServiceTypeWeb.mock.calls[0][1].claim_fr).toBeNull();
  });

  it("offers only active pillars, plus the unnamed group as a real choice", async () => {
    getServiceTypeWeb.mockResolvedValue(draftTab());
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    const pillar = (await screen.findByTestId("web-pillar")) as HTMLSelectElement;
    const values = Array.from(pillar.options).map((o) => o.value);
    // Empty is the unnamed group at the foot of the page, which still renders —
    // not a placeholder.
    expect(values).toContain("");
    expect(values).toContain(FREIGHT);
    expect(values).toContain(LOGISTICS);
    // A hidden pillar is not offerable: assigning to it would drop the card into
    // the unnamed group with nothing on this screen explaining why.
    expect(values).not.toContain(RETIRED);
  });

  it("keeps a hidden pillar selectable when the service is already under it", async () => {
    // The select would otherwise match no option and render its first one — the
    // unnamed group — stating that a service under a hidden pillar belongs to no
    // pillar. Nothing is lost on save, but the screen would be lying, and the fix
    // (un-hide the pillar) is one nobody reaches if they cannot see it is in use.
    getServiceTypeWeb.mockResolvedValue(
      draftTab({
        profile: { ...draftTab().profile!, group_id: RETIRED },
      }),
    );
    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    const pillar = (await screen.findByTestId("web-pillar")) as HTMLSelectElement;
    expect(pillar.value).toBe(RETIRED);
    const option = Array.from(pillar.options).find((o) => o.value === RETIRED);
    expect(option?.textContent).toMatch(/hidden/i);
  });

  it("the card stays editable while published — only slugs and media lock", async () => {
    getServiceTypeWeb.mockResolvedValue(
      publishableTab({
        profile: {
          ...publishableTab().profile!,
          is_published: true,
          claim_fr: "Une phrase.",
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
      ((await screen.findByTestId("web-claim-fr")) as HTMLInputElement).disabled,
    ).toBe(false);
    expect((screen.getByTestId("web-pillar") as HTMLSelectElement).disabled).toBe(false);
    // …while the slug box beside it is locked, which is the rule being pinned.
    expect((screen.getByTestId("web-slug-fr") as HTMLInputElement).disabled).toBe(true);
  });

  it("manages pillars from the field that uses them, and re-reads after a write", async () => {
    const user = userEvent.setup();
    getServiceTypeWeb.mockResolvedValue(draftTab());
    createServiceTypeWebGroup.mockResolvedValue({
      group_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      key: "value-added", name_fr: "Douane", name_en: null,
      icon: null, sort_order: 100, is_active: true,
    });

    view(
      <ServiceTypeWebTab
        serviceTypeId={ST_ID}
        serviceTypeKey={ST_KEY}
        onEditServiceType={() => {}}
      />,
    );
    await user.click(await screen.findByTestId("web-manage-pillars"));
    const manager = await screen.findByTestId("pillar-manager");
    // The existing pillars are listed, INCLUDING the hidden one — the manager is
    // the one place that has to be able to see and reactivate it.
    expect(within(manager).getByText(/Fret international/)).toBeTruthy();
    expect(within(manager).getByText(/Retiré/)).toBeTruthy();

    await user.click(within(manager).getByTestId("pillar-add"));
    await user.type(screen.getByLabelText(/Name \(FR\)/i), "Douane");
    await user.type(screen.getByLabelText(/^Anchor$/i), "value-added");
    await user.click(screen.getByTestId("pillar-save"));

    await waitFor(() => expect(createServiceTypeWebGroup).toHaveBeenCalledTimes(1));
    expect(createServiceTypeWebGroup.mock.calls[0][0]).toMatchObject({
      key: "value-added", name_fr: "Douane", is_active: true,
    });
    // The list is re-read so the new pillar is selectable without a page reload.
    await waitFor(() => expect(listServiceTypeWebGroups.mock.calls.length).toBeGreaterThan(1));
  });

  /**
   * Unsaved copy is the tenant's work, and every write on this tab used to
   * throw it away.
   *
   * `run()` fed EVERY mutation response back through `applyTab`, which re-seeded
   * the description boxes from the server. Publish, Save FAQ, Save related,
   * Remove media and a gallery reorder change no text column, so each of them
   * silently replaced whatever was typed with the stored copy. The reported
   * loss was eleven thousand characters of page copy, pasted in and then
   * Published — which handed back the seeded placeholder with no error.
   *
   * These pin the behaviour per write, because one shared fix is easy to undo
   * one call site at a time.
   */
  describe("unsaved copy survives writes that do not touch it", () => {
    const LONG = "A".repeat(400) + " freshly written body";

    async function typeLongBody() {
      await screen.findByTestId("web-profile-editor");
      // Same handle the published-lock test uses — the label wraps the counter
      // as well as the control, so it is the value that identifies the box.
      const box = screen.getByDisplayValue("Long FR body") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: LONG } });
      await waitFor(() => expect(box.value).toBe(LONG));
      return box;
    }

    it("Publish does not roll the boxes back to the stored copy", async () => {
      const user = userEvent.setup();
      getServiceTypeWeb.mockResolvedValue(publishableTab());
      // The server echoes the row as it stands — WITHOUT the unsaved edit,
      // which is exactly the payload that used to overwrite it.
      publishServiceTypeWeb.mockResolvedValue(
        publishableTab({
          profile: { ...publishableTab().profile!, is_published: true },
        }),
      );

      view(
        <ServiceTypeWebTab
          serviceTypeId={ST_ID}
          serviceTypeKey={ST_KEY}
          onEditServiceType={() => {}}
        />,
      );

      const box = await typeLongBody();
      await user.click(screen.getByRole("button", { name: /^Publish$/i }));

      await waitFor(() => expect(publishServiceTypeWeb).toHaveBeenCalled());
      // The published state landed...
      await waitFor(() => expect(screen.getByText(/Published/)).toBeTruthy());
      // ...and the typing is still there.
      expect(box.value).toBe(LONG);
    });

    it("saving the FAQ does not roll the boxes back", async () => {
      const user = userEvent.setup();
      getServiceTypeWeb.mockResolvedValue(draftTab());
      replaceServiceTypeWebFaq.mockResolvedValue({ tab: draftTab() });

      view(
        <ServiceTypeWebTab
          serviceTypeId={ST_ID}
          serviceTypeKey={ST_KEY}
          onEditServiceType={() => {}}
        />,
      );

      const box = await typeLongBody();
      const faqSave = screen.queryByRole("button", { name: /Save FAQ/i });
      if (faqSave) {
        await user.click(faqSave);
        await waitFor(() =>
          expect(replaceServiceTypeWebFaq).toHaveBeenCalled(),
        );
      }
      expect(box.value).toBe(LONG);
    });

    it("a successful save says so, and keeps what was typed during the request", async () => {
      const user = userEvent.setup();
      getServiceTypeWeb.mockResolvedValue(draftTab());
      let release: (v: unknown) => void = () => {};
      upsertServiceTypeWeb.mockImplementation(
        () => new Promise((res) => { release = res; }),
      );

      view(
        <ServiceTypeWebTab
          serviceTypeId={ST_ID}
          serviceTypeKey={ST_KEY}
          onEditServiceType={() => {}}
        />,
      );

      const box = await typeLongBody();
      await user.click(screen.getByRole("button", { name: /^Save$/i }));
      await waitFor(() => expect(upsertServiceTypeWeb).toHaveBeenCalled());

      // A sentence typed while the save is in flight must not be rolled back
      // by the response, which cannot possibly contain it.
      const DURING = LONG + " and one more clause";
      fireEvent.change(box, { target: { value: DURING } });
      release(draftTab({
        profile: { ...draftTab().profile!, long_description_fr: LONG },
      }));

      await waitFor(() =>
        expect(screen.getByText(/Website copy saved/i)).toBeTruthy(),
      );
      expect(box.value).toBe(DURING);
    });

    it("Save with nothing to send says so rather than looking successful", async () => {
      const user = userEvent.setup();
      getServiceTypeWeb.mockResolvedValue(draftTab());

      view(
        <ServiceTypeWebTab
          serviceTypeId={ST_ID}
          serviceTypeKey={ST_KEY}
          onEditServiceType={() => {}}
        />,
      );

      await screen.findByTestId("web-profile-editor");
      await user.click(screen.getByRole("button", { name: /^Save$/i }));

      expect(upsertServiceTypeWeb).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByText(/No changes to save/i)).toBeTruthy(),
      );
    });
  });

});
