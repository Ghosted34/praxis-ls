import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Every test here renders a page that a stranger reaches with no session, so
 * the harness must not accidentally provide one: `lib/api.ts` reads no token
 * store and no `X-Praxis-Env` header, and nothing in these tests seeds either.
 *
 * fetch itself is stubbed per test (vi.stubGlobal) rather than by a global mock,
 * so a request nobody declared fails loudly instead of returning `undefined`.
 */
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});
