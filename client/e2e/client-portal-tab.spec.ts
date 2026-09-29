/**
 * The client's portal, managed from the Client 360 — at a phone's width and at
 * a desktop's, and each has to look like it was built for that device.
 *
 * Everything about a client's portal (who can sign in, their invitations,
 * their onboarding) lives in the Client 360's Portal tab; the settings every
 * client shares in ⚙ Settings on the Clients list; investors and auditors on
 * Settings → Portal access. jsdom applies no media queries, so none of what
 * separates the two shells is visible to the unit tests. This is where it is
 * measured:
 *
 *   · DESKTOP — the people are a table with the 360's other tabs' columns and
 *     row height, the checklist is real checkboxes, the settings are the
 *     registry table the categories editor draws, Portal access is the shared
 *     list-screen table; dialogs are centred, and nothing scrolls sideways at
 *     1280, 1440 or 1920.
 *   · PHONE — the same records as cards and thumb-sized rows inside the 360's
 *     sheet, dialogs anchored to the bottom edge, nothing wider than the
 *     screen.
 */
import { test, expect, devices, type Page } from "@playwright/test";
import { seedSession, fakeApi } from "./fixtures";

const { defaultBrowserType: _browser, ...PHONE } = devices["Pixel 7"];

const CLIENTS = Array.from({ length: 6 }, (_, i) => ({
  client_id: `c-${i + 1}`,
  name: `Client ${i + 1}`,
  is_active: true,
  registration_status: "ACTIVE",
}));

function client360(id: string) {
  const c = CLIENTS.find((x) => x.client_id === id) ?? CLIENTS[0];
  return {
    party: {
      client_id: c.client_id,
      name: c.name,
      legal_name: `${c.name} SA`,
      ref: `CLI-${c.client_id}`,
      is_active: true,
      country_code: "CM",
      compliance_state: "OK",
      registration_status: "ACTIVE",
      verification_status: "VERIFIED",
      hard_blocked_at: null,
    },
    kpis: {
      outstanding: 0,
      overdue: 0,
      oldest_due_date: null,
      credit_limit: 5_000_000,
      credit_available: 5_000_000,
      ytd_revenue: 0,
      dossiers_in_progress: 0,
      aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    },
    compliance: { compliance_state: "OK", can_verify: false, flags: [] },
    gl_parity: { ok: true, ledger: 0, subledger: 0, delta: 0 },
    contacts: [
      { contact_id: "k-1", name: "Esi Mensah-Boateng", email: "esi.mensah-boateng@a-rather-long-company-domain.cm" },
      { contact_id: "k-2", name: "Kwame Asante", email: "kwame@client.cm" },
    ],
    addresses: [],
    banks: [],
    documents: [],
    registrations: [],
    beneficial_owners: [],
    dossiers: [],
    invoices: [],
    receipts: [],
    advances: [],
    aliases: [],
    duplicate_candidates: [],
    pending_changes: [],
  };
}

const person = (i: number, over: Record<string, unknown> = {}) => ({
  portal_access_id: `g-${i}`,
  email: `person.number.${i}@a-rather-long-company-domain.cm`,
  client_id: "c-1",
  access_scope: ["ALL", "OPERATIONS", "BILLING"][i % 3],
  is_client_admin: i === 0,
  invited_by_email: null,
  created_at: "2026-09-01T09:00:00Z",
  expires_at: i === 2 ? "2026-12-31T23:59:59.999Z" : null,
  full_name: i % 2 ? null : `Person With A Long Name ${i}`,
  last_login_at: i === 0 ? "2026-09-20T09:00:00Z" : null,
  sign_in: ["ACTIVE", "INVITE_EXPIRED", "INVITED", "NOT_INVITED"][i % 4],
  invited_at: "2026-09-25T09:00:00Z",
  invite_expires_at: "2026-10-02T09:00:00Z",
  ...over,
});

