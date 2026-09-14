import { test, expect, type Page } from "@playwright/test";
import { fakeApi, seedSession } from "./fixtures";

async function openChat(page: Page) {
  await seedSession(page);
  await fakeApi(page);
  const messages = Array.from({ length: 35 }, (_, i) => ({
    message_id: `m-${i}`,
    group_id: "group",
    sender_user_id: i % 2 ? "peer" : "u-1",
    body: `Message ${i}`,
    created_at: "2026-09-14T10:00:00Z",
    attachments: [],
  }));
  const requests: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  const phrases: { quick_reply_id: string; label: string; body: string }[] = [];
  let draft = "";
  let failNextSend = false;
  await page.route("**/api/tenant/smartcomm/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(
      "/api/tenant/smartcomm",
      "",
    );
    const method = req.method();
    const body = ["POST", "PUT", "PATCH"].includes(method)
      ? req.postDataJSON() || {}
      : {};
    requests.push({ method, path, body });
    let data: unknown = [];
    if (path === "/channels")
      data = [
        {
          group_id: "group",
          name: "Operations",
          kind: "DIRECT",
          member_count: 2,
        },
      ];
    else if (path === "/channels/group")
      data = { group_id: "group", name: "Operations", kind: "DIRECT" };
    else if (path === "/colleagues")
      data = [
        { user_id: "u-1", full_name: "Ops Lead" },
        { user_id: "peer", full_name: "Colleague" },
      ];
    else if (path === "/channels/group/messages") {
      if (method === "POST") {
        if (failNextSend) {
          failNextSend = false;
          await route.fulfill({
            status: 503,
            json: { error: { code: "UNAVAILABLE", message: "Try again" } },
          });
          return;
        }
        const sent = {
          ...messages[0],
          message_id: `m-${messages.length}`,
          sender_user_id: "u-1",
          body: body.body,
        };
        messages.push(sent);
        data = sent;
      } else data = { group_id: "group", messages };
    } else if (path.startsWith("/messages/") && method === "PATCH") {
      const message = messages.find(
        (m) => m.message_id === path.split("/").pop(),
      );
      if (message)
        Object.assign(message, {
          body: body.body,
          edited_at: new Date().toISOString(),
        });
      data = message;
    } else if (path.endsWith("/draft")) {
      if (method === "PUT") draft = body.body;
      if (method === "DELETE") draft = "";
      data = { body: draft };
    } else if (path === "/quick-replies") {
      if (method === "POST") {
        const phrase = { quick_reply_id: "phrase", ...body };
        phrases.push(phrase);
        data = phrase;
      } else data = phrases;
    } else if (path.endsWith("/scheduled"))
      data =
        method === "POST"
          ? { schedule_id: "s-1", ...body, status: "PENDING" }
          : [];
    await route.fulfill({ status: 200, json: { data } });
  });
  await page.goto("/comms?channel=group");
  await expect(
    page.getByRole("textbox", { name: "Write a message", exact: true }),
  ).toBeVisible();
  return {
    requests,
    failSend: () => {
      failNextSend = true;
    },
  };
}

