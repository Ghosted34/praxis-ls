/**
 * The LIST's half of a record 360 — how a row opens, and where `?focus=` goes.
 *
 * Split from `components/record-360.tsx` because that file exports components
 * and this exports a hook and two path helpers; `react-refresh/only-export-
 * components` is right that mixing them costs fast refresh, and the same
 * convention already separates `features/operations/shared.ts` from its
 * `components.tsx`.
 *
 * The components that draw a 360 are in `components/record-360.tsx`. The rule
 * the pair implements is doc/FRONTEND_GUIDE.md §3.11.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useIsDesktop } from "@/lib/use-media-query";
import { useRecordParam } from "@/app/layout/nav-trail-context";

/** `<base>/<id>` — the one place the route is spelled. */
export const recordPath = (basePath: string, id: string) =>
  `${basePath}/${encodeURIComponent(id)}`;

/** `<base>?focus=<id>` — the sheet's address, and the deep link every screen
 *  that predates the route already writes. */
export const recordSheetPath = (basePath: string, id: string) =>
  `${basePath}?focus=${encodeURIComponent(id)}`;

/**
 * How a row opens, decided in JavaScript rather than in CSS.
 *
 * `hidden lg:block` is the right tool when both branches are cheap markup and
 * the wrong one here: it would mount the record twice, put a live focus trap in
 * a phone's accessibility tree and give a screen reader two of every heading.
 * `lib/use-media-query.ts` opens with that reasoning. It answers TRUE before
 * `matchMedia` resolves, so the first frame is the desktop branch.
 *
 * `?focus=<id>` means "open this record" wherever it came from — a drill-in from
 * another 360, a notification, the back arrow. On a phone that is the sheet,
 * which `useRecordParam` has already opened; on a desktop it is the page, so the
 * parameter is exchanged for the route with `replace` (nobody navigated to the
 * list-with-a-parameter as a destination, and leaving it in the history puts a
 * flicker between the record and the list on the way back).
 */
export function useRecordOpener<T>(
  basePath: string,
  rows: readonly T[] | null | undefined,
  idOf: (row: T) => string,
): {
  isDesktop: boolean;
  /** Give this to `onRowClick`. */
  openRecord: (row: T) => void;
  /** The record the SHEET should show. Always null on desktop. */
  sheetId: string | null;
  /**
   * The same record as a ROW, once the list holding it has loaded.
   *
   * A sheet that can paint its title on the first frame should — the row is
   * already in hand, and a dialog that opens headless and fills in a moment
   * later reads as a stutter. Detail views that fetch everything by id can
   * ignore this and use `sheetId`.
   */
  sheetRecord: T | null;
  closeSheet: () => void;
} {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { id: focusId, record, open, close } = useRecordParam(rows, idOf);
  const focusParam = params.get("focus");

  React.useEffect(() => {
    if (isDesktop && focusParam)
      navigate(recordPath(basePath, focusParam), { replace: true });
  }, [isDesktop, focusParam, navigate, basePath]);

  const openRecord = React.useCallback(
    (row: T) => {
      if (isDesktop) navigate(recordPath(basePath, idOf(row)));
      // `open` writes `?focus=`, which is what makes the sheet a step the back
      // and forward arrows can reach (app/layout/nav-trail-context.tsx).
      else open(row);
    },
    // `idOf` is an inline arrow at every call site, so it is deliberately not a
    // dependency — same reasoning as useRecordParam's own ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDesktop, navigate, basePath, open],
  );

  return {
    isDesktop,
    openRecord,
    sheetId: isDesktop ? null : focusId,
    sheetRecord: isDesktop ? null : record,
    closeSheet: close,
  };
}
