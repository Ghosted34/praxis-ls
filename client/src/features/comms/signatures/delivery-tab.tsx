/**
 * Signatures → Delivery check. "Why is the card not showing in my email?"
 *
 * WHY THIS SCREEN EXISTS AT ALL. The card reaches a recipient through six
 * steps, and when any one of them breaks the symptom is identical: the mail
 * arrives with the text fallback and no image. The send itself SUCCEEDS every
 * time, by design — a signature must never fail a message — so there is no
 * error anywhere for anyone to read. From the outside, "the template is not the
 * card", "Chromium would not launch" and "the storage key is not servable" look
 * exactly the same.
 *
 * That cost three rounds of guessing on real mail, and twice the answer was a
 * one-line difference from code already working elsewhere in this repo. Both
 * were invisible from outside the server and obvious from inside it. So the
 * inside is what this reports.
 *
 * WHY THE FIRST FAILURE IS SINGLED OUT. The steps run in order and later ones
 * depend on earlier ones, so a broken template also fails the render and the
 * storage write. Showing six red rows invites fixing the last one. There is one
 * thing to fix and this names it.
 *
 * WHY "RUN" IS A BUTTON AND NOT AN AUTOLOAD. It launches a browser and does
 * real I/O. That is fine to ask for and wrong to do on every tab switch.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";

/** Plain-language names, so the row reads as a sentence about the product
 *  rather than as an internal step id. */
const STEP_LABEL: Record<string, string> = {
  feature_flag: "Signatures are switched on",
  template: "The card layout is the active one",
  chromium_found: "The image renderer is installed",
  fonts: "The card's fonts are loaded",
  render: "The card image renders",
  storage_key: "The image address is publicly servable",
  storage_write: "The image uploads and can be fetched",
};

/** The detail keys worth showing, in the order they help. Everything else in a
 *  step is diagnostic noise for a person reading a screen. */
const DETAIL_KEYS = [
  "path",
  "kind",
  "dimensions",
  "bytes",
  "loaded",
  "state",
  "url",
  "driver",
];

function Detail({ step }: { step: api.SignatureDiagnosticStep }) {
  const shown = DETAIL_KEYS.filter(
    (k) => step[k] !== undefined && step[k] !== null && step[k] !== "",
  );
  if (!shown.length) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
      {shown.map((k) => (
        <div key={k} className="flex gap-1.5 text-xs">
          <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
          <dd className="break-all font-mono">{String(step[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeliveryTab() {
  const toast = useToast();
  const [report, setReport] = React.useState<api.SignatureDiagnostics | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run(write: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.diagnoseSignature(write);
      setReport(data);
      if (data.ok) toast.success(tr("Every step passed"));
    } catch (err) {
      reportActionError(err);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Callout tone="info" title={tr("What this checks")}>
        {tr(
          "Your signature card is built, rendered and uploaded in six steps. If the image is missing from sent mail, one of them is failing silently — the mail still sends. This runs them in order and names the first one that breaks.",
        )}
      </Callout>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => run(false)}>
          {busy ? tr("Checking…") : tr("Run the check")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => run(true)}>
          {tr("Run and upload a test image")}
        </Button>
        {report && (
          <span className="text-xs text-muted-foreground">
            {tr("Renderer version {v}").replace("{v}", String(report.renderer_version))}
          </span>
        )}
      </div>

      {error && <ErrorState message={error} />}

      {report && (
        <>
          {report.ok ? (
            <Callout tone="ok" title={tr("The card is being delivered")}>
              {tr(
                "Every step passed. If a recipient still sees no image, the block is in their mail client — check that images are not turned off there.",
              )}
            </Callout>
          ) : (
            <Callout tone="bad" title={tr("Fix this step first")}>
              <p className="font-medium">
                {tr(STEP_LABEL[report.first_failure || ""] || report.first_failure || "")}
              </p>
              <p className="mt-1">
                {tr(
                  "The steps below it depend on this one, so they usually fail as a consequence. Fix this and run the check again.",
                )}
              </p>
            </Callout>
          )}

          <ul className="space-y-2">
            {report.steps.map((s) => (
              <li key={s.step} className="lux-card p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Pill tone={s.ok ? "ok" : "bad"}>{s.ok ? tr("pass") : tr("fail")}</Pill>
                  <div className="min-w-[200px] flex-1">
                    <p className="text-sm font-medium">
                      {tr(STEP_LABEL[s.step] || s.step)}
                      {s.step === report.first_failure && (
                        <Pill tone="orange" className="ml-2">{tr("fix first")}</Pill>
                      )}
                    </p>
                    {/* The server's own words. A rephrasing here is a second
                        place for the explanation to go stale. */}
                    {s.why && <p className="mt-1 text-sm text-muted-foreground">{s.why}</p>}
                    <Detail step={s} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default DeliveryTab;
