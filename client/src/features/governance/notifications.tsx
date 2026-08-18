/**
 * Governance — the notification feed and per-category channel preferences.
 *
 * Split out of `features/governance/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { HubCrumb } from "@/components/tabbed-hub";
import { Pill } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, dateFmt, enumLabel } from "@/lib/format";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { RowActions } from "@/components/ui/row-actions";
import { shell } from "./shared";

type Notification = {
  notification_id: string;
  channel?: string | null;
  event_type_key?: string | null;
  category?: string | null;
  title: string;
  body?: string | null;
  entity_ref?: string | null;
  priority?: string | null;
  read_at?: string | null;
  created_at?: string | null;
};
type Preference = { channel: string; category: string; enabled: boolean };

const CHANNELS = ["IN_APP", "EMAIL", "SMS"];
/**
 * The backend accepts any category string (it's free text), so this list is a UI
 * convention rather than a contract. Categories the user already has a stored
 * preference for are merged in, so nothing saved elsewhere disappears from view.
 */
type Category = { key: string; label: string; security: boolean };
// Fallback if the catalog endpoint is unavailable — keeps the panel usable.
const FALLBACK_CATEGORIES: Category[] = [
  { key: "security", label: "Security", security: true },
  { key: "approvals", label: "Approvals", security: false },
  { key: "finance", label: "Finance", security: false },
  { key: "operations", label: "Operations", security: false },
  { key: "sales", label: "Sales & CRM", security: false },
  { key: "compliance", label: "Compliance", security: false },
  { key: "system", label: "System", security: false },
];

