/**
 * ScreenError — the one thing a wired screen renders when its fetch failed.
 *
 * WHY IT REPLACES A BARE `<ErrorState message={error} />`. `useList` hands back
 * a formatted string and every screen printed it in a red box, which meant a
 * permission refusal, a validation failure, a server bug and a dead wifi all
 * produced the same four words and the same dead end. Only one of those four is
 * fixed by waiting, and it is by far the most common.
 *
 * The dispatch reads the GLOBAL connection state rather than sniffing the
 * message text, and that is deliberate: the api-client sets that state from the
 * very failure that produced this error (`lib/api-client.ts` → `send`), so the
 * two cannot disagree, and no call site has to thread a flag through to get it
 * right. Screens keep passing the string they already had.
 *
 * @example  // the whole migration, per screen
 * - {error ? <ErrorState message={error} /> : <DataTable …/>}
 * + {error ? <ScreenError message={error} what="Corporate entities" onRetry={reload} /> : <DataTable …/>}
 */
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { useConnection, useRetryOnReconnect } from "@/lib/connection";
import { ConnectionLost } from "./connection-lost";

export function ScreenError({
  message,
  onRetry,
  /** What failed to load, for the offline copy: "Corporate entities". */
  what,
  className,
}: {
  message: string;
  onRetry?: () => void;
  what?: string;
  className?: string;
}) {
  const { status } = useConnection();

  // Declared HERE, above the branch, so it survives the switch back to the
  // populated screen. See `useRetryOnReconnect` — putting it inside
  // `ConnectionLost` means it never fires, because that component unmounts on
  // the very transition it is waiting for.
  useRetryOnReconnect(onRetry);

  if (status === "unreachable") {
    return (
      // `autoRetry={false}`: the hook above owns the recovery. Leaving it on
      // here as well registers a second reconnect listener and refetches every
      // screen twice.
      <ConnectionLost
        onRetry={onRetry}
        what={what}
        autoRetry={false}
        className={className}
      />
    );
  }

  // The server answered and said no. That is a real message about a real
  // decision — permission, validation, a closed period — and it must be shown
  // as-is. Dressing it up as a connection problem would send the user to fix
  // their wifi over our 403.
  return (
    <ErrorState
      message={message}
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}
