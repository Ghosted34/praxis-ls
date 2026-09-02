/**
 * FontPicker — the control that replaced three free-text CSS boxes.
 *
 * What is worth asserting is what the free-text box could not do: show you the
 * typeface you are choosing, keep the choice inside a set that is guaranteed to
 * render, and never quietly rewrite a value that was already there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { FontPicker } from "./font-picker";
import { FONTS, __resetFontCache } from "@/lib/fonts";

// The real loaders import @fontsource CSS. jsdom neither parses nor applies it,
// and pulling fifteen stylesheets per test would only measure Vite. Stubbing
// them keeps these cases about the control's behaviour.
// mockClear matters: vi.spyOn returns the SAME spy when the method is already
// spied, so without it call counts accumulate across cases and the
// "loads once per mount" assertion below measures the whole file.
beforeEach(() => {
  __resetFontCache();
  for (const f of FONTS)
    vi.spyOn(f, "load").mockClear().mockResolvedValue(undefined);
});

const montserrat = FONTS.find((f) => f.id === "montserrat")!;

function setup(value = "", onChange = vi.fn()) {
  render(
    <FontPicker
      slot="body"
      value={value}
      onChange={onChange}
      aria-label="Body font"
    />,
  );
  return { onChange };
}

describe("FontPicker", () => {
  /**
   * THE POINT OF THE CONTROL. "Merriweather" set in Merriweather tells you what
   * you are picking; set in the UI font it tells you nothing. If this assertion
   * ever fails, the picker has degraded into a styled version of the text box
   * it was built to replace.
   */
  it("renders every font name in its own typeface", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("combobox", { name: "Body font" }));

    const listbox = await screen.findByRole("listbox");
    for (const font of FONTS) {
      const option = within(listbox).getByText(font.name);
      expect(option).toHaveStyle({ fontFamily: font.stack });
    }
  });

  it("offers the whole library, grouped by kind", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("combobox", { name: "Body font" }));

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(16);
    for (const heading of ["Sans-serif", "Serif", "Monospace", "Script"]) {
      expect(within(listbox).getByText(heading)).toBeInTheDocument();
    }
  });

  /** The persisted value is the CSS stack, not the id — that is the storage
   *  contract branding.service.js already had, and it is why this change needed
   *  no data migration. */
  it("emits the CSS stack, not the id", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("combobox", { name: "Body font" }));
    await user.click(await screen.findByRole("option", { name: /Montserrat/ }));

    expect(onChange).toHaveBeenCalledWith(montserrat.stack);
  });

  it("shows the current family as the selection", () => {
    setup(montserrat.stack);
    expect(
      screen.getByRole("combobox", { name: "Body font" }),
    ).toHaveTextContent("Montserrat");
  });

  /**
   * The legacy free-text value from before this library existed. It must read
   * back as the family the tenant meant, not as "Custom" — otherwise every
   * tenant who had configured type sees their setting apparently lost.
   */
  it("recognises a hand-typed legacy stack", () => {
    setup('"Montserrat", Georgia, serif');
    expect(
      screen.getByRole("combobox", { name: "Body font" }),
    ).toHaveTextContent("Montserrat");
  });

  /**
   * A genuinely custom stack — a tenant self-hosting a licensed corporate face
   * — must not be silently normalised to a library font the moment someone
   * opens the screen. Opening a settings page should never change a setting.
   */
  it("keeps a custom stack, shows it as Custom, and does not rewrite it", async () => {
    const onChange = vi.fn();
    setup('"Acme Grotesk", sans-serif', onChange);

    expect(
      screen.getByRole("combobox", { name: "Body font" }),
    ).toHaveTextContent("Custom");
    expect(onChange).not.toHaveBeenCalled();
    // The escape hatch is already open, holding the exact stored value.
    expect(screen.getByLabelText("Custom CSS font-family")).toHaveValue(
      '"Acme Grotesk", sans-serif',
    );
  });

  it("hides the custom field behind a disclosure when the value is a library font", async () => {
    const user = userEvent.setup();
    setup(montserrat.stack);
    expect(
      screen.queryByLabelText("Custom CSS font-family"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /custom font stack/i }),
    );
    expect(screen.getByLabelText("Custom CSS font-family")).toBeInTheDocument();
  });

  it("loads the library once when it mounts, not once per render", () => {
    const { rerender } = render(
      <FontPicker
        slot="body"
        value=""
        onChange={vi.fn()}
        aria-label="Body font"
      />,
    );
    rerender(
      <FontPicker
        slot="body"
        value="Inter"
        onChange={vi.fn()}
        aria-label="Body font"
      />,
    );
    for (const f of FONTS) expect(f.load).toHaveBeenCalledTimes(1);
  });

  it("leads with monospace in the mono slot", async () => {
    const user = userEvent.setup();
    render(
      <FontPicker
        slot="mono"
        value=""
        onChange={vi.fn()}
        aria-label="Mono font"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Mono font" }));

    const options = within(await screen.findByRole("listbox")).getAllByRole(
      "option",
    );
    expect(options[0]).toHaveTextContent("JetBrains Mono");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <FontPicker
        slot="body"
        value={montserrat.stack}
        onChange={vi.fn()}
        aria-label="Body font"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
