/**
 * `<ConfigMissingCallout>` — the rendering for a `CONFIG_MISSING` (424) error.
 *
 * The server throws:
 *
 *     throw new AppError("CONFIG_MISSING", "SMTP host is not set", 424, {
 *       setting_key: "smtp.host",
 *       settings_route: "/settings/email",
 *       feature: "Email sending",
 *     });
 *
 * The `ApiError` reaches the UI carrying those three fields on `.fields`. This
 * callout renders the message together with a live link to `settings_route`,
 * so the user sees a path forward instead of the generic "something went
 * wrong" they used to see behind a hidden `NOT_CONFIGURED` code.
 *
 * These errors deliberately never reach the error monitor (see
 * doc/ERROR_HANDLING.md class G). They are unfinished setup, not code faults,
 * and mixing them into `error_event` degrades the monitor's signal until
 * people stop reading it.
 */
import { Link } from "react-router-dom";
import { Callout } from "@/components/ui/callout";
import { ApiError } from "@/lib/api-client";

type ConfigMissingFields = {
  setting_key?: string;
  settings_route?: string;
  feature?: string;
};

function readFields(error: unknown): ConfigMissingFields | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== "CONFIG_MISSING") return null;
  const f = error.fields as unknown;
  if (!f || typeof f !== "object") return {};
  return f as ConfigMissingFields;
}

export function isConfigMissing(error: unknown): boolean {
  return readFields(error) !== null;
}

export function ConfigMissingCallout({
  error,
  className,
}: {
  /** Any thrown value; renders nothing unless it is a CONFIG_MISSING ApiError. */
  error: unknown;
  className?: string;
}) {
  const fields = readFields(error);
  if (!fields) return null;
  const err = error as ApiError;
  const feature = fields.feature || "This feature";
  const route = fields.settings_route;

  return (
    <Callout
      tone="warn"
      title={`${feature} needs setup`}
      className={className}
      action={
        route ? (
          <Link
            to={route}
            className="text-xs font-semibold underline underline-offset-2"
          >
            Open settings →
          </Link>
        ) : undefined
      }
    >
      {err.message}
    </Callout>
  );
}
