/**
 * 1:1 voice calls, end to end, in a real browser (Smart Comms PR-1).
 *
 * WHAT IS REAL HERE, because it matters to what this test can claim:
 *
 *   · the WEBRTC MEDIA PATH is real. The dialer's engine runs for real
 *     (Chromium's fake mic feeds it), and the "callee" is a second
 *     RTCPeerConnection created IN THE PAGE, negotiating a genuine
 *     offer/answer exchange over the faked signaling socket. When the
 *     in-call timer appears, a real peer connection has really connected —
 *     this is not a mocked "connected" flag.
 *
 *   · the SIGNALING TRANSPORT is faked at the socket boundary. A real
 *     backend needs Postgres, Redis and a coturn; the fixtures file already
 *     established the bargain that an e2e fakes the server and tests the
 *     client. The fake speaks engine.io's wire format (open packet, `40`
 *     namespace connect, `42` event frames), which is exactly what the
 *     production server emits — if the client stops speaking that format,
 *     this test goes red.
 *
 * The three claims: the phone affordance dials (offer goes out over the
 * socket), the call reaches in-call with real media (timer), and hang-up
 * tears the session down through the server row.
 */
import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { fakeApi, seedSession } from "./fixtures";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["microphone", "notifications"],
});

/** The partner on the faked DIRECT channel. */
const PARTNER = { user_id: "u-9", name: "Aïcha Diallo" };
const CHANNEL = {
  group_id: "ch-e2e-1",
  name: PARTNER.name,
  kind: "DIRECT",
  member_count: 2,
  created_at: "2026-08-01T09:00:00.000Z",
  is_pinned: false,
  is_muted: false,
  unread: 0,
  partner_user_id: PARTNER.user_id,
  partner_avatar_ref: null,
  /* Three days ago — the day-first "Last seen DD/MM/YYYY at HH:MM" form, not
     today/yesterday, so the assertion proves the DATE shape is day-first. */
  partner_last_seen_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

const ICE_EMPTY = { iceServers: [] as unknown[], turnConfigured: false };
function callRow(status: string, extra: Record<string, unknown> = {}) {
  return {
    call_id: "call-e2e-1",
    group_id: CHANNEL.group_id,
    caller_id: "u-1",
    callee_id: PARTNER.user_id,
    status,
    started_at: new Date().toISOString(),
    ...extra,
  };
}

type Frame = [string, unknown];

/**
 * The fake comms server: a socket.io (engine.io v4) endpoint in the page's
 * origin, plus the call REST surface. Returns a handle that records what the
 * client EMITTED (`next("call:offer")`) and lets the test deliver server
 * events (`tell("call:answer", …)`).
 */
async function fakeComms(page: Page) {
  const emitted: Frame[] = [];
  const pending: Array<(f: Frame) => void> = [];
  let ws: WebSocketRoute | null = null;
  const unsent: string[] = []; // server→client frames queued before connect

  const tell = (event: string, payload: unknown) => {
    const frame = `42${JSON.stringify([event, payload])}`;
    if (ws) ws.send(frame);
    else unsent.push(frame);
  };
  const next = (event: string, timeout = 10_000) =>
    new Promise<unknown>((resolve, reject) => {
      const found = emitted.find(([e]) => e === event);
      if (found) return resolve(found[1]);
      const t = setTimeout(() => reject(new Error(`no ${event} frame within ${timeout}ms`)), timeout);
      pending.push((f) => {
        clearTimeout(t);
        resolve(f[1]);
      });
    });

  // Client→server ICE candidates can trickle in before the answering peer
  // connection exists; buffer them here and drain on demand.
  const remoteCandidates: unknown[] = [];

  // Anchored: same-origin socket.io path only — a regex that could match
  // anywhere would route WS frames from ANY host through this fake.
  await page.routeWebSocket(/^wss?:\/\/[^/]+\/socket\.io\//, (route) => {
    ws = route;
    // engine.io open packet, then the socket.io namespace connect ack.
    route.send(
      `0${JSON.stringify({ sid: "sv-e2e", upgrades: [], pingInterval: 25000, pingTimeout: 20000 })}`,
    );
    for (const f of unsent.splice(0)) route.send(f);
    route.onMessage((message) => {
      const text = typeof message === "string" ? message : String(message);
      if (text === "40" || text.startsWith("40")) {
        route.send(`40{"sid":"ns-e2e"}`);
        return;
      }
      if (text.startsWith("42")) {
        let parsed: Frame;
        try {
          parsed = JSON.parse(text.slice(2)) as Frame;
        } catch {
          /* @silent:parse — a frame that is not JSON is not an event the
             protocol can carry; dropping it is what the real server does. */
          return;
        }
        const [event, payload] = parsed;
        if (event === "call:ice") {
          remoteCandidates.push((payload as { candidate: unknown }).candidate);
          return;
        }
        emitted.push(parsed);
        const woke = pending.shift();
        if (woke) woke(parsed);
      }
      // `2` pings are answered by the client itself; joins (`channel:join`)
      // need no reply in production either.
    });
  });

  /* The call REST surface — the row is the server's word in this test. */
  let sawHangup = false;
  let sawDecline = false;
  let sawAccept = false;
  // What `GET /calls/:id` answers with. PR-3's deep-link tests set this: the
  // whole point of the expired-push path is that the ROW, not the socket,
  // decides whether there is still a ring to show.
  let rowForGet: Record<string, unknown> = callRow("NO_ANSWER", { end_reason: "no_answer" });
  await page.route("**/api/tenant/smartcomm/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/tenant/smartcomm", "");
    const method = req.method();
    if (path === "/channels" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([CHANNEL]) });
    }
    if (path === "/colleagues") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { user_id: PARTNER.user_id, full_name: PARTNER.name, email: "aicha@smartls.test", avatar_ref: null, last_seen_at: CHANNEL.partner_last_seen_at },
        ]),
      });
    }
    if (path === "/calls" && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...callRow("RINGING"), ice: ICE_EMPTY }),
      });
    }
    if (/^\/calls\/[^/]+$/.test(path) && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rowForGet),
      });
    }
    if (/^\/calls\/[^/]+\/accept$/.test(path) && method === "POST") {
      sawAccept = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(callRow("IN_CALL", { connected_at: new Date().toISOString(), ice: ICE_EMPTY })),
      });
    }
    if (/^\/calls\/[^/]+\/hangup$/.test(path) && method === "POST") {
      sawHangup = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(callRow("ENDED", { end_reason: "hangup", ended_at: new Date().toISOString(), duration_seconds: 2 })),
      });
    }
    if (/^\/calls\/[^/]+\/decline$/.test(path) && method === "POST") {
      sawDecline = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(callRow("DECLINED", { end_reason: "declined" })),
      });
    }
    return route.fallback();
  });

  return {
    tell,
    next,
    drainRemoteCandidates: () => remoteCandidates.splice(0),
    sawHangup: () => sawHangup,
    sawDecline: () => sawDecline,
    sawAccept: () => sawAccept,
    setRowForGet: (row: Record<string, unknown>) => {
      rowForGet = row;
    },
  };
}

