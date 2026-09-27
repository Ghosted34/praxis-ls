import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { en } from "@/lib/i18n-dict";
import { ContactPage } from "./contact-page";

afterEach(() => vi.unstubAllGlobals());

it("keeps larger, brand-styled promises beside the form on desktop only", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ data: {} }), {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  const { container } = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={["/public/contact"]}>
        <ContactPage />
      </MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const promises = container.querySelector("dl")!;
  expect(promises).toHaveClass(
    "lg:sticky",
    "lg:top-[var(--sticky-top)]",
    "lg:self-start",
  );
  expect(promises).not.toHaveClass("sticky");
  expect(promises.parentElement).toContainElement(container.querySelector("form"));

  for (const item of en.site.contact.promise) {
    // The shared eyebrow recipe supplies the display font, uppercase and
    // tenant's contrast-safe brand ink; only its size is increased here.
    expect(screen.getByText(item.t)).toHaveClass("eyebrow", "text-lg");
    expect(screen.getByText(item.d)).toHaveClass("text-base");
  }
});
