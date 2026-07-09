/**
 * Tiny boot signal. BootGate marks boot "done" when the splash finishes fading;
 * the login uses it to defer autofocus until the splash is actually gone (so the
 * browser doesn't focus the email field — and pop its autofill dropdown —
 * underneath the splash). Decoupled so neither component imports the other.
 */
let done = false;
const listeners = new Set<() => void>();

export const bootSignal = {
  isDone: () => done,
  markDone() {
    if (done) return;
    done = true;
    listeners.forEach((l) => l());
    listeners.clear();
  },
  /** Fires immediately if boot is already done; otherwise once markDone runs. */
  onDone(cb: () => void): () => void {
    if (done) {
      cb();
      return () => {};
    }
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
