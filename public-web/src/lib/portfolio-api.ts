/**
 * Published success stories — `GET /api/tenant/public/portfolio[/:slug]`.
 *
 * What makes this endpoint different from a normal CMS read is that every field
 * on a card and every byte of its media has to have been ALLOWLISTED for public
 * display (`portfolio_public.service.js:117-139`, the named precedent the service
 * profiles copy). A story that exists is therefore not a story that can be
 * shown: `cover_url` comes back `null` when the allowlist would refuse to stream
 * it, and a `<img src={null}>` is a broken frame on the front page of a
 * stranger's sales pitch.
 *
 * THE RULE THIS FILE ENFORCES: never render media this app did not get a URL
 * for. Not a placeholder, not a fallback path built from an id, not a guess at
 * `/media/<something>`. `mediaUrl(id)` is exported for exactly one use — the
 * gallery, whose URLs the server already composed.
 */
import { publicGet } from "./api";

export type PortfolioKpi = { label: string; value: string };

export type PortfolioCard = {
  slug: string;
  title: string;
  service_category?: string | null;
  cover_url?: string | null;
  client_logo_url?: string | null;
  client_name: string;
  published_month?: string | null;
};

export type PortfolioStory = PortfolioCard & {
  headline?: string | null;
  executive_summary?: string | null;
  operations_execution?: string | null;
  kpis?: PortfolioKpi[];
  gallery_urls?: string[];
  published_at?: string | null;
};

export const listStories = () =>
  publicGet<PortfolioCard[]>("/public/portfolio");

export const getStory = (slug: string) =>
  publicGet<PortfolioStory>(`/public/portfolio/${encodeURIComponent(slug)}`);
