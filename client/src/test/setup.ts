/**
 * Vitest setup — runs before every test file.
 *
 * Registers jest-dom matchers (toBeInTheDocument, toHaveAccessibleName, …) and
 * jest-axe's toHaveNoViolations, so any component test can assert accessibility
 * without extra wiring. That is deliberate: the audit's a11y findings (F13) are
 * only permanently fixed if a regression fails the build.
 */
import "@testing-library/jest-dom/vitest";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});