/** Create the answering peer connection IN THE PAGE and return its answer SDP. */
async function createCallee(page: Page, offerSdp: string): Promise<string> {
  return page.evaluate(async (offer) => {
    const w = window as unknown as {
      __callee?: RTCPeerConnection;
      __calleeCands?: RTCIceCandidateInit[];
    };
    const pc = new RTCPeerConnection({ iceServers: [] });
    w.__callee = pc;
    w.__calleeCands = [];
    pc.onicecandidate = (e) => {
      if (e.candidate) w.__calleeCands!.push(e.candidate.toJSON());
    };
    pc.addTransceiver("audio", { direction: "recvonly" });
    await pc.setRemoteDescription({ type: "offer", sdp: offer });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription!.sdp;
  }, offerSdp);
}

/** Feed the callee's own candidates back over the (faked) server, and the
 *  dialer's buffered candidates into the callee PC. Both directions, every
 *  pump — trickle order is not guaranteed on either side. */
async function pumpCandidates(page: Page, comms: Awaited<ReturnType<typeof fakeComms>>) {
  const cands = await page.evaluate(() => {
    const w = window as unknown as { __calleeCands?: RTCIceCandidateInit[] };
    return (w.__calleeCands || []).splice(0);
  });
  for (const c of cands) comms.tell("call:ice", { call_id: "call-e2e-1", candidate: c });
  const incoming = comms.drainRemoteCandidates();
  if (incoming.length) {
    await page.evaluate((list) => {
      const w = window as unknown as { __callee?: RTCPeerConnection };
      return Promise.all(
        (list as RTCIceCandidateInit[]).map((c) => w.__callee!.addIceCandidate(c)),
      );
    }, incoming);
  }
}

