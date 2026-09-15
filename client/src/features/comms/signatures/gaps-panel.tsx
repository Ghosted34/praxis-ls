/**
 * "Your signature is missing X" — and a link straight to the field that fills it.
 *
 * WHY THIS EARNS ITS SPACE. Nearly every field on the card is derived, which is
 * the right design and has one cost: the person looking at the blank is often
 * not the person who can fill it, and has no idea which of five screens owns
 * it. The old copy said company details "come from your company profile" —
 * true, and useless when the P.O. Box is a dozen inputs down a form on a tab of
 * a dossier they have never opened.
 *
 * TWO KINDS OF ROW, and the difference matters. A gap the reader can act on is
 * a link. A gap they cannot is a sentence naming who to ask. Offering everyone
 * a link into a page that will refuse them teaches people the product is
 * broken; naming the owner turns a dead end into a next step.
 *
 * The server decides which is which (`signature.gaps.js` + `readPermissions`),
 * because the grants live there. This component only renders the answer.
 */
import { Link } from "react-router-dom";
import { Callout } from "@/components/ui/callout";
import { tr } from "@/lib/i18n";
import type { SignatureGap } from "@/lib/mail-api";

export function GapsPanel({ gaps }: { gaps: SignatureGap[] }) {
  if (!gaps.length) return null;

  const mine = gaps.filter((g) => g.scope === "self");
  const others = gaps.filter((g) => g.scope !== "self");

  return (
    <Callout tone="warn" title={tr("Some details are missing")}>
      <p className="mb-2">
        {tr(
          "Your signature renders without these. Each one links to where it is filled in.",
        )}
      </p>

      <ul className="space-y-1.5">
        {/* The caller's own first: it is the half they can finish now. */}
        {[...mine, ...others].map((g) => (
          <li key={g.key} className="text-sm">
            {g.href ? (
              <Link className="font-medium underline" to={g.href}>
                {tr(g.label)}
              </Link>
            ) : (
              <span className="font-medium">{tr(g.label)}</span>
            )}
            <span className="text-muted-foreground">
              {" — "}
              {g.actionable
                ? tr(g.hint)
                : tr("Ask {owner}.").replace("{owner}", tr(g.owner))}
            </span>
            {/*
              NO LINK, SO SAY WHERE IT LIVES.
              A gap without an href is one of two things: not the reader's to
              fix, or a field we cannot land them on. Either way the answer to
              "so where IS it?" is a path, and printing it costs nothing and
              beats a link that drops them on a list to search. This is the
              other half of the rule that a link either reaches the control or
              is not offered.
            */}
            {!g.href && g.where && (
              <span className="micro block text-muted-foreground">{g.where}</span>
            )}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

export default GapsPanel;
