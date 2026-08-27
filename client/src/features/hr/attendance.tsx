/**
 * Attendance — manager view. Employees clock in/out from the floating clock in
 * the bottom-right (see components/clock-punch). This screen is for oversight:
 * the day's clock-ins with lateness + on-site status, who's absent, and the
 * worksite geofences. Uses the locked kit.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { AttendanceDaysView } from "./attendance-days";
import { AttendanceHistory } from "./attendance-history";
import { SitePill } from "./attendance-site-pill";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/hr-api";
import { reportActionError } from "@/lib/action-error";

const shell = pageShell.wide;
const today = () => new Date().toISOString().slice(0, 10);

const metres = (v: unknown) =>
  v == null ? null : `${Math.round(Number(v))} m`;

/* ── Day's clock-ins with lateness ── */
function AttendanceLog({ date }: { date: string }) {
  const log = useResource(() => api.listAttendance({ date }), [date]);
  const cols: Column<api.AttendanceRow>[] = [
    {
      key: "emp",
      label: "Employee",
      render: (r) => (
        <span className="font-medium text-foreground">
          {r.employee_name || "—"}
        </span>
      ),
    },
    {
      key: "in",
      label: "Clock in",
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="num">{dateFmt(r.clock_in_at)}</span>
          {r.is_late && (
            <Pill tone="bad">
              Late{r.minutes_late ? ` ${r.minutes_late}m` : ""}
            </Pill>
          )}
        </span>
      ),
    },
    {
      key: "out",
      label: "Clock out",
      render: (r) =>
        r.clock_out_at ? (
          <span className="num">{dateFmt(r.clock_out_at)}</span>
        ) : (
          <Pill tone="warn">open</Pill>
        ),
    },
    {
      key: "site",
      label: "On-site",
      render: (r) => <SitePill within={r.within_geofence} status={r.location_status} />,
    },
    {
      key: "device",
      label: "Device",
      /*
       * FOUR states, not three. `device_trusted: null` covers two genuinely
       * different facts, and the Devices panel below can tell them apart:
       * recorded-but-unjudged (the `off` policy) versus nothing presented at
       * all. Only "Unapproved" shouts, because it is the only one a manager has
       * to act on.
       */
      render: (r) =>
        r.device_trusted === true ? (
          <Pill tone="ok">Known</Pill>
        ) : r.device_trusted === false ? (
          <Pill tone="warn">Unapproved</Pill>
        ) : r.hr_device_id ? (
          // Recorded, but the `off` policy formed no opinion. Distinct from
          // "nothing presented" below — without this the register lists a
          // device the log row denies, and the two panels contradict.
          <Pill tone="mute">Recorded</Pill>
        ) : (
          <span className="micro">—</span>
        ),
    },
    {
      key: "where",
      label: "Where",
      render: (r) => (
        <span className="text-muted-foreground">
          {r.geo_label || "—"}
          {metres(r.distance_m) ? ` · ${metres(r.distance_m)}` : ""}
        </span>
      ),
    },
  ];
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        Clock-ins
      </h2>
      <DataList
        columns={cols}
        rows={log.data}
        error={log.error}
        loading={log.loading}
        rowKey={(r) => r.attendance_id}
        empty={{
          title: "No clock-ins",
          hint: "Nobody has clocked in on this day.",
        }}
      />
    </div>
  );
}

