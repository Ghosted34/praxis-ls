/**
 * Programmatic access to the ⌘K command palette.
 *
 * The palette's open state lives in `AppShell`, which owns it via a document
 * keydown listener. Before this there was no prop or context reaching down to a
 * screen, so the Control Tower opened it by DISPATCHING A SYNTHETIC KEYBOARD
 * EVENT at `document` — `new KeyboardEvent("keydown", { key: "k", metaKey: true })`
 * — and hoping the shell's handler picked it up. That works, and the code said
 * plainly that lifting the state into context was the tidier fix if anything
 * else ever needed it. Something did.
 *
 * @example
 * const { open } = useCommandPalette();
 * <button onClick={open}>Browse everything →</button>
 */
import * as React from "react";

type CommandPaletteApi = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

/** No-ops outside the shell, so a screen rendered in isolation (a test, the
 *  component workbench) does not have to stand one up to render. */
const NOOP: CommandPaletteApi = { open: () => {}, close: () => {}, toggle: () => {} };

const Ctx = React.createContext<CommandPaletteApi>(NOOP);

export function CommandPaletteProvider({
  value,
  children,
}: {
  value: CommandPaletteApi;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommandPalette(): CommandPaletteApi {
  return React.useContext(Ctx);
}
