/**
 * The two data environments, named once, apart from the controls that switch
 * between them (env-switcher.tsx).
 *
 * Split out for the same reason calendar/dates.ts is: a file that exports a
 * component AND a helper cannot be hot-swapped by Fast Refresh, so a padding
 * tweak on the toggle would cost the whole shell its state — and the client
 * lint budget counts every such export against us. These three are also the
 * part a test can import without dragging React in.
 */
export type Env = "live" | "sandbox";

/** The env is a plain string in `tokenStore` and in shell state, and anything
 *  that is not the sandbox is live — the same reading the toggle has always
 *  done inline (`env !== "sandbox"`). */
export const asEnv = (env: string): Env => (env === "sandbox" ? "sandbox" : "live");

/** The other one. Two environments, so "switch" has exactly one destination. */
export const otherEnv = (env: Env): Env => (env === "sandbox" ? "live" : "sandbox");

export const ENV_LABEL: Record<Env, string> = { live: "LIVE", sandbox: "TEST" };
