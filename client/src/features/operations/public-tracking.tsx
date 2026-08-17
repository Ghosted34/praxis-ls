import * as React from "react";
import { tenant } from "@/lib/api-client";

interface PublicMilestone {
  code: string;
  label: string;
  public_state: "COMPLETED" | "CURRENT" | "UPCOMING";
  is_complete: boolean;
  is_current: boolean;
  due_date: string | null;
  completed_at: string | null;
  location: string | null;
  stage_reference: string | null;
  progress_note: string | null;
}

interface TrackingResult {
  reference: string;
  computed_status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  current_stage: PublicMilestone | null;
  origin: string | null;
  destination: string | null;
  progress: { completed: number; total: number; percent: number };
  milestones: PublicMilestone[];
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Preparing",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CURRENT: "Current stage",
  UPCOMING: "Upcoming",
};

const dateOnly = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
  : null;
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : null;

function MilestoneDetails({ milestone }: { milestone: PublicMilestone }) {
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {milestone.due_date && (
        <div><dt className="text-muted-foreground">Due</dt><dd>{dateOnly(milestone.due_date)}</dd></div>
      )}
      {milestone.completed_at && (
        <div><dt className="text-muted-foreground">Completed</dt><dd>{dateTime(milestone.completed_at)}</dd></div>
      )}
      {milestone.location && (
        <div><dt className="text-muted-foreground">Location</dt><dd>{milestone.location}</dd></div>
      )}
      {milestone.stage_reference && (
        <div><dt className="text-muted-foreground">Reference</dt><dd className="break-words">{milestone.stage_reference}</dd></div>
      )}
      {milestone.progress_note && (
        <div className="sm:col-span-2"><dt className="text-muted-foreground">Progress note</dt><dd className="whitespace-pre-wrap">{milestone.progress_note}</dd></div>
      )}
    </dl>
  );
}

export function PublicTrackingPage() {
  const [reference, setReference] = React.useState("");
  const [data, setData] = React.useState<TrackingResult | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    const value = reference.trim();
    if (!value) return;
    setError("");
    setData(null);
    setLoading(true);
    try {
      setData(await tenant<TrackingResult>(`/public/tracking/${encodeURIComponent(value)}`, { auth: false }));
    } catch {
      setError("Shipment not found. Check the reference and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6 sm:p-10">
      <header>
        <p className="micro">Client shipment visibility</p>
        <h1 className="mt-1 text-3xl font-bold">Track your shipment</h1>
        <p className="mt-2 text-muted-foreground">Enter the exact file reference shown on your shipment documents.</p>
      </header>

      <form className="mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={search}>
        <label className="sr-only" htmlFor="tracking-reference">Shipment reference</label>
        <input
          id="tracking-reference"
          className="min-h-11 flex-1 rounded border border-input bg-background px-3"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Shipment reference"
          autoComplete="off"
        />
        <button
          type="submit"
          className="min-h-11 rounded bg-primary px-5 font-medium text-primary-foreground disabled:opacity-60"
          disabled={!reference.trim() || loading}
        >
          {loading ? "Tracking…" : "Track"}
        </button>
      </form>

      {error && <p className="mt-4 rounded border border-destructive/30 bg-destructive/5 p-3" role="alert">{error}</p>}

      {data && (
        <section className="mt-8" aria-live="polite">
          <div className="lux-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="micro">Shipment reference</p>
                <h2 className="mt-1 text-xl font-semibold">{data.reference}</h2>
                <p className="mt-1 text-muted-foreground">{data.origin || "Origin pending"} → {data.destination || "Destination pending"}</p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary-ink">
                {STATUS_LABEL[data.computed_status] || data.computed_status}
              </span>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${data.progress.percent}% complete`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${data.progress.percent}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.progress.percent}% complete · {data.progress.completed} of {data.progress.total} client-visible stages
            </p>
          </div>

          {data.current_stage && (
            <article className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-5">
              <p className="micro">Current stage</p>
              <h3 className="mt-1 text-lg font-semibold">{data.current_stage.label}</h3>
              <MilestoneDetails milestone={data.current_stage} />
            </article>
          )}

          <h3 className="mt-8 text-xl font-semibold">Shipment timeline</h3>
          <ol className="mt-4 space-y-3">
            {data.milestones.map((milestone, index) => (
              <li key={`${milestone.code}-${index}`} className="lux-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{milestone.label}</strong>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                    {STATUS_LABEL[milestone.public_state] || milestone.public_state}
                  </span>
                </div>
                <MilestoneDetails milestone={milestone} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
