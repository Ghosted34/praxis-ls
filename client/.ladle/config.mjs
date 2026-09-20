/**
 * Ladle — the component workbench (audit F15: "no way to see a primitive's
 * states", and the standing requirement for a usage example per shared
 * component).
 *
 * LADLE, NOT STORYBOOK. The audit names Storybook "or Ladle for a lighter
 * footprint" and Ladle is the right call here: it runs on the project's own
 * Vite config, so a story renders through the same aliases, the same Tailwind
 * pipeline and the same tokens as the app. Storybook would add ~40 packages and
 * a second build config to a repo whose stated problem is drift between
 * configs. Stories are plain `.stories.tsx` — the format Storybook also reads,
 * so moving later is not a rewrite.
 */
export default {
  stories: "src/**/*.stories.tsx",
  // Own vite config: inheriting the app's made the workbench emit a service
  // worker and a precache manifest for a page of buttons.
  viteConfig: ".ladle/vite.config.ts",
  outDir: "workbench-dist",
  addons: {
    // Every primitive must look right in BOTH themes — Phase 1 retuned tokens
    // for light and dark independently, and a story that only proves one is
    // half a story.
    theme: { enabled: true, defaultState: "light" },
    a11y: { enabled: true },
    // `phone` is the width the mobile work needs. Every responsive branch in
    // this app is chosen by a real media query rather than a prop, so the only
    // way to REVIEW one in the workbench is to actually make the viewport
    // narrow — a 390px div on a 1280px page renders the desktop shell and looks
    // like the fix did not work. 390 is the width the audit screenshotted
    // (Samsung A-series Chrome), 834 is iPad portrait, where a nine-column
    // table is still the wrong answer.
    width: {
      enabled: true,
      options: { phone: 390, tablet: 834, desktop: 1280, wide: 1920 },
    },
  },
};
