/**
 * Run the advisory guardrail check whenever the draft settles.
 *
 * ── WHY THIS IS NOT IN guardrails.tsx ───────────────────────────────────────
 *
 * A module that exports both a component and a hook loses fast refresh for the
 * component (`react-refresh/only-export-components`). That is a warning here
 * rather than an error, but `npm run lint` runs under `--max-warnings 112` and
 * that budget is a ratchet — it exists so the count comes down, not so new work
 * can spend the headroom old work left behind.
 *
 * ── DEBOUNCED, BECAUSE IT FIRES ON EVERY KEYSTROKE ──────────────────────────
 *
 * The check reads the thread's verdict server-side, so running it per character
 * is a request per character. 600 ms is roughly "stopped typing" without being
 * long enough for the bar to arrive after the send button was pressed.
 *
 * ── WHY THE INPUT GOES THROUGH A REF ────────────────────────────────────────
 *
 * The effect must re-run when the draft's CONTENT settles, not when React hands
 * it a new array. `to` and `attachments` are fresh references on every render,
 * so listing them as dependencies re-runs the effect — and restarts the 600 ms
 * timer — on every render whether or not anything changed, which means the
 * check never fires while anyone is typing.
 *
 * `key` collapses the inputs into the value the effect actually depends on. The
 * body then reads the LATEST inputs out of a ref rather than closing over the
 * render they came from, so the request carries what is on screen at the moment
 * it goes out. That is both the correct behaviour and why the dependency array
 * is honest rather than suppressed: the effect genuinely does not depend on
 * those four values, only on `key`.
 *
 * ── A FAILED CHECK IS NOT A PASSED CHECK ────────────────────────────────────
 *
 * On error the result is CLEARED, never left showing the previous verdict and
 * never synthesised into an "all clear". It also never blocks the composer: the
 * server runs the authoritative check at send, and this is advice on the way
 * there.
 */
import * as React from "react";
import * as api from "@/lib/mail-api";

export type GuardrailInput = {
  enabled: boolean;
  html: string;
  subject: string;
  to: string[];
  attachments: { filename?: string }[];
};

export function useGuardrails(input: GuardrailInput) {
  const [result, setResult] = React.useState<api.GuardrailResult | null>(null);

  // The latest inputs, read inside the effect. See the header.
  const latest = React.useRef(input);
  latest.current = input;

  const { enabled, html, subject, to, attachments } = input;
  const key = `${html.length}|${subject}|${to.join(",")}|${attachments.length}`;

  React.useEffect(() => {
    const now = latest.current;
    if (!enabled || (!now.html.trim() && !now.subject.trim())) {
      setResult(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const cur = latest.current;
      api
        .assistGuardrails({
          html: cur.html,
          subject: cur.subject,
          to: cur.to,
          attachments: cur.attachments,
          htmlBytes: new Blob([cur.html]).size,
        })
        .then((r) => {
          if (live) setResult(r);
        })
        .catch(() => {
          if (live) setResult(null);
        });
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [enabled, key]);

  return result;
}
