/**
 * Screen harness — render a real routed screen in a test, with its data faked.
 *
 * WHY (Phase 4 validation: "Per-area a11y gate (axe, zero violations)").
 *
 * Everything the client tested before this was a PRIMITIVE. That is the right
 * place to start — `Field`'s label association fixes 565 call sites at once —
 * but it cannot see the defects that only exist once a screen is assembled: a
 * page with two `<h1>`s, a table whose action column has no accessible name, an
 * empty state that renders nothing at all, a loading branch that returns a bare
 * string. Those are exactly the per-screen checklist items in Phase 4, and none
 * of them are visible from a primitive's own test.
 *
 * It is also the only way to check the states honestly. A screen has four —
 * loading, error, empty, populated — and the audit found screens that had one
 * (F10: 28 ad-hoc "Loading…" strings; F11: 11 screens with no empty state at
 * all). Asserting "this screen renders" against a happy path would have passed
 * on every one of them.
 *
 * WHAT IT FAKES, and why that is enough. Screens reach the network through
 * exactly two places — `tenant()` / `tenantPaged()` in `lib/api-client`, and the
 * typed `lib/*-api` wrappers that themselves call `tenant()`. Faking the client
 * covers both, so a screen under test runs its REAL hooks, its REAL derivation
 * and filtering, and its REAL render tree. Nothing about the component is
 * stubbed; only the socket is.
 *
 * @example
 * vi.mock("@/lib/api-client", async () => apiClientMock());
 *
 * const { container } = renderScreen(<InvoicesPage />, {
 *   routes: { "/final-invoices": [{ invoice_id: "1", doc_number: "INV-1" }] },
 * });
 * expect(await axe(container)).toHaveNoViolations();
 */
import * as React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

/** What a faked endpoint returns: a payload, or a thrown ApiError. */
export type RouteFixture = unknown | { __error: { status: number; message: string; code?: string } };

export type ScreenFixtures = {
  /**
   * path → payload. Matched by longest-prefix on the path WITHOUT its query
   * string, so `"/clients"` serves `/clients?limit=50` too. A path with no entry
   * resolves to `[]` rather than throwing: an unmocked lookup should leave the
   * screen empty, not crash the test with a message about the harness.
   */
  routes?: Record<string, RouteFixture>;
  /** Never resolve, so the screen stays in its loading branch. */
  pending?: boolean;
  /** The route the MemoryRouter starts on, when the screen reads params. */
  path?: string;
  /** Route pattern, when the screen uses `useParams`. */
  pattern?: string;
};

/** Build the ApiError shape screens branch on, without importing the real class. */
export function apiError(status: number, message: string, code = "ERROR") {
  return { __error: { status, message, code } };
}

function isErrorFixture(v: unknown): v is { __error: { status: number; message: string; code?: string } } {
  return !!v && typeof v === "object" && "__error" in (v as Record<string, unknown>);
}

/**
 * Resolve a request path against the fixtures.
 *
 * Longest-prefix rather than exact match because screens build paths with query
 * strings and ids (`/operations/${id}/milestones`), and a fixture map that had
 * to enumerate every one would be a test of the harness rather than the screen.
 */
