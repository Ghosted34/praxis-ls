/**
 * From "what may this user see" to "what does the ribbon draw".
 *
 * THE ONE RULE THIS FILE OBEYS. The grouping — which of the six workflow verbs
 * a module belongs to — is `platform.module_catalogue.group_key`, and it
 * arrives with every `GET /permissions/mine`. Nothing here decides it. What
 * this file owns is the join in the other direction: a verb's module keys are
 * turned into areas and sections by looking each route's module up in
 * `screen-registry.json`, which is the file a new route already has to be added
 * to. Verb labels and glyphs are below because a drawing is not a taxonomy.
 *
 * WHY AN AREA GETS EXACTLY ONE FAMILY. Several areas span verbs at the module
 * level — the Tax center is filed under MOD-07 (a `configure` module) but lives
 * in Finance, and Journals under MOD-05. Placing each SECTION under its own
 * module's verb would scatter one screen's tabs across two ribbon tabs, which
 * is worse than either alternative: you would open Finance and find two of its
 * ten sections missing, with no indication of where they went. So an area is
 * placed by the verb most of its visible modules agree on, and once placed it
 * shows every section this user can read.
 *
 * THE VOTE COUNTS DISTINCT MODULES, NOT SECTIONS, and that distinction decides
 * a real case. The Vault's overview, documents and signatures are all gated on
 * MOD-64 — one module, three screens — while verification, compliance flags and
 * reports are MOD-66, MOD-65 and MOD-63. Counting screens makes that 3–3, and
 * the tie hands the whole Vault to `monitor`, because MOD-64 is catalogued as
 * Smart Comms. Counting modules makes it 1–3 for `configure`, which is where a
 * document vault belongs. Screens are a UI decision about how to split a
 * module; modules are the authorisation surface, and that is the thing the
 * ribbon is partitioning.
 */
import {
  AREAS,
  areaRoute,
  sectionRoute,
  type Area,
  type AreaSection,
} from "./areas";
import { moduleForRoute } from "@/app/screen-registry";
import type { NavAccess } from "@/lib/nav-access";
import { PraxisMark } from "@/components/ai/icons";
import {
  AREA_ICON,
  CommsIcon,
  GodModeIcon,
  HrIcon,
  MasterIcon,
  OperationsIcon,
  PaletteIcon,
  SalesIcon,
  SettingsIcon,
  SupportIcon,
  TowerIcon,
  VaultIcon,
  WorkspaceIcon,
  type IP,
} from "./nav-icons";
import type * as React from "react";

/**
 * The six verbs, as a user reads them.
 *
 * These are LABELS, not the taxonomy: the verb keys and their order come from
 * the server. A key with no entry here falls back to its own name capitalised,
 * so a seventh verb added to the catalogue appears — plainly labelled and
 * obviously new — rather than vanishing from the shell.
 */
export const FAMILY_LABEL: Record<string, string> = {
  monitor: "Monitor",
  engage: "Engage",
  fulfill: "Fulfil",
  transact: "Transact",
  empower: "Empower",
  configure: "Configure",
};

export const FAMILY_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  monitor: TowerIcon,
  engage: SalesIcon,
  fulfill: OperationsIcon,
  transact: AREA_ICON.Finance,
  empower: HrIcon,
  configure: SettingsIcon,
};

/**
 * Glyphs for areas whose label is not a key in AREA_ICON.
 *
 * EVERY ONE IS DISTINCT, and that is a requirement rather than a nicety: the
 * icon rail is icons ONLY, with the label behind a hover, so two areas drawn
 * with the same glyph are two rail entries a user cannot tell apart without
 * pointing at each in turn. The first version of this map had Control Tower and
 * My workspace both on `TowerIcon`, and God mode, AI Control and Settings all on
 * `SettingsIcon` — four of the five sat in the rail's default set.
 * `ribbon-model.test.ts` pins uniqueness so the next area added cannot
 * reintroduce it.
 */
const EXTRA_AREA_ICON: Record<string, (p: IP) => React.JSX.Element> = {
  "Control Tower": TowerIcon,
  "My workspace": WorkspaceIcon,
  "Smart Comms": CommsIcon,
  "Support & feedback": SupportIcon,
  "Vault & compliance": VaultIcon,
  "Security & access": AREA_ICON["Security & Access"],
  "Settings & admin": SettingsIcon,
  "Master data": MasterIcon,
  "God mode": GodModeIcon,
  "AI Control": PaletteIcon,
  // The assistant's own mark, not a second drawing of it. `ribbon-model.test.ts`
  // pins that no two areas share a glyph, and the rail is icons-only — so the
  // area a user reaches the assistant through has to carry the same mark the
  // drawer and the workspace do, or the rail teaches one symbol and the panel
  // shows another.
  "Praxis AI": PraxisMark,
};

