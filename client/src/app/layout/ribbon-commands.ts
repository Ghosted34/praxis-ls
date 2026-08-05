/**
 * The ribbon's right-hand cluster — commands that belong to the screen you are
 * looking at. The context and its hooks; the provider is in
 * `shell-providers.tsx`.
 *
 * WHY A PUBLISH MECHANISM RATHER THAN A TABLE. The alternative is a map from
 * route to command list in the shell, which puts a screen's primary action in a
 * file the screen's author will never open. It goes stale the first time a
 * screen changes what it does, and it cannot express a command that depends on
 * screen STATE — the Finance command center's create button is "New invoice" or
 * "New proforma" depending on which chip is active, and no route table can know
 * that.
 *
 * So a screen declares its commands with `useRibbonCommands`, the same way it
 * declares its title. Publishing is scoped to the mount: navigating away
 * retracts them, so the ribbon can never show a command for a screen that is no
 * longer on-screen.
 *
 * BELOW `md` this is inert. There is no ribbon on a phone (the bottom nav and
 * the family sheet own navigation there), so a screen that publishes a command
 * keeps its own control for that width — see `finance/hub.tsx`.
 */
import * as React from "react";

export type RibbonCommand = {
  key: string;
  label: string;
  onSelect: () => void;
  /** Renders as the filled primary control. At most one per screen. */
  primary?: boolean;
};

export type RibbonCommandRegistry = {
  commands: RibbonCommand[];
  publish: (id: number, commands: RibbonCommand[]) => void;
  retract: (id: number) => void;
};

export const RibbonCommandsContext = React.createContext<RibbonCommandRegistry | null>(null);

let nextId = 1;

/** What the ribbon draws. Empty outside the provider. */
export function useRibbonCommandList(): RibbonCommand[] {
  return React.useContext(RibbonCommandsContext)?.commands ?? [];
}

/**
 * Publish this screen's commands into the ribbon for as long as it is mounted.
 *
 * `commands` is read on every change, so pass a `useMemo`'d list — an array
 * literal rebuilt each render would republish on every render.
 *
 * @example
 * useRibbonCommands(
 *   React.useMemo(
 *     () => [{ key: "new", label: `New ${noun}`, primary: true, onSelect: () => navigate(route) }],
 *     [noun, route, navigate],
 *   ),
 * );
 */
export function useRibbonCommands(commands: RibbonCommand[]) {
  const registry = React.useContext(RibbonCommandsContext);
  const id = React.useRef(0);
  if (!id.current) id.current = nextId++;

  // `publish` and `retract`, not `registry` — the registry object changes
  // identity on every publish (its `commands` array is derived), so depending
  // on the whole thing would re-run this effect for someone else's command
  // list. The two callbacks are stable for the provider's lifetime.
  const publisher = id.current;
  const publish = registry?.publish;
  const retract = registry?.retract;

  React.useEffect(() => {
    publish?.(publisher, commands);
  }, [publish, publisher, commands]);

  // Separate from the publish effect on purpose: retraction must happen when
  // the SCREEN unmounts, not every time its command list changes.
  React.useEffect(() => () => retract?.(publisher), [retract, publisher]);
}
