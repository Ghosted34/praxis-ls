/**
 * The call-summary push speaks the device's language (calls audit A11).
 *
 * The server sends English plus `data.kind = "call_summary"` and the facts
 * (who, when, how long); the service worker re-renders the title and body from
 * `navigator.language`, the same way ring strings are. The real worker script
 * runs here in a sandbox with a fake `self`, so this is its actual behaviour,
 * not a text match.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vm from "node:vm";

const source = readFileSync(join(__dirname, "../../public/push-handler.js"), "utf8");

type Shown = { title: string; options: { body: string; data: Record<string, unknown> } };

async function deliver(payload: unknown, language: string): Promise<Shown> {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: Shown[] = [];
  const self = {
    navigator: { language },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    registration: {
      showNotification: async (title: string, options: Shown["options"]) => { shown.push({ title, options }); },
    },
    clients: { matchAll: async () => [] },
  };
  vm.runInNewContext(source, { self, console, Promise, Intl, Date, URL, indexedDB: undefined });
  let done: Promise<unknown> = Promise.resolve();
  listeners.push({
    data: { json: () => payload, text: () => JSON.stringify(payload) },
    waitUntil: (p: Promise<unknown>) => { done = p; },
  });
  await done;
  return shown[0];
}

const summary = {
  title: "Call summary ready",
  // Deliberately the old generic copy: the worker must build the sentence from
  // `data`, not repeat whatever English the server sent.
  body: "Review and send the summary of your call.",
  // The conversation, with the pinned draft open (owner decision O3).
  url: "/comms?channel=5d0c1f7e-1b1d-4a39-8f0e-2b6c3d9e4f10&summary=8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44",
  data: {
    kind: "call_summary",
    call_id: "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44",
    group_id: "5d0c1f7e-1b1d-4a39-8f0e-2b6c3d9e4f10",
    peer_name: "Bruno Kamga",
    ended_at: "2026-09-24T13:05:00.000Z",
    duration_seconds: 312,
  },
};

describe("the call-summary push (A11)", () => {
  it("reads French on a French device, with the name, a day-first date and the minutes", async () => {
    const n = await deliver(summary, "fr-FR");
    expect(n.title).toBe("Résumé d'appel prêt");
    expect(n.options.body).toMatch(/^Votre appel avec Bruno Kamga le \d{2}\/\d{2}\/2026 à \d{2}:\d{2} \(5 min\)\. Relisez et envoyez le résumé\.$/);
    expect(n.options.data.url).toBe(summary.url);
  });

  it("reads English elsewhere, day-first too", async () => {
    const n = await deliver(summary, "en-US");
    expect(n.title).toBe("Call summary ready");
    expect(n.options.body).toMatch(/^Your call with Bruno Kamga on \d{2}\/\d{2}\/2026 at \d{2}:\d{2} \(5 min\)\. Review and send the summary\.$/);
  });

  it("leaves out what it does not know rather than printing blanks", async () => {
    const n = await deliver({ ...summary, data: { kind: "call_summary", call_id: "x" } }, "fr");
    expect(n.options.body).toBe("Votre appel. Relisez et envoyez le résumé.");
  });

  it("any other notification is shown as the server wrote it", async () => {
    const n = await deliver({ title: "Invoice approved", body: "INV-12", url: "/finance" }, "fr-FR");
    expect(n.title).toBe("Invoice approved");
    expect(n.options.body).toBe("INV-12");
  });
});