/* ── Absences for the day ── */
function AbsencePanel({ date }: { date: string }) {
  const a = useResource(() => api.absence(date), [date]);
  const rows = a.data?.absent || [];
  // The day has not been reconciled — so this list is "has not arrived yet",
  // not "was absent". Saying so is the difference between a manager reading a
  // settled fact and reading the 09:00 state of a day still in progress; the
  // old panel presented the second as the first, with most of the company on it.
  const provisional = a.data && a.data.reconciled === false;
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {provisional ? "Not in yet" : "Absent"}{" "}
        <Pill tone={rows.length ? "bad" : "ok"}>{a.data?.count ?? 0}</Pill>
      </h2>
      {provisional && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          This day has not been reconciled. People on approved leave are already
          excluded; everyone else here may simply not have arrived.
        </p>
      )}
      {a.loading ? (
        <div className="py-3 text-center micro">{tr("Loading…")}</div>
      ) : a.error ? (
        <ErrorState message={a.error} />
      ) : rows.length === 0 ? (
        <div className="lux-card p-4 text-sm text-muted-foreground">
          {provisional ? "Everyone expected today has clocked in." : "Nobody was absent."}
        </div>
      ) : (
        <ul className="lux-card divide-y divide-border">
          {rows.map((e) => (
            <li
              key={e.employee_id}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <span className="text-foreground">{e.full_name}</span>
              <span className="micro">{e.department || "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Worksite geofences (admin config) ──
 *
 * THREE WAYS TO PLACE THE PIN, in the order people actually reach for them:
 * search for the address, stand on it, or type the coordinates. The form used to
 * offer only the last two — so defining a yard you were not currently standing
 * in meant leaving the app for a map, and a transposed digit put the geofence in
 * the wrong hemisphere with nothing on screen to contradict it.
 *
 * The search is DEBOUNCED and never fires on mount: each call spends Geoapify
 * quota against a deploy-wide key on a 3,000/day free tier.
 */
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 3;

function PlaceSearch({ onPick }: { onPick: (hit: api.PlaceHit) => void }) {
  const [term, setTerm] = React.useState("");
  const [res, setRes] = React.useState<api.PlaceSearch | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Bumped per search so a slow response cannot overwrite a fast one issued
  // after it — the classic typeahead race.
  const seq = React.useRef(0);

  React.useEffect(() => {
    const q = term.trim();
    if (q.length < MIN_SEARCH_CHARS) {
      setRes(null);
      setError(null);
      return;
    }
    const mine = (seq.current += 1);
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .searchPlaces(q, { limit: 6 })
        .then((r) => {
          if (mine === seq.current) setRes(r);
        })
        .catch((e) => {
          if (mine === seq.current) {
            setRes(null);
            setError(errMsg(e));
          }
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [term]);

  const hits = res?.results ?? [];
  // The provider's own taxonomy, in words the admin can act on. A bare "nothing
  // found" is how an unconfigured key becomes a user who believes their yard
  // does not exist.
  const why =
    res && res.status !== "OK"
      ? api.PLACE_SEARCH_MESSAGE[res.status] || null
      : null;

  return (
    <div className="space-y-2">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search an address or place — e.g. Bonabéri, Douala"
        aria-label="Search for the worksite address"
      />
      <p role="status" aria-live="polite" className="sr-only">
        {loading
          ? "Searching…"
          : hits.length
            ? `${hits.length} places found.`
            : why || ""}
      </p>
      {loading && <p className="micro">Searching…</p>}
      {error && <ErrorState message={error} />}
      {why && !loading && <p className="micro text-muted-foreground">{why}</p>}
      {hits.length > 0 && (
        <ul className="max-h-56 divide-y divide-border overflow-auto rounded-lg border">
          {hits.map((h, i) => (
            <li
              key={h.provider_place_id || `${h.latitude},${h.longitude},${i}`}
            >
              <button
                type="button"
                onClick={() => {
                  onPick(h);
                  setTerm("");
                  setRes(null);
                }}
                className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="block font-medium text-foreground">
                  {h.name || h.formatted}
                </span>
                {h.formatted && h.formatted !== h.name && (
                  <span className="block truncate micro normal-case text-muted-foreground">
                    {h.formatted}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SiteForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    name: "",
    latitude: "",
    longitude: "",
    radius_m: "150",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function useHere() {
    try {
      const fix = await api.getFix();
      setF((s) => ({
        ...s,
        latitude: String(fix.latitude),
        longitude: String(fix.longitude),
      }));
    } catch (e) {
      setError(errMsg(e));
    }
  }
  // The picked place fills the coordinates and SEEDS the name only while it is
  // still blank — retyping the name and then refining the search should not
  // silently undo the rename.
  function pick(h: api.PlaceHit) {
    setF((s) => ({
      ...s,
      name: s.name.trim() || h.name || (h.formatted || "").split(",")[0] || "",
      latitude: String(h.latitude),
      longitude: String(h.longitude),
    }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createSite({
        name: f.name.trim(),
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        radius_m: Number(f.radius_m) || 150,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const placed = f.latitude !== "" && f.longitude !== "";
  const canSave = !!f.name.trim() && placed && !busy;
  return (
    <Modal
      open
      onClose={onClose}
      title="New worksite"
      description="A geofence centre — clock-ins within the radius are on-site."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label="Find the location"
          hint="Search for the address, or use your current position."
        >
          <PlaceSearch onPick={pick} />
        </Field>
        <Button type="button" variant="outline" size="sm" onClick={useHere}>
          Use my current location
        </Button>

        <Field label={tr("Name")} required>
          <Input
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Douala yard"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Latitude")} required>
            <Input
              className="num"
              value={f.latitude}
              onChange={(e) => set("latitude", e.target.value)}
              placeholder="4.0511"
            />
          </Field>
          <Field label={tr("Longitude")} required>
            <Input
              className="num"
              value={f.longitude}
              onChange={(e) => set("longitude", e.target.value)}
              placeholder="9.7679"
            />
          </Field>
          <Field label="Radius (m)">
            <Input
              className="num"
              type="number"
              value={f.radius_m}
              onChange={(e) => set("radius_m", e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!canSave}>
            Add worksite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Worksites() {
  const sites = useResource(() => api.listSites(), []);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  async function toggle(s: api.WorkSite) {
    setBusy(s.work_site_id);
    try {
      await api.updateSite(s.work_site_id, { is_active: !s.is_active });
      sites.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }
  const cols: Column<api.WorkSite>[] = [
    {
      key: "name",
      label: "Worksite",
      render: (s) => (
        <span className="font-medium text-foreground">{s.name}</span>
      ),
    },
    {
      key: "coords",
      label: "Centre",
      render: (s) => (
        <span className="num text-muted-foreground">
          {Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)}
        </span>
      ),
    },
    {
      key: "radius",
      label: "Radius",
      render: (s) => <span className="num">{s.radius_m} m</span>,
    },
    {
      key: "active",
      label: "Active",
      render: (s) => (
        <Pill tone={s.is_active ? "ok" : "mute"}>
          {s.is_active ? "Active" : "Off"}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (s) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            loading={busy === s.work_site_id}
            onClick={() => toggle(s)}
          >
            {s.is_active ? "Disable" : "Enable"}
          </Button>
        </div>
      ),
    },
  ];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Worksites (geofences)
        </h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          New worksite
        </Button>
      </div>
      <DataList
        columns={cols}
        rows={sites.data}
        error={sites.error}
        loading={sites.loading}
        rowKey={(s) => s.work_site_id}
        empty={{
          title: "No worksites",
          hint: "Add one so clock-ins can be checked against it.",
        }}
      />
      {open && (
        <SiteForm onClose={() => setOpen(false)} onSaved={sites.reload} />
      )}
    </div>
  );
}

/* ── Registered devices (0524) ──
 *
 * A queue, not a directory: PENDING rows sort first because the only reason to
 * open this panel is to decide about them. Approving is what makes a device's
 * punches count; blocking is TERMINAL, which is why it asks.
 */
const DEVICE_TONE = { PENDING: "warn", TRUSTED: "ok", REVOKED: "bad" } as const;
const DEVICE_LABEL = {
  PENDING: "Waiting",
  TRUSTED: "Approved",
  REVOKED: "Blocked",
} as const;

/**
 * Click the name, type a real one.
 *
 * Inline rather than a modal because the auto-label is a placeholder that EVERY
 * row carries, so renaming is the common act here, not an exceptional one — and
 * a dialog per device would make the obvious thing the slow thing.
 *
 * Saves on Enter or blur, abandons on Escape. A failed save puts the old name
 * back rather than leaving the typed text sitting there looking saved.
 */
function EditableLabel({
  device,
  onSaved,
}: {
  device: api.HrDevice;
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(device.label);
  const [busy, setBusy] = React.useState(false);

  async function commit() {
    const next = value.trim();
    setEditing(false);
    if (!next || next === device.label) {
      setValue(device.label);
      return;
    }
    setBusy(true);
    try {
      await api.setDeviceStatus(device.hr_device_id, { label: next });
      onSaved();
    } catch (e) {
      setValue(device.label);
      reportActionError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        title="Rename this device"
        className="block max-w-full truncate text-left text-foreground hover:underline disabled:opacity-60"
      >
        {value}
      </button>
    );
  }
  return (
    <Input
      // Focus follows the click that opened it; without this the person has to
      // click the name and then click again into the field.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      aria-label="Device name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
        if (e.key === "Escape") {
          setValue(device.label);
          setEditing(false);
        }
      }}
      className="h-8"
    />
  );
}

function Devices() {
  const devices = useResource(() => api.listDevices(), []);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function decide(d: api.HrDevice, status: "TRUSTED" | "REVOKED") {
    if (
      status === "REVOKED" &&
      !window.confirm(
        `Block "${d.label}"?\n\nIt won't be able to clock ${d.employee_name || "this employee"} in, and it can't be re-approved — it has to be removed and registered again.`,
      )
    )
      return;
    setBusy(d.hr_device_id);
    try {
      await api.setDeviceStatus(d.hr_device_id, { status });
      devices.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }

  const cols: Column<api.HrDevice>[] = [
    {
      key: "who",
      label: "Employee",
      render: (d) => (
        <span className="font-medium text-foreground">
          {d.employee_name || "—"}
        </span>
      ),
    },
    {
      key: "device",
      label: "Device",
      /*
       * EDITABLE, because the auto-label is a placeholder by construction.
       *
       * The server can only ever derive a browser category from the user agent
       * — "Windows · Chrome" is true of every laptop in the company — so it
       * appends four characters of the fingerprint to make the rows DISTINCT.
       * Distinct is not the same as recognisable: "Windows · Chrome · 7f3a"
       * tells a manager which row is which and nothing about whose machine it
       * is.
       *
       * Only a person can supply that, so renaming is one click on the label
       * rather than buried behind an edit screen. It is also why the upsert
       * never overwrites `label`: a name somebody typed must survive that
       * device being seen again.
       */
      render: (d) => (
        <span>
          <EditableLabel
            device={d}
            onSaved={devices.reload}
          />
          {d.platform && (
            <span className="block micro normal-case text-muted-foreground">
              {d.platform}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "seen",
      label: "Last used",
      render: (d) => (
        <span className="num text-muted-foreground">
          {dateFmt(d.last_seen_at)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (d) => (
        <Pill tone={DEVICE_TONE[d.status] || "mute"}>
          {DEVICE_LABEL[d.status] || d.status}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (d) => (
        <div className="flex justify-end gap-1">
          {d.status !== "TRUSTED" && d.status !== "REVOKED" && (
            <Button
              size="sm"
              loading={busy === d.hr_device_id}
              onClick={() => decide(d, "TRUSTED")}
            >
              Approve
            </Button>
          )}
          {d.status !== "REVOKED" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === d.hr_device_id}
              onClick={() => decide(d, "REVOKED")}
            >
              Block
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Registered devices
        </h2>
        <p className="micro normal-case text-muted-foreground">
          Each device an employee clocks in from. A second one appearing is
          worth a look. Names are generated — click one to rename it to
          something you&rsquo;ll recognise. Enforcement is set by
          <span className="font-medium text-foreground">
            {" "}
            hr.device_policy
          </span>{" "}
          — off, warn, or block.
        </p>
      </div>
      <DataList
        columns={cols}
        rows={devices.data}
        error={devices.error}
        loading={devices.loading}
        rowKey={(d) => d.hr_device_id}
        empty={{
          title: "No devices yet",
          hint: "Devices register themselves the first time someone clocks in from them.",
        }}
      />
    </div>
  );
}

type AttendanceView = "day" | "history" | "month";

const VIEWS: { key: AttendanceView; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "history", label: "History & analytics" },
  { key: "month", label: "Reconciled days" },
];

export function AttendancePage() {
  const [date, setDate] = React.useState(today);
  /*
   * The log answers "who badged in today"; the reconciled month answers "what
   * did this cost, and is any of it wrong"; History & analytics (PR2) answers
   * the one neither could — "what does this look like over a period, for the
   * people I pick". Different questions, different windows, so they stay
   * separate views rather than one crowded page.
   *
   * History is the SAME widget My HR and the employee 360 mount, at a wider
   * scope. Three copies of this screen would be three answers to one question.
   */
  const [view, setView] = React.useState<AttendanceView>("day");
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title={tr("Attendance")}
        description="Team clock-ins, lateness and absences. Employees clock in/out from the clock in the title bar (or the floating cluster on a phone)."
      />
      <HubTabs />{" "}
      <div className="chips mb-4">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`chip ${view === v.key ? "on" : ""}`}
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
          >
            {tr(v.label)}
          </button>
        ))}
      </div>
      {view === "day" ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <span className="micro">{tr("Day")}</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-auto"
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
            <AttendanceLog date={date} />
            <AbsencePanel date={date} />
          </div>
          <div className="mt-8">
            <Worksites />
          </div>
          <div className="mt-8">
            <Devices />
          </div>
        </>
      ) : view === "history" ? (
        <AttendanceHistory scope="hr" />
      ) : (
        <AttendanceDaysView />
      )}
      <ScreenAi path="hr/attendance" />
    </section>
  );
}

export default AttendancePage;
