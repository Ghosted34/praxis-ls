/**
 * The file's delivery progress, as a hook.
 *
 * Its own module, and a `.ts` one, because `react-refresh/only-export-
 * components` is right that a file mixing a hook with a component costs fast
 * refresh — the same split as `lib/record-360.ts` beside
 * `components/record-360.tsx`.
 *
 * An empty id fetches nothing, which is what lets a caller invoke it before the
 * note it belongs to has landed: a hook cannot be called conditionally, and the
 * file is not known until the record is.
 */
import { useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

export function useDeliveryProgress(dossierId: string) {
  return useResource(
    () => (dossierId ? api.deliveryProgress(dossierId) : Promise.resolve(null)),
    [dossierId],
  );
}