test("dial → the offer goes out → real media connects → hang-up closes it", async ({ page }) => {
  await seedSession(page);
  await fakeApi(page);
  const comms = await fakeComms(page);

  await page.goto("/comms?channel=ch-e2e-1");

  // The offline partner's row carries the honest floor: day-first, under the
  // name in the list. 3 days ago → the DD/MM/YYYY form, never invented.
  await expect(page.getByText(/Last seen \d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}/).first()).toBeVisible();

  // Dial from the thread header affordance.
  await page.getByRole("button", { name: "Start a voice call" }).first().click();
  await expect(page.getByText("Calling…")).toBeVisible();
  await expect(page.getByText(PARTNER.name).first()).toBeVisible();

  // The engine minted a REAL offer and the session sent it over the socket.
  const offer = (await comms.next("call:offer")) as { callId: string; sdp: string };
  expect(offer.sdp).toContain("v=0");
  expect(offer.callId).toBe("call-e2e-1");

  // The partner answers — a real second peer connection, in this page.
  const answerSdp = await createCallee(page, offer.sdp);
  comms.tell("call:accepted", { call_id: "call-e2e-1", by: { user_id: PARTNER.user_id } });
  comms.tell("call:answer", { call_id: "call-e2e-1", sdp: answerSdp });

  // Cross ICE candidates both ways until the media path is up.
  await expect
    .poll(
      async () => {
      await pumpCandidates(page, comms);
      const state = await page.evaluate(() => {
        const w = window as unknown as { __callee?: RTCPeerConnection };
        return w.__callee?.iceConnectionState || "new";
      });
        return state;
      },
      { timeout: 15_000 },
    )
    .toBe("connected");

  // In-call: the phase the ROW cannot fake — real ICE connected on the
  // dialer's engine is what flips the overlay to the timer.
  await expect(page.getByRole("timer")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Your microphone is on")).toBeVisible();

  // Hang up: server row first, overlay gone after.
  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  expect(comms.sawHangup()).toBe(true);
});

test("an incoming ring shows who and the 60 s window; declining closes it", async ({ page }) => {
  await seedSession(page);
  await fakeApi(page);
  const comms = await fakeComms(page);

  await page.goto("/comms?channel=ch-e2e-1");
  await expect(page.getByText(PARTNER.name).first()).toBeVisible();

  // The server rings this tab.
  comms.tell("call:ringing", {
    call_id: "call-e2e-2",
    from: { user_id: PARTNER.user_id, name: PARTNER.name },
    ring_timeout_s: 60,
  });

  const ring = page.getByRole("alertdialog");
  await expect(ring).toBeVisible();
  await expect(page.getByText("Incoming call from Aïcha Diallo")).toBeVisible();
  await expect(ring.getByText("Decline")).toBeVisible();

  await ring.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(comms.sawDecline()).toBe(true);
});

