/**
 * Stop a missed file drop from navigating the tab away from the app.
 *
 * ── WHAT HAPPENS WITHOUT THIS ──────────────────────────────────────────────
 *
 * A browser's default action for a file dropped on a page is to NAVIGATE to it.
 * Not "ignore it" — navigate, the same as typing the path into the address bar.
 * So a drag that lands twenty pixels outside a `<FileDrop>` replaces the whole
 * SPA with the browser's own viewer for that file: a PDF opens in the plugin, an
 * image opens on the viewer's flat dark background, and what the person reports
 * afterwards is "I tried to upload a picture and got a blank black screen".
 *
 * Everything on the screen they left is gone with it — an open form, a
 * half-written description, anything queued. This app treats that as a data-loss
 * path everywhere else (see `ui/error-boundary` and `connection/connection-lost`,
 * both written around the same argument), and losing it to a missed drop target
 * is the least defensible version of it: nothing failed, and nothing said so.
 *
 * ── HOW IT DECIDES ─────────────────────────────────────────────────────────
 *
 * A real dropzone calls `preventDefault()` on `dragover` and `drop` — that is
 * what makes it a drop target at all. These listeners sit on `window`, so they
 * run after the React handler has bubbled out of the root container, and
 * `defaultPrevented` is therefore a reliable answer to "did a dropzone claim
 * this?". If one did, this does nothing. If none did, the drop is swallowed.
 *
 * `dropEffect = "none"` on the unclaimed `dragover` is the visible half: the
 * cursor shows a no-drop badge everywhere except over a real dropzone, so the
 * target is discoverable while dragging rather than after failing. That is only
 * possible because the default was prevented, which is the same call that stops
 * the navigation.
 *
 * Drags that carry no files — text selections, links, an internal row reorder —
 * are left completely alone. They are not the failure mode, and a page that
 * cancels every drag breaks the ones that work.
 */

/** True when the drag carries at least one file from outside the page. */
function carriesFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // `types` is a DOMStringList in some browsers and a plain array in others;
  // `includes` is not on the former, so this reads it the way both support.
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === "Files") return true;
  }
  return false;
}

function onStrayDrag(e: DragEvent): void {
  if (!carriesFiles(e)) return;
  // A dropzone got there first — it owns this drag, including the cursor.
  if (e.defaultPrevented) return;
  e.preventDefault();
  if (e.type === "dragover" && e.dataTransfer) {
    e.dataTransfer.dropEffect = "none";
  }
}

/** Installs the guard. Idempotent; returns a teardown for tests. */
export function installStrayDropGuard(): () => void {
  window.addEventListener("dragover", onStrayDrag);
  window.addEventListener("drop", onStrayDrag);
  return () => {
    window.removeEventListener("dragover", onStrayDrag);
    window.removeEventListener("drop", onStrayDrag);
  };
}