export function resolveFixture(path: string, routes: Record<string, RouteFixture>): RouteFixture {
  const bare = path.split("?")[0];
  let best: string | null = null;
  for (const key of Object.keys(routes)) {
    if ((bare === key || bare.startsWith(key)) && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? [] : routes[best];
}

/**
 * Install the api-client fake. Call at MODULE level in the test file — `vi.mock`
 * is hoisted above imports, so it cannot be called from inside a test body.
 *
 * The fixture map is read at call time from a mutable holder, which is what lets
 * one mock serve every state a screen has.
 */
export const fixtures: { current: ScreenFixtures } = { current: {} };

/**
 * The api-client replacement. Pass it to `vi.mock` AT THE TOP LEVEL of a test
 * file — `vi.mock` is hoisted above imports, so it cannot be wrapped in a helper
 * that the test file calls. (It "worked" wrapped, because hoisting moved it, but
 * Vitest warns that the apparent order is a lie and will make it an error.)
 *
 *   vi.mock("@/lib/api-client", async () => apiClientMock());
 *
 * The fixture map is read at CALL time from `fixtures.current`, which is what
 * lets one mock serve all four states of every screen.
 */
export async function apiClientMock() {
  const { vi } = await import("vitest");
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");

  async function fake(path: string) {
    const f = fixtures.current;
    if (f.pending) return new Promise(() => {}); // never settles — the loading branch
    const hit = resolveFixture(path, f.routes ?? {});
    if (isErrorFixture(hit)) {
      throw new actual.ApiError(hit.__error.code ?? "ERROR", hit.__error.message, hit.__error.status);
    }
    return hit;
  }

  return {
    ...actual,
    api: (p: string) => fake(p),
    tenant: (p: string) => fake(p),
    platform: (p: string) => fake(p),
    tenantPaged: async (p: string) => ({ data: await fake(p), total: null }),
    apiPaged: async (p: string) => ({ data: await fake(p), total: null }),
    download: async () => {},
    tenantDownload: async () => {},
  };
}

/**
 * The auth-context replacement, for the same reason and with the same rule as
 * `apiClientMock`: pass it to `vi.mock` at the TOP LEVEL of a test file.
 *
 *   vi.mock("@/app/auth/auth-context", async () => authContextMock());
 *
 * Screens rarely read auth directly — five files in the tree do — but almost all
 * of them import `AiActions`, whose `useAiEnabled()` calls `useAuth()`. Without
 * this, every screen in the register throws "useAuth must be used within
 * AuthProvider" before rendering a single row.
 *
 * `ai_enabled: true` is deliberate: it renders the AI panels, so they are inside
 * the axe scan rather than gated out of it. A gate that skips a surface is a
 * gate that will eventually be told that surface is clean.
 */
export async function authContextMock(user: Record<string, unknown> = {}) {
  const { vi } = await import("vitest");
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>("@/app/auth/auth-context");
  const noop = async () => {};
  return {
    ...actual,
    useAuth: () => ({
      user: { user_id: "u-test", full_name: "Test Operator", email: "test@example.test", ai_enabled: true, channels: { comms: true }, ...user },
      status: "authed" as const,
      pendingToken: null,
      login: async () => ({ pending2fa: false }),
      verify2fa: noop,
      pinLogin: noop,
      registerPin: async () => ({ device_id: "d1" }),
      logout: noop,
      patchUser: () => {},
    }),
  };
}

/**
 * A QueryClient with retries and background refetching off.
 *
 * `retry: false` matters for the error state: with the app's `retry: 1` a failing
 * query resolves its error one tick later than the test expects, which reads as
 * a flake rather than as the setting it is.
 */
function testQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderScreen(ui: React.ReactElement, f: ScreenFixtures = {}): RenderResult {
  fixtures.current = f;
  const client = testQueryClient();
  const at = f.path ?? "/";

  /**
   * THE APP'S ROOT PROVIDERS, not just the router and the query client.
   *
   * `main.tsx` mounts ToastProvider and TooltipProvider above every screen, and
   * `useToast()` throws by design when it cannot find its provider — a good
   * design, because a toast that silently goes nowhere is worse than a crash.
   * The harness did not have them, so the first screen to announce a successful
   * save (the journal-entry form, migrated to `<Form>`) took down all four of
   * its state assertions with "useToast must be used inside <ToastProvider>".
   *
   * This is Addendum 5's shape again: the only path that exercised the harness
   * was the only path that could not see what it was missing. Fixed here rather
   * than by avoiding `useToast` in the form, because every form migrated after
   * this one will want to confirm that it saved.
   */
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[at]}>
            {f.pattern ? (
              <Routes>
                <Route path={f.pattern} element={ui} />
              </Routes>
            ) : (
              ui
            )}
          </MemoryRouter>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
