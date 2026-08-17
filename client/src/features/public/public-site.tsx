/**
 * Public marketing site (revamp brief §3.1) — the customer-facing front door:
 * company story, services, a quote-request form that feeds the ERP intake
 * (`/api/tenant/public/intake/quote-requests`), and links to the tracking,
 * portfolio and careers surfaces. Bilingual EN/FR with an inline toggle —
 * this file IS the translation dictionary.
 *
 * No auth, no staff chrome: a stranger lands here from a search engine, not
 * from an invite. Rate limits on the intake endpoint keep the form safe.
 */
import * as React from "react";
import { Link } from "react-router-dom";

type Lang = "en" | "fr";

const T = {
  en: {
    nav: { track: "Track a shipment", portfolio: "Our work", careers: "Careers" },
    hero: {
      eyebrow: "Logistics · Customs · Warehousing",
      title: "Freight that moves your business forward",
      sub: "Sea, air and hinterland logistics across the OHADA/CEMAC region — with one team, one platform, and total visibility.",
      cta: "Request a quote",
      cta2: "Track a shipment",
    },
    services: {
      title: "What we do",
      items: [
        { t: "Sea & air freight", d: "Imports and exports with the routing, documentation and customs work handled end to end." },
        { t: "Customs clearance", d: "DGI-compliant declarations, tax exemptions and red-channel handling that keep your cargo moving." },
        { t: "Warehousing", d: "Bonded and general warehousing with stock visibility from your phone." },
        { t: "Hinterland transport", d: "Trucking from Douala, Kribi and Yaoundé to anywhere in the sub-region." },
      ],
    },
    quote: {
      title: "Get a quote",
      sub: "Tell us about your shipment and we'll come back with a price.",
      service: "Service (e.g. Sea freight import)",
      type: "Service type (optional)",
      origin: "Origin (POL)",
      destination: "Destination (POD)",
      weight: "Est. weight (kg)",
      incoterm: "Incoterm (FOB, CIF…)",
      cargo: "Cargo description (optional)",
      submit: "Request quote",
      sending: "Sending…",
      sent: "Thank you — we've received your request and will reply shortly.",
      err: "Something went wrong. Please try again.",
      privacy: "Your details are only used to answer your request.",
    },
    footer: "Powered by JBS Praxis",
  },
  fr: {
    nav: { track: "Suivre un envoi", portfolio: "Nos réalisations", careers: "Carrières" },
    hero: {
      eyebrow: "Logistique · Douane · Entreposage",
      title: "Le fret qui fait avancer votre entreprise",
      sub: "Logistique maritime, aérienne et terrestre dans la région OHADA/CEMAC — une équipe, une plateforme, une visibilité totale.",
      cta: "Demander un devis",
      cta2: "Suivre un envoi",
    },
    services: {
      title: "Nos services",
      items: [
        { t: "Fret maritime & aérien", d: "Importations et exportations avec routage, documentation et formalités douanières de bout en bout." },
        { t: "Dédouanement", d: "Déclarations conformes à la DGI, exonérations fiscales et gestion du circuit rouge." },
        { t: "Entreposage", d: "Entrepôts sous douane et classiques avec visibilité du stock depuis votre téléphone." },
        { t: "Transport intérieur", d: "Camionnage depuis Douala, Kribi et Yaoundé vers toute la sous-région." },
      ],
    },
    quote: {
      title: "Demander un devis",
      sub: "Décrivez votre expédition et nous revenons vers vous avec un prix.",
      service: "Service (ex. Fret maritime import)",
      type: "Type de service (optionnel)",
      origin: "Origine (POL)",
      destination: "Destination (POD)",
      weight: "Poids estimé (kg)",
      incoterm: "Incoterm (FOB, CIF…)",
      cargo: "Description de la cargaison (optionnel)",
      submit: "Demander un devis",
      sending: "Envoi…",
      sent: "Merci — nous avons reçu votre demande et vous répondrons rapidement.",
      err: "Une erreur est survenue. Veuillez réessayer.",
      privacy: "Vos informations ne servent qu'à répondre à votre demande.",
    },
    footer: "Propulsé par JBS Praxis",
  },
} as const;

const inputCls =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60";

