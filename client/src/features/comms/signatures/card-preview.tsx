/**
 * The card preview.
 *
 * WHY AN IFRAME, AND NOT A REACT COMPONENT. The card is drawn by the server
 * (`signature.card.js`) because the server is what screenshots it into the PNG
 * that recipients see. Re-implementing that layout in JSX would create a second
 * definition of the card that looks right until someone changes one of them,
 * and the failure mode is silent: the preview a person approves and the image
 * that goes out stop being the same picture.
 *
 * So the preview renders the exact document the renderer screenshots. The
 * iframe is what makes that safe — the card's stylesheet uses bare, generic
 * selectors (`.card`, `.person-name`, `.contact-item`) that would collide with
 * the app's own the moment they shared a document.
 *
 * `sandbox` with no allow-* tokens: the document is ours, but it carries a
 * tenant-supplied motto and a tenant-supplied logo, and there is no reason for
 * a preview to be able to run script or navigate anything.
 */
import { SkeletonTable } from "@/components/ui/skeleton";
import { tr } from "@/lib/i18n";

export function CardPreview({
  document: doc,
  width,
  height,
  loading = false,
  /** Shrink to fit narrow columns. The card is a fixed 650 × 325. */
  scale = 1,
}: {
  document: string | null;
  width: number;
  height: number;
  loading?: boolean;
  scale?: number;
}) {
  if (loading) return <SkeletonTable />;
  if (!doc) {
    return (
      <p className="text-sm text-muted-foreground">
        {tr("No signature to preview yet.")}
      </p>
    );
  }

  return (
    <div
      className="overflow-hidden"
      style={{ width: width * scale, height: height * scale }}
    >
      <iframe
        title={tr("Email signature preview")}
        srcDoc={doc}
        sandbox=""
        scrolling="no"
        width={width}
        height={height}
        style={{
          border: 0,
          // Scale rather than resize: the card's geometry is fixed, so laying it
          // out at another width would not shrink it, it would clip it.
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
          display: "block",
        }}
      />
    </div>
  );
}

export default CardPreview;
