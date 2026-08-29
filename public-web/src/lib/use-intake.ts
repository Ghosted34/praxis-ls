import * as React from "react";
import { PublicApiError } from "./api";
import { tStatic } from "./i18n";
import { fieldErrorsOf, type Trap } from "./intake-api";

/**
 * The state every intake form shares: a busy flag, one error line, per-field
 * errors from the server's 422, a honeypot, and the timestamp that makes the
 * honeypot's partner work.
 *
 * ── WHY THE TIMESTAMP IS IN THE HOOK AND NOT IN EACH FORM ─────────────────
 *
 * `public_intake.validator.js` refuses any submission that arrives under
 * 1500 ms after `form_started_at` (`SPAM_REJECTED`). A form that omits the field
 * is not spared — it just stops being a form a bot can win at, which pushes the
 * spam onto the 5-per-hour rate limit, which is per-connection, which means the
 * first scraper of the day uses up the whole office's quota. Stamping mount time
 * is one line here and cannot be forgotten in four places.
 *
 * The same argument for `website_url`: it must be SENT, as an empty string, so a
 * bot that fills every field it finds gets a `max(0)` failure. An omitted key
 * passes; a filled key fails. Hence `honeypot` in state, not a discarded input.
 *
 * On success the payload the server hands back (`{ received, reference }`) is
 * surfaced, because a quote reference is the one thing that lets a client chase
 * their request by phone instead of by hope.
 */
export type IntakeState<T> = {
  busy: boolean;
  error: string | null;
  fields: Record<string, string>;
  result: T | null;
  honeypot: string;
  setHoneypot: (v: string) => void;
  startedAt: number;
  submit: (body: object) => Promise<T | null>;
  reset: () => void;
};

export function useIntake<T = { received: boolean; reference: string }>(opts: {
  send: (body: object, startedAt: number) => Promise<T>;
  /** A 429 has its own sentence — "try again later" beats "something went wrong"
   *  when the reader is the twelfth person at their desk to try. */
  onRateLimited?: string;
  onFailed?: string;
}): IntakeState<T> {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<T | null>(null);
  const [honeypot, setHoneypot] = React.useState("");
  // The mount time, once. `Date.now()` at submit would always be 0 and the trap
  // would refuse every real submission.
  const startedAt = React.useRef(Date.now()).current;
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sendRef = React.useRef(opts.send);
  sendRef.current = opts.send;

  async function submit(body: object): Promise<T | null> {
    setBusy(true);
    setError(null);
    setFields({});
    const trap: Trap = {
      website_url: (honeypot || "") as "",
      form_started_at: startedAt,
    };
    try {
      const r = await sendRef.current({ ...body, ...trap }, startedAt);
      if (mounted.current) setResult(r);
      return r;
    } catch (e) {
      if (mounted.current) {
        setFields(fieldErrorsOf(e));
        setError(
          e instanceof PublicApiError && e.isRateLimited
            ? opts.onRateLimited || tStatic("errors.intakeRateLimited")
            : opts.onFailed || tStatic("errors.generic"),
        );
      }
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setFields({});
  }

  return {
    busy,
    error,
    fields,
    result,
    honeypot,
    setHoneypot,
    startedAt,
    submit,
    reset,
  };
}