export const iconForArea = (label: string): ((p: IP) => React.JSX.Element) =>
  AREA_ICON[label] ?? EXTRA_AREA_ICON[label] ?? MasterIcon;

export type RibbonArea = {
  area: Area;
  /** The sections of this area this user can read, in the area's own order. */
  sections: AreaSection[];
};

export type RibbonFamily = {
  key: string;
  label: string;
  Icon: (p: IP) => React.JSX.Element;
  areas: RibbonArea[];
};

/** Every route an area covers: its landing page plus each section. */
function routesOf(area: Area): string[] {
  return [areaRoute(area), ...area.sections.map((s) => sectionRoute(area, s))];
}

/**
 * The ribbon, resolved for one user.
 *
 * A family with no area left after filtering is DROPPED, not rendered empty:
 * `groups` can legitimately contain a verb whose only visible module has no
 * screen in this client (a backend-only module), and a tab that opens onto
 * nothing is worse than a tab that is not there.
 */
export function buildRibbon(access: NavAccess): RibbonFamily[] {
  // Inverted once. Only VISIBLE modules are in here, which is what makes a
  // module's absence and a module's invisibility the same lookup.
  const verbOf = new Map<string, string>();
  for (const [verb, keys] of Object.entries(access.byGroup ?? {})) {
    for (const key of keys) verbOf.set(key, verb);
  }
  const rank = new Map(access.groups.map((g, i) => [g, i]));

  const families = new Map<string, RibbonArea[]>();
  for (const area of AREAS) {
    // Which verbs this area's visible modules vote for — one vote per MODULE,
    // however many of the area's screens that module happens to gate.
    const votes = new Map<string, number>();
    const counted = new Set<string>();
    for (const route of routesOf(area)) {
      const mod = moduleForRoute(route);
      if (!mod || counted.has(mod)) continue;
      counted.add(mod);
      const verb = verbOf.get(mod);
      if (verb) votes.set(verb, (votes.get(verb) ?? 0) + 1);
    }
    if (votes.size === 0) continue;

    let family = "";
    for (const [verb, n] of votes) {
      const best = votes.get(family) ?? -1;
      // Catalogue order breaks a tie, so the placement does not depend on the
      // order the votes happened to be counted in.
      if (
        n > best ||
        (n === best && (rank.get(verb) ?? 99) < (rank.get(family) ?? 99))
      )
        family = verb;
    }

    // Within the area, everything readable shows — including a section whose
    // own module sits under a different verb (the Tax center), and one that is
    // ungated or unregistered (null / undefined). Hiding a screen because
    // somebody forgot a registry entry is the worse failure of the two.
    const sections = area.sections.filter((s) => {
      const mod = moduleForRoute(sectionRoute(area, s));
      return !mod || verbOf.has(mod);
    });

    const list = families.get(family) ?? [];
    list.push({ area, sections });
    families.set(family, list);
  }

  return access.groups
    .filter((verb) => (families.get(verb) ?? []).length > 0)
    .map((verb) => ({
      key: verb,
      label: FAMILY_LABEL[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1),
      Icon: FAMILY_ICON[verb] ?? MasterIcon,
      areas: families.get(verb) ?? [],
    }));
}

/** The family a path is in, and the area within it. Both undefined off-ribbon
 *  (My appearance, a document viewer) — the ribbon then falls back to whichever
 *  family the user last chose. */
export function locate(
  families: RibbonFamily[],
  pathname: string,
): { family?: RibbonFamily; area?: RibbonArea } {
  let hit: { family: RibbonFamily; area: RibbonArea } | undefined;
  let best = -1;
  for (const family of families) {
    for (const area of family.areas) {
      const routes = [
        areaRoute(area.area),
        ...area.sections.map((s) => sectionRoute(area.area, s)),
      ];
      for (const route of routes) {
        // The Control Tower's route is "/", which prefix-matches everything —
        // it only counts on an exact hit.
        const match =
          route === "/"
            ? pathname === "/"
            : pathname === route || pathname.startsWith(route + "/");
        // Longest match wins, so /finance/invoices resolves to Finance rather
        // than to whichever area happens to be listed first.
        if (match && route.length > best) {
          best = route.length;
          hit = { family, area };
        }
      }
    }
  }
  return hit ?? {};
}
