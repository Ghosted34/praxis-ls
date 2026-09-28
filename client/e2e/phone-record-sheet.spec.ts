/**
 * A list-with-a-360 on a phone: the record is a sheet over the list, and the
 * list is still exactly where you left it when the sheet goes.
 *
 * ── THE REPORTS THIS GATE EXISTS FOR ───────────────────────────────────────
 *
 *   1. "The 360 does not scroll down." It did scroll — to within ~66px of the
 *      end, which then sat behind the fixed bottom nav with the scroll already
 *      at its limit. The shell's `<main>` pads its bottom by 96px for that nav,
 *      and a scroll container honours end padding only after its in-flow
 *      CHILDREN — never after a descendant's overflow. The pull-to-refresh
 *      wrapper between them is `h-full` (the chat and AI screens need it), so
 *      every long page overflowed it and lost the padding. Nothing in jsdom can
 *      see it: it needs a layout engine and a fixed element to hide behind.
 *
 *   2. "On a phone I have to scroll past the whole list to reach the record."
 *      Below `lg` the split pane stacked the record UNDER the list. It is now a
 *      full-screen sheet over it, with a ✕ top right and Back to close it —
 *      and closing has to land exactly where the reader was.
 *
 * The Financial dictionary is the screen from the report (its Spend tab), so it
 * is the one measured. Every other split screen shares the same two pieces —
 * the shell spacer and `<SplitPane onClose>` — so a regression in either shows
 * here first.
 */
import { test, expect, devices, type Page } from "@playwright/test";
import { seedSession, fakeApi } from "./fixtures";

const ITEMS = Array.from({ length: 30 }, (_, i) => ({
  dictionary_item_id: `d-${i + 1}`,
  code: `TRANSPORT-${String(i + 1).padStart(3, "0")}`,
  label_fr: `Transport ligne ${i + 1}`,
  label_en: `Transport line ${i + 1}`,
  category: "service",
  direction: i % 2 ? "EXPENSE" : "REVENUE",
  applicability_mode: "ALWAYS",
  is_active: true,
}));

function dossier(id: string) {
  const item = ITEMS.find((x) => x.dictionary_item_id === id) ?? ITEMS[0];
  return {
    item: { ...item, posting_rules: [], service_tiers: [] },
    posting_rules: [],
    service_tiers: [],
    usage: {
      costing_lines: 0,
      cash_request_lines: 0,
      purchase_order_items: 0,
      invoice_lines: 0,
      supplier_invoice_lines: 0,
      cost_entries: 0,
      expense_rates: 0,
    },
    compliance: {
      requires_justification: false,
      receipt_requirement: "NEVER",
      is_disbursement: false,
      disbursement_vat_transparent: false,
      needs_attention: false,
    },
    capabilities: { edit_rates: false },
  };
}

const SPEND = {
  item: { dictionary_item_id: "d-1", code: "TRANSPORT-001", currency: "XAF", direction: "EXPENSE" },
  period: { from: "2025-10-01", to: "2026-09-27" },
  months: [],
  totals: {
    estimated: 0,
    committed: 0,
    actual: 0,
    estimated_count: 0,
    committed_count: 0,
    actual_count: 0,
    headline: 0,
    variance_committed_actual: 0,
    variance_estimated_actual: 0,
  },
  documents: [],
};

/** Registered AFTER `fakeApi`: Playwright runs the last-registered route first. */
async function openDictionary(page: Page) {
  await seedSession(page);
  await fakeApi(page);
  await page.route("**/api/tenant/financial-dictionary**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const m = path.match(/financial-dictionary\/([^/]+)\/(360|spend|rate-history)$/);
    const body =
      m?.[2] === "360"
        ? dossier(m[1])
        : m?.[2] === "spend"
          ? SPEND
          : m
            ? { series: [] }
            : ITEMS;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/master/financial-dictionary", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { level: 1, name: /Financial dictionary/i })
    .waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /TRANSPORT-030/ }).waitFor();
}

const main = (page: Page) =>
  page.evaluate(() => {
    const m = document.getElementById("main-content")!;
    return { top: m.scrollTop, max: m.scrollHeight - m.clientHeight };
  });

/**
 * Where the list is standing while the sheet covers it. Recorded AFTER the tap,
 * not before: Playwright scrolls a row that is partly under the bottom nav into
 * view before tapping it, and anything still settling above the list moves the
 * scroll through the browser's scroll anchoring — a number taken before the tap
 * measures the test, not the sheet. "Exactly where you were" means: the list
 * does not move between the sheet opening and the sheet closing.
 */
async function listUnderSheet(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  return (await main(page)).top;
}

const scrollMainTo = (page: Page, top: number) =>
  page.evaluate((y) => {
    document.getElementById("main-content")!.scrollTop = y;
  }, top);

/** A phone — size, touch and user agent — without `defaultBrowserType`, which
 *  Playwright refuses inside a describe group (it would force a new worker). */
