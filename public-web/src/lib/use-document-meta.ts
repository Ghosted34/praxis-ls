import * as React from "react";

/**
 * Per-page `<title>`, description and `hreflang` alternates.
 *
 * ── WHY A HOOK AND NOT A LIBRARY ───────────────────────────────────────────
 *
 * `react-helmet` is the usual answer and it is overkill for four tags: React 19
 * hoists `<title>`/`<meta>` natively, but this app is pinned to React 18 (the
 * version `client` and `platform-console` both run, and a public app on a
 * different major than its sibling apps is an upgrade hazard nobody wants), so
 * the tags are written imperatively. Ten lines, no dependency, and the same
 * cleanup discipline as any other effect: a stale description on a page that
 * changed is worse than no description.
 *
 * ── THE LANG ALTERNATES ────────────────────────────────────────────────────
 *
 * `alternates` exists because a bilingual site without `hreflang` teaches the
 * crawler that two URLs are duplicates, and the tenant's French page is the one
 * that loses. Only the SLUG MAP the server returns goes in — `service_type`
 * profiles publish `slug_en`/`slug_fr` side by side, so `/public/services/fret-maritime`
 * and `/public/services/sea-freight` are provably the same page. A page with no
 * known twin gets no `link` tag at all; pointing `hreflang="fr"` at the homepage
 * as a fallback would tell Google that every French page on this site is the
 * homepage.
 *
 * `?lang=` rather than an `/fr/` path prefix is the scheme this app uses for
 * language (it is what `client` does, and the tenant's routes are already
 * host-resolved, not path-resolved). If the marketing site is ever given real
 * path prefixes, only `buildUrl` below changes.
 */
export type DocMeta = {
  title?: string;
  description?: string;
  /** Absolute-or-relative URL per language tag, for the slug-mapped pages. */
  alternates?: Partial<Record<"en" | "fr", string>>;
};

function upsertMeta(
  attr: "name" | "property",
  key: string,
  content: string,
): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  const created = !el;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const node = el;
  const prev = node.getAttribute("content");
  node.setAttribute("content", content);
  return () => {
    // A tag the app added is removed; a tag `index.html` shipped with is put back,
    // because navigating away from a service page must not leave the tenant's
    // default description replaced by one page's copy forever.
    if (created) node.remove();
    else if (prev === null) node.removeAttribute("content");
    else node.setAttribute("content", prev);
  };
}

export function useDocumentMeta(meta: DocMeta): void {
  const { title, description, alternates } = meta;
  // A stable key so the effect does not re-run on every render for an object
  // literal built inline at the call site.
  const altKey = alternates
    ? Object.entries(alternates)
        .filter(([, v]) => !!v)
        .map(([k, v]) => `${k}=${v}`)
        .join("&")
    : "";

  React.useEffect(() => {
    const cleaners: (() => void)[] = [];
    const prevTitle = document.title;
    if (title) document.title = title;
    cleaners.push(() => {
      document.title = prevTitle;
    });

    if (description) {
      cleaners.push(upsertMeta("name", "description", description));
      cleaners.push(upsertMeta("property", "og:description", description));
    }
    if (title) cleaners.push(upsertMeta("property", "og:title", title));

    const links: HTMLLinkElement[] = [];
    if (alternates) {
      for (const [lang, href] of Object.entries(alternates)) {
        if (!href) continue;
        const link = document.createElement("link");
        link.setAttribute("rel", "alternate");
        link.setAttribute("hreflang", lang);
        link.setAttribute("href", href);
        document.head.appendChild(link);
        links.push(link);
      }
      if (links.length) {
        const x = document.createElement("link");
        x.setAttribute("rel", "alternate");
        x.setAttribute("hreflang", "x-default");
        x.setAttribute("href", links[0].getAttribute("href") || "");
        document.head.appendChild(x);
        links.push(x);
      }
    }

    return () => {
      cleaners.forEach((c) => c());
      links.forEach((l) => l.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, altKey]);
}
