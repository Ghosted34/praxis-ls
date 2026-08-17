import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { tenant } from "@/lib/api-client";

type PortfolioCard = {
  slug: string;
  title: string;
  service_category?: string | null;
  cover_url?: string | null;
  client_logo_url?: string | null;
  client_name: string;
  published_month?: string | null;
};
type Kpi = { label: string; value: string };
type PortfolioStory = PortfolioCard & {
  headline?: string | null;
  executive_summary?: string | null;
  operations_execution?: string | null;
  kpis?: Kpi[];
  gallery_urls?: string[];
  published_at?: string | null;
};

function ClientIdentity({ story }: { story: PortfolioCard }) {
  return (
    <span className="flex items-center gap-2">
      {story.client_logo_url && (
        <img
          src={story.client_logo_url}
          alt={`${story.client_name} logo`}
          className="h-8 w-8 rounded bg-white object-contain p-1"
        />
      )}
      <span>{story.client_name}</span>
    </span>
  );
}

export function PublicPortfolioPage() {
  const { slug } = useParams();
  const [data, setData] = React.useState<PortfolioCard[] | PortfolioStory | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    tenant<PortfolioCard[] | PortfolioStory>(
      `/public/portfolio${slug ? `/${encodeURIComponent(slug)}` : ""}`,
      { auth: false },
    ).then((response) => {
      if (live) setData(response);
    }).catch(() => {
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [slug]);

  if (failed) return <main className="mx-auto max-w-5xl p-8"><h1>Story unavailable</h1></main>;
  if (!data) return <main className="p-8">Loading portfolio…</main>;

  if (Array.isArray(data)) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-bold">Success stories</h1>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {data.map((story) => (
            <Link key={story.slug} to={`/public/portfolio/${story.slug}`} className="lux-card overflow-hidden">
              {story.cover_url && <img src={story.cover_url} alt="" className="h-44 w-full object-cover" />}
              <div className="space-y-2 p-4">
                <p className="text-xs">{story.service_category || ""}</p>
                <h2 className="font-semibold">{story.title}</h2>
                <ClientIdentity story={story} />
              </div>
            </Link>
          ))}
        </div>
      </main>
    );
  }

  const story = data;
  return (
    <main className="mx-auto max-w-4xl p-6">
      {story.cover_url && <img src={story.cover_url} alt="" className="h-72 w-full object-cover" />}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>{story.service_category || ""}</span>
        <ClientIdentity story={story} />
      </div>
      <h1 className="mt-3 text-3xl font-bold">{story.headline || story.title}</h1>
      <p className="mt-4 text-lg">{story.executive_summary || ""}</p>
      <section className="mt-7 whitespace-pre-wrap">{story.operations_execution || ""}</section>
      <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(story.kpis || []).map((kpi, index) => (
          <div key={`${kpi.label}-${index}`} className="lux-card p-3">
            <strong>{kpi.value}</strong>
            <p>{kpi.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-7 grid grid-cols-2 gap-3">
        {(story.gallery_urls || []).map((url) => <img key={url} src={url} alt="" />)}
      </div>
    </main>
  );
}
