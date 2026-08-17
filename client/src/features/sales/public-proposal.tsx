import * as React from "react";
import { tr } from "@/lib/i18n";
import { useParams, useSearchParams } from "react-router-dom";
import { tenant } from "@/lib/api-client";
import { useBranding } from "@/app/branding/branding-context";

type Presentation = {
  language: "EN" | "FR";
  title: string;
  document_number: string;
  client_name: string;
  route: string;
  labels: { service: string; quantity: string; unit: string; total: string };
  sections: { key: string; title: string; body: string }[];
  lines: {
    label: string;
    quantity: number;
    unit_price_display: string;
    total_display: string;
  }[];
};
type Payload = { presentation: Presentation };

export function PublicProposalPage() {
  const { token = "" } = useParams();
  const [query, setQuery] = useSearchParams();
  const requestedLanguage = String(query.get("lang") || "EN").toUpperCase();
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState(false);
  const brand = useBranding();

  React.useEffect(() => {
    setData(null);
    setError(false);
    const params = new URLSearchParams({ lang: requestedLanguage });
    tenant<Payload>(
      `/public/proposals/${encodeURIComponent(token)}?${params}`,
      { auth: false },
    ).then(setData).catch(() => setError(true));
  }, [token, requestedLanguage]);

  if (error) return <main className="mx-auto max-w-3xl p-8"><h1>Proposal unavailable</h1></main>;
  if (!data) return <main className="p-8">Loading proposal…</main>;
  const p = data.presentation;
  const pdf = `/api/tenant/public/proposals/${encodeURIComponent(token)}/pdf?${new URLSearchParams({ lang: p.language })}`;

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-background p-6 text-foreground print:p-0">
      <header className="border-b pb-5">
        <p className="text-sm font-semibold">{brand.branding.name || "Praxis"}</p>
        <h1 className="mt-3 text-3xl font-bold">{p.title}</h1>
        <p>{p.client_name}</p>
        <div className="mt-4 flex gap-2 print:hidden">
          <button className="rounded border px-3 py-1" onClick={() => setQuery({ lang: "EN" })}>{tr("English")}</button>
          <button className="rounded border px-3 py-1" onClick={() => setQuery({ lang: "FR" })}>{tr("Français")}</button>
          <a className="rounded bg-primary px-3 py-1 text-primary-foreground" href={pdf}>Download PDF</a>
        </div>
      </header>
      <section className="py-5">
        <p>{p.route}</p>
        {p.sections.map((section) => (
          <article key={section.key} className="mt-5">
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <p className="whitespace-pre-wrap">{section.body}</p>
          </article>
        ))}
      </section>
      <table className="w-full border-collapse">
        <thead><tr>
          <th className="border-b p-2 text-left">{p.labels.service}</th>
          <th className="border-b p-2">{p.labels.quantity}</th>
          <th className="border-b p-2 text-right">{p.labels.unit}</th>
          <th className="border-b p-2 text-right">{p.labels.total}</th>
        </tr></thead>
        <tbody>{p.lines.map((line, index) => <tr key={index}>
          <td className="border-b p-2">{line.label}</td>
          <td className="border-b p-2 text-center">{line.quantity}</td>
          <td className="border-b p-2 text-right">{line.unit_price_display}</td>
          <td className="border-b p-2 text-right">{line.total_display}</td>
        </tr>)}</tbody>
      </table>
    </main>
  );
}
