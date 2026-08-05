/**
 * What a direct URL into a module you cannot see looks like.
 *
 * THE RIBBON HIDING IT IS NOT ENOUGH. A destination is hidden from the ribbon,
 * the rail, the palette and the launcher, and it is still one bookmark, one
 * pasted Slack link or one browser autocomplete away. Before this, that path
 * rendered the screen, which fired its reads, which 403'd, which left the user
 * looking at an error state written for a network failure — or, on the screens
 * whose loaders swallow a 403, at an empty table that says the business has no
 * invoices. Both are worse than a refusal, because both invite the user to
 * conclude the product is broken.
 *
 * ── THE HARD BOUNDARY ────────────────────────────────────────────────────────
 *
 * This page is friendly. The API is not, and nothing here softens it.
 *
 * The page NAMES the module and says what it is for. It does that from
 * `screen-registry.json` — a static file compiled into the bundle, which every
 * user already has in full — so the friendliness costs nothing: there is no
 * request, no payload, and no way for this surface to become one. Advertising
 * that Finance exists is deliberate ("ask an administrator for Finance" is
 * actionable; "something went wrong" is not). Showing a single figure from it
 * would not be, and cannot happen here, because the screen that would fetch one
 * is never mounted — the gate in `app-shell.tsx` renders THIS instead of the
 * `<Outlet/>`, so the reads never start.
 *
 * The server is unchanged and stays unchanged: `requirePermission` still answers
 * 403 `PERMISSION_DENIED` with an error envelope and no data, whatever this page
 * says. `tests/unit/no-access-boundary.test.js` asserts that against the real
 * middleware chain, on the body rather than the status.
 *
 * ── "REQUEST ACCESS" ─────────────────────────────────────────────────────────
 *
 * A real support ticket (`POST /support/tickets`), not a mailto and not a new
 * endpoint. That API is already the tenant's "reach a human" channel, it is
 * ungated by design ("reaching Praxis for help must never be switched off" —
 * support.routes.js), and it has a lifecycle somebody actually watches. Its
 * free-form `context` object carries the module key and the path, so whoever
 * triages it knows what to grant without a round of questions.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { pageShell } from "@/lib/layout";
import { tenant } from "@/lib/api-client";
import { screensForModule } from "@/app/screen-registry";
import { AREAS } from "@/app/layout/areas";
import { SecurityIcon } from "@/app/layout/nav-icons";

/**
 * What we can honestly say about a module, from the static registry alone.
 *
 * The catalogue's own name for a module lives in `platform.module_catalogue`
 * and is served by `GET /catalogue/modules`, which is MOD-67 gated — so the one
 * user who most needs this page is precisely the user who cannot read it. The
 * registry is the answer: it maps every module to the screens it gates, and a
 * screen's `title` and `purpose` are the user-facing description of what the
 * module DOES, which is what the page has to say.
 */
function describe(moduleKey: string): { title: string; purpose: string; screens: string[] } {
  const screens = screensForModule(moduleKey);

  // The area MOST of this module's screens live in. Most rather than first,
  // because several modules span two — MOD-07 gates the Tax center under
  // Finance and a handful of Settings editors — and naming the minority one
  // sends the user looking in the wrong place. AREAS order breaks a tie, so the
  // answer does not depend on registry ordering.
  let area: (typeof AREAS)[number] | undefined;
  let best = 0;
  for (const a of AREAS) {
    if (!a.basePath) continue;
    const n = screens.filter((s) => s.route === a.basePath || s.route.startsWith(a.basePath + "/")).length;
    if (n > best) {
      best = n;
      area = a;
    }
  }

  return {
    // The area reads better than a screen title when a module gates several
    // ("Finance" rather than "Invoices"), and the screen title is the right
    // answer when it gates one. Falling back to the raw key is deliberate: a
    // module with no screen in this client is a real state, and "MOD-73" is a
    // more useful thing to quote to an administrator than "this area".
    title: area?.label ?? screens[0]?.title ?? moduleKey,
    purpose: screens[0]?.purpose ?? "This part of the workspace is restricted.",
    screens: screens.map((s) => s.title),
  };
}

export function NoAccessPage({ moduleKey, pathname }: { moduleKey: string; pathname: string }) {
  const { title, purpose, screens } = describe(moduleKey);
  const [state, setState] = React.useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function requestAccess() {
    setState("sending");
    try {
      await tenant("/support/tickets", {
        method: "POST",
        body: {
          kind: "SUPPORT",
          title: `Access request: ${title} (${moduleKey})`,
          body:
            `I tried to open ${pathname} and do not have access to ${title} (${moduleKey}).\n` +
            `Please review my role's grant for this module.`,
          // The breadcrumb the API's `context` field exists for. Whoever triages
          // this needs the module key, not a prose paraphrase of it.
          context: { reason: "access_request", module_key: moduleKey, route: pathname },
        },
      });
      setState("sent");
    } catch {
      // Deliberately not an ErrorState: the page itself loaded fine, and
      // replacing it with an error would take away the one thing the user came
      // here to read. The ticket API is also the fallback path for "something
      // is wrong", so telling them to use Support when Support is what failed
      // needs to be honest about it.
      setState("failed");
    }
  }

  return (
    <section className={pageShell.reading}>
      <div className="lux-card p-8">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[rgb(var(--ink)_/_0.05)] text-muted-foreground">
          <SecurityIcon width={20} height={20} />
        </span>

        <h1 className="mt-5 font-display text-2xl tracking-tight">{title} is not part of your access</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{purpose}</p>

        {screens.length > 1 && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            It covers {screens.slice(0, -1).join(", ")} and {screens[screens.length - 1]}.
          </p>
        )}

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Your role does not include{" "}
          <span className="font-mono text-xs text-foreground">{moduleKey}</span>, so this page has nothing from it to
          show you — not a summary, not a count. If you need it for your work, ask for it and an administrator can
          grant it.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button onClick={requestAccess} loading={state === "sending"} disabled={state === "sent"}>
            {state === "sent" ? "Request sent" : "Request access"}
          </Button>
          <Button variant="outline" icon={null} onClick={() => window.history.back()}>
            Go back
          </Button>
          <Link to="/" className="rounded-sm px-2 text-sm font-semibold text-primary-ink hover:underline">
            Control Tower
          </Link>
        </div>

        {state === "sent" && (
          <Callout tone="ok" className="mt-5" title="Request sent.">
            It is on the support queue as an access request for {title}. You can follow it under Support &amp;
            feedback.
          </Callout>
        )}
        {state === "failed" && (
          <Callout tone="bad" className="mt-5" title="That request did not send.">
            Ask an administrator for {title} ({moduleKey}) directly, or try again from Support &amp; feedback.
          </Callout>
        )}
      </div>
    </section>
  );
}

export default NoAccessPage;