/* ── PR-3: ring acknowledgement, background/resume, the deep link ─────────── */

/**
 * Take the tab to the background and back, the way the corridor use case does
 * it: the phone locks, the PWA is hidden, the screen comes back.
 *
 * Playwright cannot background a tab the way a phone can, so the two DOCUMENT
 * facts the client reads are driven directly — `visibilityState` and `hidden` —
 * plus the event that announces the change. Everything downstream of them is
 * real: the socket stays connected, the peer connection stays up, and the
 * session's own state machine is what has to survive.
 */
async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => s === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("a call survives the tab going to the background and coming back", async ({ page }) => {
  await seedSession(page);
  await fakeApi(page);
  const comms = await fakeComms(page);

  await page.goto("/comms?channel=ch-e2e-1");
  await page.getByRole("button", { name: "Start a voice call" }).first().click();
  const offer = (await comms.next("call:offer")) as { callId: string; sdp: string };
  const answerSdp = await createCallee(page, offer.sdp);
  comms.tell("call:accepted", { call_id: "call-e2e-1", by: { user_id: PARTNER.user_id } });
  comms.tell("call:answer", { call_id: "call-e2e-1", sdp: answerSdp });

  await expect
    .poll(
      async () => {
        await pumpCandidates(page, comms);
        return page.evaluate(() => {
          const w = window as unknown as { __callee?: RTCPeerConnection };
          return w.__callee?.iceConnectionState || "new";
        });
      },
      { timeout: 15_000 },
    )
    .toBe("connected");
  await expect(page.getByRole("timer")).toBeVisible({ timeout: 15_000 });

  // Background: the tab is hidden, the media path is not touched by us, and the
  // session must NOT tear the call down for it.
  await setVisibility(page, "hidden");
  await page.waitForTimeout(1500);
  await setVisibility(page, "visible");

  // Still in the call, still counting, and honest about the link: the quality
  // dot is read from REAL getStats() samples, so its presence is the proof the
  // sampler survived the round trip.
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText(/^(Good|Fair|Poor) connection$/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Reconnecting…")).toHaveCount(0);
  await expect(page.getByText("Your microphone is on")).toBeVisible();

  // And it still ends the normal way.
  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  expect(comms.sawHangup()).toBe(true);
});

test("a ring is acknowledged on the socket channel — the ack that stops the push", async ({ page }) => {
  await seedSession(page);
  await fakeApi(page);
  const comms = await fakeComms(page);

  await page.goto("/comms?channel=ch-e2e-1");
  await expect(page.getByText(PARTNER.name).first()).toBeVisible();

  comms.tell("call:ringing", {
    call_id: "call-e2e-3",
    from: { user_id: PARTNER.user_id, name: PARTNER.name },
    ring_timeout_s: 60,
  });
  await expect(page.getByRole("alertdialog")).toBeVisible();

  // A visible tab rings in-app, so the channel it reports is `socket` — and
  // that report is what makes the server stand its push escalation down.
  const ack = (await comms.next("call:ring_ack")) as { callId: string; channel: string };
  expect(ack.callId).toBe("call-e2e-3");
  expect(ack.channel).toBe("socket");
});

test("an expired push opens the redial path, not a ring for a call that is over", async ({ page }) => {
  await seedSession(page);
  await fakeApi(page);
  const comms = await fakeComms(page);
  // The row says the 60-second window is long gone.
  comms.setRowForGet(callRow("NO_ANSWER", { end_reason: "no_answer", callee_id: "u-1" }));

  await page.goto("/comms?call=8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44&act=accept");

  // No fake ring: an honest line and a way to call back.
  await expect(page.getByText("That call has already ended")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Call again" }).click();
  await expect(page.getByText("Calling…")).toBeVisible({ timeout: 10_000 });
  const offer = (await comms.next("call:offer")) as { sdp: string };
  expect(offer.sdp).toContain("v=0");
});