for (const width of [320, 390, 1440]) {
  test(`chat composer fits and tools open above it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 833 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openChat(page);
    const editor = page.getByRole("textbox", {
      name: "Write a message",
      exact: true,
    });
    const box = await editor.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(833);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    if (width < 768) {
      /*
       * THE FLOATING CLUSTER IS HERE, AND IT IS ABOVE THE COMPOSER.
       *
       * This used to assert the opposite — a quick-actions menu in the title
       * bar and NO cluster — because the cluster's `bottom-24` anchor lands on
       * the composer's Send button, which is the mic when nothing is typed,
       * which is the control that sends a voice note. Suppressing it was the
       * old answer; the title-bar menu that stood in for it is gone at every
       * width, so a phone in Smart Comms would have had no quick actions and no
       * clock-in at all.
       *
       * The cluster clears the composer instead: `--fab-floor` is published by
       * the composer and the anchor is `max(6rem, var(--fab-floor))`. Asserted
       * as REAL GEOMETRY rather than as a class, because a class cannot tell
       * you whether `max()` resolved, whether the variable reached the
       * portalled node, or whether the composer grew after it was measured —
       * and jsdom lays nothing out, so this is the only place the arithmetic
       * can be checked against a browser that actually performed it.
       */
      const fab = page.getByRole("button", { name: /Quick actions/ });
      await expect(fab).toBeVisible();
      const fabBox = (await fab.boundingBox())!;
      const composerBox = (await page
        .locator("[data-composer]")
        .boundingBox())!;
      expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(composerBox.y);
    }
    expect(
      await page
        .locator("#main-content")
        .evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeLessThanOrEqual(1);
    const plus = page.getByRole("button", { name: "Add to message" });
    await plus.click();
    const menu = page.getByRole("dialog", { name: "Message tools" });
    await expect(menu).toBeVisible();
    const popup = await menu.boundingBox();
    expect(popup!.y + popup!.height).toBeLessThanOrEqual(
      (await plus.boundingBox())!.y + 1,
    );
    for (const name of [
      "Insert Emoji",
      "Attach File",
      "Attach Record / Context",
      "Templates / Quick Phrases",
      "Schedule Message",
    ])
      await expect(
        menu.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("composer-tools.png"),
    });
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await editor.click();
    await editor.pressSequentially("Discard this");
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await editor.pressSequentially("1. First");
    await expect(editor.locator("ol li")).toHaveCount(1);
    await editor.press("Shift+Enter");
    await editor.pressSequentially("Second");
    await expect(editor.locator("ol li")).toHaveCount(2);
    await editor.press("Shift+Enter");
    await editor.press("Shift+Enter");
    await editor.pressSequentially("After list");
    await expect(editor.locator("ol li")).toHaveCount(2);
    await expect(editor).toContainText("After list");
    expect(errors).toEqual([]);
  });
}

test("send, up-arrow edit, edited marker, and failure keep the words", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { requests, failSend } = await openChat(page);
  const editor = page.getByRole("textbox", {
    name: "Write a message",
    exact: true,
  });
  await editor.pressSequentially("- First");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("Second");
  await expect(editor.locator("ul li")).toHaveCount(2);
  await editor.press("Enter");
  await expect(editor).toHaveText("");
  expect(
    requests.find((r) => r.method === "POST" && r.path.endsWith("/messages"))
      ?.body.body,
  ).toBe("- First\n- Second");
  await editor.press("ArrowUp");
  await expect(
    page.getByText("Editing message", { exact: true }),
  ).toBeVisible();
  await editor.fill("Revised message");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("(edited)", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("");
  failSend();
  await editor.fill("Keep me after network failure");
  await editor.press("Enter");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(editor).toHaveText("Keep me after network failure");
});

test("personal quick phrases can be created and inserted, scheduling posts durable payload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { requests } = await openChat(page);
  await page.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("button", { name: "Templates / Quick Phrases" }).click();
  await page.getByRole("button", { name: "Add phrase" }).click();
  await page.getByLabel("Phrase name").fill("Acknowledgment");
  await page.getByLabel("Phrase text").fill("Received, thank you.");
  await page.getByRole("button", { name: "Save phrase" }).click();
  await page.getByRole("button", { name: /Acknowledgment.*Received/ }).click();
  const editor = page.getByRole("textbox", {
    name: "Write a message",
    exact: true,
  });
  await expect(editor).toContainText("Received, thank you.");
  await page.getByRole("button", { name: "Add to message" }).click();
  await page
    .getByRole("button", { name: "Schedule Message", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Scheduled messages" }),
  ).toBeVisible();
  const tomorrow = new Date(Date.now() + 86400000);
  const value = `${String(tomorrow.getDate()).padStart(2, "0")}/${String(tomorrow.getMonth() + 1).padStart(2, "0")}/${tomorrow.getFullYear()} 12:00`;
  await page.getByRole("textbox", { name: /Send at/ }).fill(value);
  await page
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Scheduled messages" }),
  ).not.toBeVisible();
  const scheduled = requests.find(
    (r) => r.method === "POST" && r.path.endsWith("/scheduled"),
  );
  expect(scheduled?.body.body).toBe("Received, thank you.");
  expect(scheduled?.body.request_id).toBeTruthy();
  expect(scheduled?.body.timezone).toBeTruthy();
  expect(
    requests.filter((r) => r.method === "POST" && r.path.endsWith("/messages")),
  ).toHaveLength(0);
});

test("editing from a bubble preserves an existing draft, IME Enter never sends", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { requests } = await openChat(page);
  const editor = page.getByRole("textbox", {
    name: "Write a message",
    exact: true,
  });
  await editor.fill("Unsent draft to restore");
  const actions = page.getByRole("button", { name: "Message actions" }).last();
  await page.getByText("Message 34", { exact: true }).hover();
  await actions.click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(editor).toHaveText("Message 34");
  await editor.fill("Changed my mind");
  await editor.press("Escape");
  await expect(editor).toHaveText("Unsent draft to restore");
  await editor.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(editor).toHaveText("Unsent draft to restore");
  expect(
    requests.filter((r) => r.method === "POST" && r.path.endsWith("/messages")),
  ).toHaveLength(0);
});

test("file tool opens the native picker and a failed send preserves uploaded files", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { requests, failSend } = await openChat(page);
  await page.route("**/api/tenant/smartcomm/channels/group/media", (route) =>
    route.fulfill({
      json: {
        data: {
          attachment_kind: "VAULT",
          vault_id: "doc",
          filename: "instruction.txt",
          content_type: "text/plain",
          size_bytes: 12,
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Add to message" }).click();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach File", exact: true }).click();
  await (
    await picker
  ).setFiles({
    name: "instruction.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Instructions"),
  });
  await expect(
    page.getByText("instruction.txt", { exact: true }),
  ).toBeVisible();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled();
  failSend();
  await send.click();
  await expect(send).toBeEnabled();
  await expect(
    page.getByText("instruction.txt", { exact: true }),
  ).toBeVisible();
  await send.click();
  await expect(
    page.getByText("instruction.txt", { exact: true }),
  ).not.toBeVisible();
  const posts = requests.filter(
    (r) => r.method === "POST" && r.path.endsWith("/messages"),
  );
  expect(posts).toHaveLength(2);
  expect(posts[0].body.attachments).toEqual(posts[1].body.attachments);
});

test("pending messages can be rescheduled and cancelled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChat(page);
  const scheduled = [
    {
      schedule_id: "s-1",
      group_id: "group",
      body: "Send later",
      attachments: [],
      send_at: new Date(Date.now() + 3600000).toISOString(),
      timezone: "UTC",
      status: "PENDING",
    },
  ];
  let rescheduled = false;
  await page.route(
    "**/api/tenant/smartcomm/channels/group/scheduled",
    (route) => route.fulfill({ json: { data: scheduled } }),
  );
  await page.route("**/api/tenant/smartcomm/scheduled/s-1", async (route) => {
    if (route.request().method() === "PATCH") {
      Object.assign(scheduled[0], route.request().postDataJSON());
      rescheduled = true;
    } else scheduled[0].status = "CANCELLED";
    await route.fulfill({ json: { data: scheduled[0] } });
  });
  await page.getByRole("button", { name: "Add to message" }).click();
  await page
    .getByRole("button", { name: "Schedule Message", exact: true })
    .click();
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  const date = new Date(Date.now() + 2 * 86400000);
  await page
    .getByRole("textbox", { name: /Send at/ })
    .fill(
      `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()} 12:00`,
    );
  await page
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Schedule current message",
      exact: true,
    }),
  ).toBeVisible();
  expect(rescheduled).toBe(true);
  await page
    .getByRole("button", { name: "Cancel scheduled message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel scheduled message", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByText(/UTC.*cancelled/)).toBeVisible();
});