const { defaultBrowserType: _browser, ...PHONE } = devices["Pixel 7"];

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the end of a long page clears the bottom nav", async ({ page }) => {
    await openDictionary(page);
    const { max } = await main(page);
    expect(max).toBeGreaterThan(0);
    await scrollMainTo(page, max);

    const lastRow = page.getByRole("button", { name: /TRANSPORT-030/ });
    const rowBottom = (await lastRow.boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    // Zero overlap with the nav at the end of the scroll — the whole point.
    expect(rowBottom.y + rowBottom.height).toBeLessThanOrEqual(nav.y);
  });

  test("the list opens nothing by itself — the reader picks", async ({ page }) => {
    await openDictionary(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a record opens as a full-screen sheet that scrolls to its last line", async ({ page }) => {
    await openDictionary(page);
    await page.getByRole("button", { name: /TRANSPORT-001/ }).click();

    const sheet = page.getByRole("dialog", { name: /TRANSPORT-001/ });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.round(box.width)).toBe(vp.width);
    expect(Math.round(box.height)).toBe(vp.height);
    // The ✕ is top right.
    const close = (await sheet.getByRole("button", { name: "Close" }).boundingBox())!;
    expect(close.y).toBeLessThan(80);
    expect(close.x + close.width).toBeGreaterThan(vp.width - 60);

    // The report's tab, scrolled to its end: the last card is wholly on screen.
    await sheet.getByRole("button", { name: /^Spend/ }).click();
    await sheet.getByText(/No documents in this period/i).waitFor();
    await sheet.evaluate((el) => {
      const body = el.querySelector<HTMLElement>("[data-record-sheet-body]")!;
      body.scrollTop = body.scrollHeight;
    });
    const last = (await sheet.getByText(/No documents in this period/i).boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(vp.height);
  });

  test("✕ closes it and lands exactly where the list was", async ({ page }) => {
    await openDictionary(page);
    await scrollMainTo(page, 600);

    const row = page.getByRole("button", { name: /TRANSPORT-012/ });
    await row.click();
    const under = await listUnderSheet(page);
    expect(under).toBeGreaterThan(0);
    expect(new URL(page.url()).searchParams.get("sheet")).toBe("1");

    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await main(page)).top).toBe(under);
    // The step the sheet added is gone again, not left behind for Forward.
    expect(new URL(page.url()).searchParams.get("sheet")).toBeNull();
    await expect(row).toBeFocused();
  });

  test("Back closes the sheet and stays on the list", async ({ page }) => {
    await openDictionary(page);
    await scrollMainTo(page, 400);

    await page.getByRole("button", { name: /TRANSPORT-010/ }).click();
    const under = await listUnderSheet(page);

    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/master/financial-dictionary");
    expect((await main(page)).top).toBe(under);

    // And the same row opens again — closing deselected it rather than
    // leaving a selection the sheet can no longer show.
    await page.getByRole("button", { name: /TRANSPORT-010/ }).click();
    await expect(page.getByRole("dialog", { name: /TRANSPORT-010/ })).toBeVisible();
  });
});

/* ── A screen whose selection already lives in the URL ──────────────────────
 * Clients, Employees and Locations keep the open record in `?focus=`
 * (useRecordParam), so opening one is ALREADY a step Back can undo. The sheet
 * must reuse that step rather than add its own — two steps would make Back take
 * two presses to leave one record. */

const CLIENTS = Array.from({ length: 24 }, (_, i) => ({
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
    contacts: [],
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

async function openClients(page: Page) {
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
  await page.goto("/master/clients", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: /Clients/i }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /Client 24/ }).waitFor();
}

test.describe("on a phone, with the selection in the URL", () => {
  test.use(PHONE);

  test("the sheet reuses the ?focus= step: one Back closes it, the ✕ steps back", async ({ page }) => {
    await openClients(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await scrollMainTo(page, 300);

    await page.getByRole("button", { name: /^Client 9\b/ }).click();
    await expect(page.getByRole("dialog", { name: "Client 9" })).toBeVisible();
    const under = await listUnderSheet(page);
    const opened = new URL(page.url()).searchParams;
    expect(opened.get("focus")).toBe("c-9");
    expect(opened.get("sheet")).toBeNull();

    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("focus")).toBeNull();
    expect((await main(page)).top).toBe(under);

    await page.getByRole("button", { name: /^Client 9\b/ }).click();
    await expect(page.getByRole("dialog", { name: "Client 9" })).toBeVisible();
    const underAgain = await listUnderSheet(page);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("focus")).toBeNull();
    expect((await main(page)).top).toBe(underAgain);
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("nothing changes: the first record opens beside the list, no sheet", async ({ page }) => {
    await openDictionary(page);
    await expect(page.getByRole("heading", { level: 2, name: /Transport line 1$/ })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "Dictionary list width" })).toBeVisible();
  });
});
