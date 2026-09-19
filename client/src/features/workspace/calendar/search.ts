/**
 * What the Calendar's filter box matches — kept beside the page, in a `.ts`
 * file so the page keeps fast refresh (a `.tsx` that exports helpers beside
 * a component loses it; see the repo's lint).
 *
 * The filter runs over the window the page already fetched, on the client —
 * no search endpoint, by the recorded scope — so these ARE the search: the
 * words a person types to find an event or a deadline, the same words the
 * Tasks page's search matches server-side.
 */
import type { CalendarEvent, Deadline } from "../api";

/** Case-insensitive "any of these words contain the needle". */
function containsAny(parts: (string | null | undefined)[], needle: string): boolean {
  return parts.some((p) => Boolean(p) && String(p).toLowerCase().includes(needle));
}

/** An event matches on its name, its kind, the room and its notes. */
export function matchesEvent(e: CalendarEvent, needle: string): boolean {
  return containsAny([e.title, e.event_type, e.location, e.description], needle);
}

/**
 * A deadline matches on the task's title and notes, the operations file it
 * is on — reference and client name — and the stages of the chain. A step
 * carries its parent's words, so "the Brasseries one" finds the step too.
 */
export function matchesDeadline(d: Deadline, needle: string): boolean {
  return containsAny(
    [d.title, d.task_title, d.description, d.dossier_ref, d.dossier_client_name, ...(d.milestone_labels ?? [])],
    needle,
  );
}
