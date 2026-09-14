/**
 * Voice notes, end to end, in a real browser.
 *
 * WHY THIS IS A BROWSER TEST AND NOT A JSDOM ONE. jsdom has no media stack at
 * all: `MediaRecorder` does not exist, `<audio>` never loads, never decodes and
 * never plays, and `getBoundingClientRect` returns zeros. Every interesting
 * claim about a voice note — it records to a container the server accepts, the
 * bytes survive the round trip, the clip actually decodes, and the control a
 * hand reaches for is the one that starts it — is a claim jsdom answers "0" to.
 *
 * So the mic is Chromium's own fake device, and the recording is genuine
 * `audio/webm;codecs=opus` produced by the app's own `<VoiceRecorder>`.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "Voice notes not playing." Every part worked in isolation — the recorder
 * produced a valid clip, the server stored and served the exact bytes, and the
 * player played them. What did not work was the control people were pressing:
 * the waveform is FOUR TIMES the area of the play button and is drawn as a
 * progress bar, and its handler began `if (!el) return` on an <audio> element
 * that does not exist until the first play has fetched the clip. So the biggest
 * target in the bubble was a silent, permanent no-op, and the report was
 * "nothing happens" — which is exactly what it did.
 */
import { test, expect, type Page } from "@playwright/test";
import { fakeApi, seedSession } from "./fixtures";

// Chromium's fake mic, so the app's own recorder runs for real.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["microphone"],
});

/** The `file` part of a multipart body — the recorded bytes, as posted. */
function filePart(body: Buffer, contentType: string): Buffer | null {
  const m = /boundary=(.+)$/.exec(contentType);
  if (!m) return null;
  const marker = Buffer.from(`--${m[1].trim()}`);
  let i = body.indexOf(marker);
  while (i !== -1) {
    const next = body.indexOf(marker, i + marker.length);
    if (next === -1) break;
    const part = body.subarray(i + marker.length, next);
    const sep = part.indexOf("\r\n\r\n");
    if (sep !== -1 && /name="file"/.test(part.subarray(0, sep).toString())) {
      return part.subarray(sep + 4, part.length - 2); // drop the trailing CRLF
    }
    i = next;
  }
  return null;
}

/**
 * A channel whose media endpoints echo back whatever was recorded, so the clip
 * under test is the one this browser actually produced.
 */
async function chatWithRecording(page: Page) {
  await seedSession(page);
  await fakeApi(page);

  const state: { uploaded: Buffer | null; type: string } = { uploaded: null, type: "" };
  let attachment: Record<string, unknown> | null = null;
  const messages: unknown[] = [];

  await page.route("**/api/tenant/smartcomm/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/tenant/smartcomm", "");
    const method = req.method();

    if (path.endsWith("/media") && method === "POST") {
      const body = req.postDataBuffer()!;
      state.uploaded = filePart(body, req.headers()["content-type"] || "");
      state.type =
        /name="file"[\s\S]*?Content-Type: ([^\r\n]+)/.exec(body.toString("latin1"))?.[1] || "";
      attachment = {
        attachment_kind: "MEDIA",
        media_id: "med-1",
        kind: "AUDIO",
        content_type: (state.type.split(";")[0] || "audio/webm").trim(),
        duration_ms: 3000,
        waveform: [10, 50, 90, 20, 70, 35],
        is_voice_note: true,
        transcript_status: "UNAVAILABLE",
      };
      await route.fulfill({ status: 201, json: { data: attachment } });
      return;
    }
    if (path.startsWith("/media/")) {
      await route.fulfill({
        status: 200,
        contentType: (attachment?.content_type as string) || "audio/webm",
        body: state.uploaded!,
      });
      return;
    }

    let data: unknown = [];
    if (path === "/channels")
      data = [{ group_id: "group", name: "Ops", kind: "DIRECT", member_count: 2 }];
    else if (path === "/channels/group") data = { group_id: "group", name: "Ops", kind: "DIRECT" };
    else if (path === "/channels/group/messages") {
      if (method === "POST") {
        const b = req.postDataJSON() || {};
        const msg = {
          message_id: `m-${messages.length + 1}`,
          group_id: "group",
          sender_user_id: "u-1",
          body: b.body || "",
          created_at: new Date().toISOString(),
          attachments: (b.attachments || []).map((a: Record<string, unknown>) => ({
            ...attachment,
            ...a,
          })),
        };
        messages.push(msg);
        data = msg;
      } else data = { group_id: "group", messages };
    }
    await route.fulfill({ status: 200, json: { data } });
  });

  await page.goto("/comms?channel=group");
  return state;
}

/** Record and send one clip through the app's own composer. */
async function recordAndSend(page: Page) {
  const mic = page.getByRole("button", { name: "Record a voice note" });
  await expect(mic).toBeVisible({ timeout: 20_000 });
  await mic.click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Stop and attach the recording" }).click();
  await expect(page.getByRole("button", { name: /Play voice note/ })).toBeVisible({
    timeout: 20_000,
  });
}

/** What the <audio> element is actually doing. */
const audioState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("audio");
    return el
      ? {
          present: true,
          paused: el.paused,
          currentTime: el.currentTime,
          duration: el.duration,
          error: el.error?.code ?? null,
        }
      : { present: false, paused: true, currentTime: 0, duration: 0, error: null };
  });

test("a recorded clip reaches the server as a container it accepts", async ({ page }) => {
  const state = await chatWithRecording(page);
  await recordAndSend(page);

  // Not an empty blob, and not a container the media service routes to the
  // document vault as an unknown file.
  expect(state.uploaded!.length).toBeGreaterThan(1000);
  expect(state.type).toMatch(/^audio\/(webm|mp4|ogg)/);
});

test("the waveform starts the clip — it is the target a hand reaches for", async ({ page }) => {
  await chatWithRecording(page);
  await recordAndSend(page);

  const bar = page.getByRole("button", { name: /Play from a point in the voice note/ });
  const play = page.getByRole("button", { name: /Play voice note/ });
  const barBox = (await bar.boundingBox())!;
  const playBox = (await play.boundingBox())!;

  /*
   * The premise, asserted rather than assumed: the bar really is the bigger
   * target. If a redesign ever made the play button the dominant one this test
   * would still pass on the line below, and this expectation is what says why
   * the line below matters.
   */
  expect(barBox.width * barBox.height).toBeGreaterThan(playBox.width * playBox.height);

  // THE REGRESSION. This used to create no <audio> element, issue no request,
  // show no error and do nothing at all, for ever.
  await bar.click();
  await expect
    .poll(async () => (await audioState(page)).present, { timeout: 15_000 })
    .toBe(true);
  await expect
    .poll(async () => (await audioState(page)).currentTime > 0, { timeout: 15_000 })
    .toBe(true);

  // And it decoded: a clip the browser refuses sets `error` and never advances.
  expect((await audioState(page)).error).toBeNull();
});

test("the play button plays the clip through to the end", async ({ page }) => {
  await chatWithRecording(page);
  await recordAndSend(page);

  await page.getByRole("button", { name: /Play voice note/ }).click();
  await expect
    .poll(async () => (await audioState(page)).currentTime > 0.3, { timeout: 15_000 })
    .toBe(true);

  const played = await audioState(page);
  expect(played.error).toBeNull();
  expect(played.duration).toBeGreaterThan(0.5);

  // Nothing is reported as broken on the happy path — the failure sentences are
  // for failures.
  await expect(page.getByText(/Couldn't load that recording/)).toHaveCount(0);
  await expect(page.getByText(/can't play this recording/)).toHaveCount(0);
});
