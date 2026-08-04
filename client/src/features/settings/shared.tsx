/**
 * Settings — the inline error banner every config screen shows above its list.
 *
 * Split out of `features/settings/config-pages.tsx` (1,088 lines) in Phase 4,
 * audit F7 — and deduplicated while doing it: `store-pages.tsx` carried a
 * byte-identical second copy, which is F6's pattern in its smallest form.
 */

import { ErrorState } from "@/components/ui/states";

export function PageError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-3">
      <ErrorState message={message} />
    </div>
  );
}

/* ───────────────────────── Bank accounts ───────────────────────── */