const PEOPLE = { members: [0, 1, 2, 3].map((i) => person(i)), defaults: { access_scope: "ALL", first_is_admin: true } };
const ONBOARDING = {
  client_id: "c-1",
  progress: 50,
  steps: [
    { step_key: "COMPANY_PROFILE", label_en: "Company profile completed", label_fr: "Profil d'entreprise complété", done: true, done_at: "2026-09-02T09:00:00Z" },
    { step_key: "KYC_DOCUMENTS", label_en: "KYC documents received", label_fr: "Documents KYC reçus", done: true, done_at: "2026-09-10T09:00:00Z" },
    { step_key: "SERVICE_AGREEMENT", label_en: "Service agreement signed", label_fr: "Convention de service signée", done: false, done_at: null },
    { step_key: "FIRST_BOOKING", label_en: "First shipment booked", label_fr: "Première expédition réservée", done: false, done_at: null },
  ],
};
const SETTINGS = {
  invite_defaults: { access_scope: "ALL", first_is_admin: true },
  onboarding_steps: ONBOARDING.steps.map((s, i) => ({ ...s, sort_order: (i + 1) * 10, is_active: true })),
};

/**
 * The boot splash stays up for the tenant's minimum splash time AFTER the app
 * underneath has rendered (boot-gate.tsx) — so a heading can already be
 * "visible" to a locator while a screenshot, or anything measured against the
 * viewport, still sees the splash. Wait for its fixed root to leave the DOM.
 */
async function splashGone(page: Page) {
  await page.waitForFunction(
    () => !Array.from(document.querySelectorAll<HTMLElement>('div[style*="z-index: 100"]')).some((d) => d.style.position === "fixed"),
    undefined,
    { timeout: 15_000 },
  );
}

/** Registered AFTER `fakeApi`: Playwright runs the last-registered route first. */
async function openClients(page: Page, search = "") {
  await seedSession(page);
  await fakeApi(page);
  await page.route("**/api/tenant/clients**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const m = path.match(/\/clients\/([^/]+)\/360$/);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(m ? client360(m[1]) : /\/clients$/.test(path) ? CLIENTS : {}),
    });
  });
  await page.route("**/api/tenant/portal/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = /\/people$/.test(path)
      ? PEOPLE
      : /\/onboarding$/.test(path)
        ? ONBOARDING
        : /\/portal\/settings$/.test(path)
          ? SETTINGS
          : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`/master/clients${search}`, { waitUntil: "domcontentloaded" });
  // With a client in the URL a phone opens its sheet at once, and the sheet
  // hides the page heading from the accessibility tree — so wait for whichever
  // this visit is meant to show.
  if (search.includes("focus=")) await page.getByRole("heading", { name: "Who can sign in" }).first().waitFor({ timeout: 15_000 });
  else await page.getByRole("heading", { level: 1, name: /Clients/i }).waitFor({ timeout: 15_000 });
  await splashGone(page);
}

const GRANTS = [
  { portal_access_id: "pa-1", portal: "AUDITOR", subject_email: "auditor@kpmg-cameroun.example", client_id: null, expires_at: "2026-12-31T23:59:59.999Z", created_at: "2026-09-01T09:00:00Z" },
  { portal_access_id: "pa-2", portal: "INVESTOR", subject_email: "board.member@fund.example", client_id: null, expires_at: null, created_at: "2026-08-15T09:00:00Z" },
  { portal_access_id: "pa-3", portal: "CLIENT", subject_email: "ops@client-one.example", client_id: "c-1", expires_at: null, created_at: "2026-09-02T09:00:00Z" },
  { portal_access_id: "pa-4", portal: "CLIENT", subject_email: "finance@client-one.example", client_id: "c-1", expires_at: null, created_at: "2026-09-03T09:00:00Z" },
];
const PORTAL_USERS = [{ portal_user_id: "u-1", email: "board.member@fund.example", last_login_at: "2026-09-20T09:00:00Z" }];

