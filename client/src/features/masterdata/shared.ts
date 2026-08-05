/**
 * Master data — the page shell every screen in the module uses.
 *
 * Split out of `features/masterdata/pages.tsx` (682 lines) in Phase 4, audit F7.
 * A one-line module, but the alternative is five files each declaring their own
 * `const shell`, which is F14's "shell redefined in 28 files" starting over.
 */
import { pageShell } from "@/lib/layout";

export const shell = pageShell.wide;
