/**
 * Flash the tab title while a call rings (PR-4 step 9): a ringing tab in a
 * row of tabs, or a minimised window's taskbar entry, says who is calling.
 * The original title comes back when the ring stops.
 */
let timer: ReturnType<typeof setInterval> | null = null;
let original: string | null = null;

export const RING_TITLE_FLASH_MS = 1_000;

export function startRingingTitle(label: string): void {
  if (typeof document === "undefined") return;
  stopRingingTitle();
  original = document.title;
  let on = true;
  document.title = label;
  timer = setInterval(() => {
    on = !on;
    document.title = on ? label : original ?? "";
  }, RING_TITLE_FLASH_MS);
}

export function stopRingingTitle(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (original !== null && typeof document !== "undefined") document.title = original;
  original = null;
}
