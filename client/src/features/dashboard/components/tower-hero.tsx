/**
 * Control Tower hero — greeting, headline, standing brief, two primary actions.
 *
 * The headline mirrors the DATA ENVIRONMENT. The mock hardcoded "Your network,
 * live." — which is a lie in TEST mode, where every figure on this page comes
 * from the sandbox schema. The accent word carries that, and takes the warning
 * colour in TEST so the page reads differently at a glance, matching the shell's
 * sandbox banner.
 *
 * `<h1>` lives here, and it is the page's only one (audit F13: ~116 of 117 pages
 * had none at all).
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { greeting } from "../model";

export function TowerHero({
  firstName,
  activeFiles,
  approvals,
  isTest,
}: {
  firstName: string;
  activeFiles: number;
  approvals: number;
  isTest: boolean;
}) {
  const navigate = useNavigate();
  // Computed once per mount: an operator who leaves the tower open across noon
  // does not need the greeting to change under them, and re-rendering on a timer
  // would be motion for its own sake.
  const hello = React.useMemo(
    () => greeting(new Date(), firstName),
    [firstName],
  );

  const subline =
    `${activeFiles} operations file${activeFiles === 1 ? "" : "s"} in motion` +
    (approvals ? ` — ${approvals} awaiting your approval.` : ".");

  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{hello}</p>
        {/*
          A deliberate exception to the type scale. The scale's `h1` (28px) is
          the right size for a page title inside a hub; this is the product's
          front door and the one place a larger optical size earns its keep. It
          is one call site, not the nineteen ad-hoc sizes F14 counted.
        */}
        <h1 className="font-display mt-1 text-[clamp(1.75rem,3.2vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
          Your network,{" "}
          <span
            className={cn(
              "not-italic",
              isTest ? "text-[rgb(var(--warn))]" : "text-primary-ink",
            )}
          >
            {isTest ? "test" : "live"}
          </span>
          .
        </h1>
        <p className="mt-2 max-w-[52ch] text-base text-muted-foreground">
          {subline}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate("/operations/files")}>
          New operations file
        </Button>
        <Button variant="outline" onClick={() => navigate("/finance/invoices")}>
          New invoice
        </Button>
      </div>
    </header>
  );
}