function PreferencesPanel() {
  const prefs = useResource<Preference[] | { preferences?: Preference[] }>(
    () => tenant("/notifications/preferences"),
    [],
  );
  const catalog = useResource<Category[]>(
    () => tenant("/notifications/categories"),
    [],
  );
  const [draft, setDraft] = React.useState<Record<string, boolean> | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const stored: Preference[] = React.useMemo(() => {
    const d = prefs.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.preferences)) return d.preferences;
    return [];
  }, [prefs.data]);

  const catMeta: Category[] = React.useMemo(
    () =>
      Array.isArray(catalog.data) && catalog.data.length
        ? catalog.data
        : FALLBACK_CATEGORIES,
    [catalog.data],
  );
  const categories = React.useMemo(() => catMeta.map((c) => c.key), [catMeta]);
  const labelOf = React.useCallback(
    (k: string) => catMeta.find((c) => c.key === k)?.label || k,
    [catMeta],
  );
  const isSecurity = React.useCallback(
    (k: string) => !!catMeta.find((c) => c.key === k)?.security,
    [catMeta],
  );

  // Defaults when the user has set no explicit row: IN_APP on (cheap, in-product),
  // outbound channels (EMAIL/SMS) off — they're opt-in so we never
  // message someone who didn't ask. Mirrors notification.repo.isChannelEnabled.
  const key = (c: string, ch: string) => `${ch}::${c}`;
  const current = React.useMemo(() => {
    const m: Record<string, boolean> = {};
    categories.forEach((c) =>
      CHANNELS.forEach((ch) => {
        m[key(c, ch)] = ch === "IN_APP";
      }),
    );
    stored.forEach((p) => {
      m[key(p.category, p.channel)] = p.enabled;
    });
    return m;
  }, [categories, stored]);

  const value = draft || current;
  const dirty =
    !!draft && Object.keys(value).some((k) => value[k] !== current[k]);

  function toggle(c: string, ch: string) {
    const k = key(c, ch);
    setSaved(false);
    setDraft({ ...value, [k]: !value[k] });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const payload: Preference[] = [];
    categories.forEach((c) =>
      CHANNELS.forEach((ch) => {
        payload.push({ channel: ch, category: c, enabled: value[key(c, ch)] });
      }),
    );
    try {
      await tenant("/notifications/preferences", {
        method: "PUT",
        body: { preferences: payload },
      });
      setDraft(null);
      setSaved(true);
      prefs.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (prefs.error) return <ErrorState message={prefs.error} />;
  if (prefs.loading) return <span className="micro">Loading preferences…</span>;

  return (
    <div className="space-y-4">
      <PushOptIn />
      <p className="text-sm text-muted-foreground">
        Choose how you're told about each kind of event. These are yours alone —
        no grant needed, and they don't affect anyone else.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Category
              </th>
              {CHANNELS.map((ch) => (
                <th
                  key={ch}
                  className="px-3 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {ch.replace("_", "-")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const locked = isSecurity(c);
              return (
                <tr key={c} className="border-t">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {labelOf(c)}
                    {locked && (
                      <span className="ml-2 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Always on
                      </span>
                    )}
                  </td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={locked ? true : !!value[key(c, ch)]}
                        disabled={locked}
                        title={
                          locked
                            ? "Security alerts can't be turned off"
                            : undefined
                        }
                        onChange={() => !locked && toggle(c, ch)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <ErrorState message={error} />}
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="micro">Preferences saved.</span>}
        {dirty && (
          <Button
            variant="outline"
            onClick={() => {
              setDraft(null);
              setSaved(false);
            }}
            disabled={busy}
          >
            Discard
          </Button>
        )}
        <Button onClick={save} loading={busy} disabled={!dirty || busy}>
          Save preferences
        </Button>
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const [tab, setTab] = React.useState<"inbox" | "preferences">("inbox");
  const { rows, error, loading, reload } =
    useList<Notification>("/notifications");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const all = rows || [];
  const unread = all.filter((n) => !n.read_at);
  const list = unreadOnly ? unread : all;

  async function markRead(id: string) {
    setBusy(id);
    setActionError(null);
    try {
      await tenant(`/notifications/${id}/read`, { method: "POST" });
      reload();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function markAll() {
    setBusy("__all");
    setActionError(null);
    try {
      await tenant("/notifications/read-all", { method: "POST" });
      reload();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Notification>[] = [
    {
      key: "title",
      label: "Notification",
      render: (r) => (
        <div className="min-w-0">
          <div
            className={
              r.read_at
                ? "text-muted-foreground"
                : "font-semibold text-foreground"
            }
          >
            {r.title}
          </div>
          {r.body && (
            <div className="truncate text-xs text-muted-foreground">
              {r.body}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      render: (r) => (
        <Pill
          tone={String(r.priority).toUpperCase() === "HIGH" ? "bad" : "mute"}
        >
          {r.priority || "NORMAL"}
        </Pill>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (r) =>
        r.category ? (
          <Pill tone={r.category === "security" ? "bad" : "blue"}>
            {r.category}
          </Pill>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "event_type_key",
      label: "Event",
      render: (r) => (
        <span className="text-muted-foreground">
          {r.event_type_key ? enumLabel(r.event_type_key) : "—"}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "When",
      render: (r) => <span className="num">{dateFmt(r.created_at)}</span>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          {r.read_at ? (
            <Pill tone="mute">{tr("Read")}</Pill>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === r.notification_id}
              onClick={() => markRead(r.notification_id)}
            >
              Mark read
            </Button>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Governance" to="/governance" />}
        title={tr("Notifications")}
        description="Your inbox. System-generated only — Watch-the-Watcher writes HIGH alerts here on security-critical changes."
        action={
          tab === "inbox" && unread.length > 0 ? (
            <Button
              variant="outline"
              onClick={markAll}
              loading={busy === "__all"}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <Segmented
        label="Notifications section"
        variant="solid"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          {
            value: "inbox",
            label: `Inbox${unread.length ? ` (${unread.length})` : ""}`,
          },
          { value: "preferences", label: "Preferences" },
        ]}
      />
      {actionError && (
        <div className="mb-3">
          <ErrorState message={actionError} />
        </div>
      )}

      {tab === "inbox" ? (
        <>
          <KpiRow>
            <KpiTile label={tr("Unread")} value={num(unread.length)} />
            <KpiTile label={tr("Total")} value={num(all.length)} />
            <KpiTile
              label="High priority"
              value={num(
                all.filter((n) => String(n.priority).toUpperCase() === "HIGH")
                  .length,
              )}
            />
          </KpiRow>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[
              { k: false, label: "All" },
              { k: true, label: "Unread" },
            ].map((o) => (
              <button
                key={String(o.k)}
                onClick={() => setUnreadOnly(o.k)}
                className={
                  unreadOnly === o.k
                    ? "rounded-full border border-transparent bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
                    : "rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <DataList
            columns={columns}
            rows={loading ? null : list}
            error={error}
            loading={loading}
            rowKey={(r) => r.notification_id}
            empty={{
              title: unreadOnly ? "Nothing unread" : "No notifications",
              hint: "Alerts arrive here as events fire.",
            }}
          />
        </>
      ) : (
        <PreferencesPanel />
      )}
    </section>
  );
}

/* ═══════════════════ Workflows — definitions + step chains ═══════════════════ */