export function PublicSitePage() {
  const [lang, setLang] = React.useState<Lang>("en");
  const t = T[lang];
  const [f, setF] = React.useState({
    requester_name: "",
    requester_email: "",
    requester_phone: "",
    service_category: "",
    service_type: "",
    origin_location: "",
    destination_location: "",
    estimated_weight: "",
    cargo_description: "",
    incoterm: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tenant/public/intake/quote-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester_name: f.requester_name || undefined,
          requester_email: f.requester_email || undefined,
          requester_phone: f.requester_phone || undefined,
          service_category: f.service_category,
          service_type: f.service_type || undefined,
          origin_location: f.origin_location,
          destination_location: f.destination_location,
          estimated_weight: f.estimated_weight
            ? Number(f.estimated_weight)
            : undefined,
          cargo_description: f.cargo_description || undefined,
          incoterm: f.incoterm || undefined,
        }),
      });
      if (!res.ok) throw new Error("bad");
      setSent(true);
    } catch {
      setErr(t.quote.err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-secondary text-foreground">
      {/* Top bar */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-white">
              P
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Praxis
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/public/track" className="hover:underline">
              {t.nav.track}
            </Link>
            <Link to="/public/portfolio" className="hover:underline">
              {t.nav.portfolio}
            </Link>
            <Link to="/public/careers" className="hover:underline">
              {t.nav.careers}
            </Link>
            <button
              type="button"
              onClick={() => setLang(lang === "en" ? "fr" : "en")}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
            >
              {lang === "en" ? "FR" : "EN"}
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-[rgb(var(--brand-blue-deep))] via-[rgb(var(--brand-blue))] to-[rgb(var(--brand-blue-deep))] text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--primary-ink-dark))]">
            {t.hero.eyebrow}
          </p>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            {t.hero.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-white/70">
            {t.hero.sub}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#quote"
              className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-ink"
            >
              {t.hero.cta}
            </a>
            <Link
              to="/public/track"
              className="rounded-lg border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {t.hero.cta2}
            </Link>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center font-display text-2xl font-bold tracking-tight">
          {t.services.title}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.services.items.map((s) => (
            <div
              key={s.t}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <h3 className="font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.d}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Quote form */}
      <section id="quote" className="border-t border-border bg-card">
        <div className="mx-auto max-w-2xl px-4 py-16">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight">
            {t.quote.title}
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {t.quote.sub}
          </p>

          {sent ? (
            <div className="mt-8 rounded-2xl border border-[rgb(var(--ok)_/_0.3)] bg-[rgb(var(--ok)_/_0.08)] p-6 text-center text-sm text-[rgb(var(--ok))]">
              {t.quote.sent}
            </div>
          ) : (
            <form
              onSubmit={(e) => void submit(e)}
              className="mt-8 space-y-3"
            >
              {err && (
                <div className="rounded-lg border border-[rgb(var(--bad)_/_0.3)] bg-[rgb(var(--bad)_/_0.08)] p-3 text-sm text-[rgb(var(--bad))]">
                  {err}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  required
                  value={f.requester_name}
                  onChange={(e) => set("requester_name", e.target.value)}
                  placeholder={lang === "en" ? "Your name" : "Votre nom"}
                  className={inputCls}
                />
                <input
                  required
                  type="email"
                  value={f.requester_email}
                  onChange={(e) => set("requester_email", e.target.value)}
                  placeholder={lang === "en" ? "Email" : "Courriel"}
                  className={inputCls}
                />
              </div>
              <input
                value={f.requester_phone}
                onChange={(e) => set("requester_phone", e.target.value)}
                placeholder={lang === "en" ? "Phone (optional)" : "Téléphone (optionnel)"}
                className={inputCls}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  required
                  value={f.service_category}
                  onChange={(e) => set("service_category", e.target.value)}
                  placeholder={t.quote.service}
                  className={inputCls}
                />
                <input
                  value={f.service_type}
                  onChange={(e) => set("service_type", e.target.value)}
                  placeholder={t.quote.type}
                  className={inputCls}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  required
                  value={f.origin_location}
                  onChange={(e) => set("origin_location", e.target.value)}
                  placeholder={t.quote.origin}
                  className={inputCls}
                />
                <input
                  required
                  value={f.destination_location}
                  onChange={(e) => set("destination_location", e.target.value)}
                  placeholder={t.quote.destination}
                  className={inputCls}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={f.estimated_weight}
                  onChange={(e) => set("estimated_weight", e.target.value)}
                  placeholder={t.quote.weight}
                  className={inputCls}
                />
                <input
                  value={f.incoterm}
                  onChange={(e) => set("incoterm", e.target.value)}
                  placeholder={t.quote.incoterm}
                  className={inputCls}
                />
              </div>
              <textarea
                value={f.cargo_description}
                onChange={(e) => set("cargo_description", e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t.quote.cargo}
                className={inputCls}
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-ink disabled:opacity-50"
              >
                {busy ? t.quote.sending : t.quote.submit}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                {t.quote.privacy}
              </p>
            </form>
          )}
        </div>
      </section>

      <footer className="border-t border-border bg-card py-6 text-center text-xs text-muted-foreground">
        {t.footer}
      </footer>
    </div>
  );
}

export default PublicSitePage;