async function openPortalAccess(page: Page) {
  await seedSession(page);
  await fakeApi(page);
  await page.route("**/api/tenant/portals/access**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GRANTS) }),
  );
  await page.route("**/api/tenant/portal/users**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PORTAL_USERS) }),
  );
  await page.route("**/api/tenant/clients**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CLIENTS) }),
  );
  await page.goto("/settings/portal-access", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "Portal access" }).waitFor({ timeout: 15_000 });
  await page.getByText("auditor@kpmg-cameroun.example").first().waitFor({ timeout: 15_000 });
  await splashGone(page);
}

/** Everything that sticks out past the viewport's right edge, by its text. */
async function overflowing(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ["<scope not found>"];
    const vw = document.documentElement.clientWidth;
    return Array.from(root.querySelectorAll<HTMLElement>("button, a, li, p, h4, input, label"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1;
      })
      .map((el) => `${el.tagName} "${(el.textContent || "").trim().slice(0, 40)}"`);
  }, scope);
}

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the Portal tab is cards and thumb-sized rows inside the sheet, nothing wider than the screen", async ({ page }, info) => {
    await openClients(page, "?focus=c-1&tab=Portal");
    const sheet = page.getByRole("dialog", { name: "Client 1" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Person With A Long Name 0")).toBeVisible();
    // The phone's shell, not a squeezed table. (Scoped to the section: the
    // record's own header has an Edit button too.)
    const people = sheet.locator("section", { has: page.getByRole("heading", { name: "Who can sign in" }) });
    await expect(sheet.locator("table")).toHaveCount(0);
    await expect(people.getByRole("button", { name: "Edit" })).toHaveCount(4);

    expect(await overflowing(page, "[role=dialog]"), "something sticks out of the sheet").toEqual([]);

    const step = sheet.getByRole("button", { name: /Service agreement signed/ });
    expect((await step.boundingBox())!.height).toBeGreaterThanOrEqual(56);

    await info.attach("portal-tab-phone", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("inviting someone is a bottom sheet over the record", async ({ page }, info) => {
    await openClients(page, "?focus=c-1&tab=Portal");
    const sheet = page.getByRole("dialog", { name: "Client 1" });
    await sheet.getByRole("button", { name: "+ Invite" }).click();

    const invite = page.getByRole("dialog", { name: "Invite to the client portal" });
    await expect(invite).toBeVisible();
    await expect(invite.getByRole("button", { name: "Kwame Asante" })).toBeVisible();
    await page.waitForTimeout(400);
    const box = (await invite.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(Math.round(box.y + box.height), "anchored to the bottom edge").toBeGreaterThanOrEqual(vh - 2);
    expect(box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 2);
    expect(await overflowing(page, "[role=dialog]:last-of-type")).toEqual([]);

    await info.attach("invite-sheet-phone", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("one person's sheet fits, with its actions stacked full-width", async ({ page }, info) => {
    await openClients(page, "?focus=c-1&tab=Portal");
    const sheet = page.getByRole("dialog", { name: "Client 1" });
    const people = sheet.locator("section", { has: page.getByRole("heading", { name: "Who can sign in" }) });
    await people.getByRole("button", { name: "Edit" }).nth(1).click();
    const person = page.getByRole("dialog", { name: /person\.number\.1@/ });
    await expect(person.getByText("Invitation expired").first()).toBeVisible();
    const remove = person.getByRole("button", { name: "Remove access" });
    await remove.scrollIntoViewIfNeeded();
    const vw = page.viewportSize()!.width;
    expect((await remove.boundingBox())!.width).toBeGreaterThan(vw * 0.7);
    expect(await overflowing(page, "[role=dialog]:last-of-type")).toEqual([]);

    await info.attach("person-sheet-phone", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("⚙ Settings → Client portal is rows sized for a thumb", async ({ page }, info) => {
    await openClients(page);
    await page.getByRole("button", { name: /Settings/ }).first().click();
    const settings = page.getByRole("dialog", { name: "Master data settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Client portal" }).click();
    await expect(settings.getByText("New invitations")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Actions for Company profile completed" })).toBeVisible();
    await expect(settings.locator("table")).toHaveCount(0);
    expect(await overflowing(page, "[role=dialog]")).toEqual([]);
    const move = settings.getByRole("button", { name: /^Move .* down$/ }).first();
    expect((await move.boundingBox())!.height).toBeGreaterThanOrEqual(36);

    await info.attach("settings-phone", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("Portal access is a card per grant", async ({ page }, info) => {
    await openPortalAccess(page);
    await expect(page.getByText("auditor@kpmg-cameroun.example")).toBeVisible();
    await expect(page.locator("table").first()).toBeVisible(); // the short client list stays a table
    expect(await overflowing(page, "main")).toEqual([]);
    const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scrollX).toBe(0);

    await info.attach("portal-access-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
});

for (const width of [1280, 1440, 1920]) {
  test.describe(`on a ${width}px desktop`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("the Portal tab is a table beside the list, with desktop-height rows", async ({ page }, info) => {
      await openClients(page, "?focus=c-1&tab=Portal");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const people = page.locator("table").first();
      await expect(people.locator("thead th")).toHaveText(["Person", "What they see", "Sign-in", "Access until", "Actions"]);
      // A desktop row: two lines of text at most, never a phone's 56px tile.
      for (const h of await people.locator("tbody tr").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeLessThanOrEqual(56);
      }
      // The whole table fits its frame — no row action hidden past a sideways
      // scroll inside the tab (the frame is overflow-x-auto, so the page
      // itself would not show it).
      const frame = await people.evaluate((t) => {
        const box = t.parentElement as HTMLElement;
        return box.scrollWidth - box.clientWidth;
      });
      expect(frame, "the people table scrolls sideways inside its frame").toBeLessThanOrEqual(1);
      // The checklist is real checkboxes, one dense line each.
      const boxes = page.getByRole("checkbox");
      await expect(boxes).toHaveCount(4);
      for (const h of await page.locator("li:has([role=checkbox])").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeLessThanOrEqual(40);
      }
      const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(scrollX).toBe(0);

      await page.getByRole("heading", { name: "Who can sign in" }).scrollIntoViewIfNeeded();
      await info.attach(`portal-tab-${width}`, { body: await page.screenshot(), contentType: "image/png" });

      // The invite is a centred dialog here, not a sheet on the bottom edge.
      await page.getByRole("button", { name: "+ Invite" }).click();
      const invite = page.getByRole("dialog", { name: "Invite to the client portal" });
      await expect(invite).toBeVisible();
      await page.waitForTimeout(400);
      const box = (await invite.boundingBox())!;
      expect(box.width).toBeLessThan(760);
      expect(box.y).toBeGreaterThan(8);
      await info.attach(`invite-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    });

    test("⚙ Settings → Client portal is the registry table the categories use", async ({ page }, info) => {
      await openClients(page);
      await page.getByRole("button", { name: /Settings/ }).first().click();
      const settings = page.getByRole("dialog", { name: "Master data settings" });
      await settings.getByRole("button", { name: "Client portal" }).click();
      const table = settings.locator("table");
      await expect(table).toBeVisible();
      await expect(settings.getByRole("button", { name: "+ Add new" })).toBeVisible();
      for (const h of await table.locator("tbody tr").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeLessThanOrEqual(44);
      }
      await info.attach(`settings-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    });

    test("Portal access is the shared list table, rows at the user's density", async ({ page }, info) => {
      await openPortalAccess(page);
      const grants = page.locator("table").first();
      await expect(grants.locator("thead th")).toHaveText(["Email", "Portal", "Sign-in", "Access until", "Granted", "Actions"]);
      const frame = await grants.evaluate((t) => {
        const box = t.parentElement as HTMLElement;
        return box.scrollWidth - box.clientWidth;
      });
      expect(frame, "the grants table scrolls sideways inside its frame").toBeLessThanOrEqual(1);
      for (const h of await grants.locator("tbody tr").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeLessThanOrEqual(40);
      }
      const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(scrollX).toBe(0);
      await info.attach(`portal-access-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  });
}
