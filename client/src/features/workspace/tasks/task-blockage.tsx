/**
 * The blockage box (13975) — "I am blocked, and here is why", on the task panel.
 *
 * ── HIDDEN UNTIL TRUE ──────────────────────────────────────────────────────
 *
 * A task with no hold shows ONE affordance: `+ Add Blockage`. Nothing about
 * blockages occupies the panel until somebody has one, because a permanent
 * "blockage" chrome on every task teaches people to skip over it — the same
 * reason a fire extinguisher is behind a door and not on the table. With a
 * live hold, the section becomes a COLLAPSED header (pill + the note's first
 * line + since when): the fact is visible at a glance, the detail is one tap
 * away, and a panel holding a five-line hold story still fits on a phone.
 *
 * ── THE EXPLAINER: HOVER ON DESKTOP, ⓘ ON TOUCH ────────────────────────────
 *
 * The coaching sentence ("register it — it counts for your review even when
 * the task is overdue, and the due date moves when you resolve it") is a
 * hover tooltip on desktop and a tap-popover behind an ⓘ icon on touch,
 * because hover does not exist on the phones this ERP is actually used on.
 * Both drive the same popover state, so there is one explainer, not two
 * copies that can drift.
 *
 * ── RESOLVE MOVES THE DUE DATE ─────────────────────────────────────────────
 *
 * The Resolve button closes the hold and the server moves an open task's due
 * date forward by exactly the blocked duration. The confirmation says so in
 * words before the click, because a deadline that moves without warning is a
 * surprise, and a surprise in a logistics ERP is a phone call.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { EmployeePicker } from "@/components/employee-picker";
import { errMsg } from "@/lib/use-resource";
import { dateTimeFmt } from "@/lib/format";
import { listChannels, type Channel } from "@/lib/smartcomm-api";
import type { Audience, Task } from "../api";
import { useRaiseBlockage, useResolveBlockage } from "../hooks";

const EXPLAINER =
  "Are you blocked in the execution of this file? Register the blockage — it counts " +
  "for your performance review even when the task is overdue, and resolving it moves " +
  "the due date by the time you were blocked.";

type Person = { user_id: string; name: string };
type ChannelPick = { group_id: string; name: string };

export function BlockageSection({ task, audience }: { task: Task; audience?: Audience }) {
  const toast = useToast();
  const raise = useRaiseBlockage();
  const resolve = useResolveBlockage();

  const active = task.blockage ?? null;
  const history = (task.blockages ?? []).filter((b) => b.resolved_at);
  const closed = task.status === "DONE" || task.status === "CANCELLED";

  const [composing, setComposing] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  // Hover (desktop) and the ⓘ pin (touch) are SEPARATE states composing one
  // visible popover. Merging them into a single toggle breaks on touch: a tap
  // synthesises a mouseenter before the click, so "hover opens, click toggles"
  // closes the popover the finger just asked for.
  const [tipHover, setTipHover] = React.useState(false);
  const [tipPinned, setTipPinned] = React.useState(false);
  const tipOpen = tipHover || tipPinned;
  const tipWrapRef = React.useRef<HTMLSpanElement>(null);

  // Pinned tooltip must dismiss on outside tap/click or Escape — otherwise it
  // stays permanently after the ⓘ is tapped (bug report Sept 20 screenshot:
  // the EXPLAINER popover covered the panel and could not be closed without
  // tapping ⓘ again). Hover alone is fine; only the pinned (touch) path
  // needs the outside handler. Also cleans up on unmount.
  React.useEffect(() => {
    if (!tipPinned) return;
    const onDocDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (tipWrapRef.current && !tipWrapRef.current.contains(target)) {
        setTipPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTipPinned(false);
        setTipHover(false);
      }
    };
    document.addEventListener("mousedown", onDocDown as unknown as EventListener);
    document.addEventListener("touchstart", onDocDown as unknown as EventListener);
    document.addEventListener("keydown", onKey as unknown as EventListener);
    return () => {
      document.removeEventListener("mousedown", onDocDown as unknown as EventListener);
      document.removeEventListener("touchstart", onDocDown as unknown as EventListener);
      document.removeEventListener("keydown", onKey as unknown as EventListener);
    };
  }, [tipPinned]);

  const [note, setNote] = React.useState("");
  const [eta, setEta] = React.useState("");
  const [people, setPeople] = React.useState<Person[]>([]);
  const [channels, setChannels] = React.useState<ChannelPick[]>([]);
  const [resolveNote, setResolveNote] = React.useState("");

  // The raiser's SmartComm groups, loaded only when the composer opens: a
  // panel render must not cost a comms round trip nobody asked for.
  const [groupOptions, setGroupOptions] = React.useState<ChannelPick[]>([]);
  React.useEffect(() => {
    if (!composing) return;
    let live = true;
    listChannels()
      .then((list) => {
        if (!live) return;
        setGroupOptions(
          (list || [])
            .filter((c: Channel) => c.kind !== "DIRECT")
            .map((c: Channel) => ({ group_id: c.group_id, name: c.name })),
        );
      })
      .catch((err) => {
        // Class E (degraded read): the channel chooser is a courtesy on top of
        // the raise, so its absence hides the chooser rather than blocking the
        // hold — but a read that failed is visible to us, not swallowed.
        console.warn("[workspace] blockage composer: channel list unavailable", err);
        setGroupOptions([]);
      });
    return () => {
      live = false;
    };
  }, [composing]);

  if (!active && history.length === 0 && closed) return null;

  const submitRaise = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      toast.error("Say what is blocking the work — a blockage with no note is a badge with nothing behind it.");
      return;
    }
    try {
      const res = await raise.mutateAsync({
        taskId: task.task_id,
        note: trimmed,
        estimatedResolveAt: eta || null,
        notifyUserIds: people.length ? people.map((p) => p.user_id) : undefined,
        channelIds: channels.length ? channels.map((c) => c.group_id) : undefined,
        audience,
      });
      toast.success(
        res.notified > 0
          ? `Blockage registered — ${res.notified} ${res.notified === 1 ? "person" : "people"} told by notification and SmartComm${res.channels_posted.length ? `, ${res.channels_posted.length} channel(s) posted` : ""}.`
          : "Blockage registered — the task now carries the hold.",
      );
      setComposing(false);
      setNote("");
      setEta("");
      setPeople([]);
      setChannels([]);
    } catch (err) {
      toast.error(errMsg(err) || "Could not register the blockage");
    }
  };

  const submitResolve = async () => {
    if (!active) return;
    try {
      const res = await resolve.mutateAsync({
        taskId: task.task_id,
        blockageId: active.task_blockage_id,
        resolveNote: resolveNote.trim() || null,
        audience,
      });
      toast.success(
        res.new_due_at
          ? `Blockage resolved — due date moved to ${dateTimeFmt(res.new_due_at)} by the blocked time.`
          : "Blockage resolved — the task is unblocked.",
      );
      setResolving(false);
      setResolveNote("");
      setExpanded(false);
    } catch (err) {
      toast.error(errMsg(err) || "Could not resolve the blockage");
    }
  };

  return (
    <section aria-label="Blockages" className="space-y-2 rounded-lg border border-border p-3">
      {active ? (
        <>
          {/* THE COLLAPSED HEADER: the fact at a glance, the story one tap away. */}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            <Pill tone="warn">Blocked</Pill>
            <span className="min-w-0 flex-1 truncate text-sm">{active.note}</span>
            <span className="micro shrink-0 text-muted-foreground">
              {expanded ? "Collapse" : "Expand"} · since {dateTimeFmt(active.raised_at)}
            </span>
          </button>

          {expanded && (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap text-sm">{active.note}</p>
              <p className="micro text-muted-foreground">
                Raised by {active.raised_by_name || "someone"} · {dateTimeFmt(active.raised_at)}
                {active.estimated_resolve_at && (
                  <>
                    {" · expected to clear "}
                    {dateTimeFmt(active.estimated_resolve_at)}
                    {new Date(active.estimated_resolve_at).getTime() < Date.now() && " (forecast passed)"}
                  </>
                )}
              </p>

              {!closed &&
                (resolving ? (
                  <div className="space-y-2 rounded-md border border-border p-2">
                    <p className="text-sm">
                      Resolving moves the due date forward by the time you were blocked
                      (since {dateTimeFmt(active.raised_at)}).
                    </p>
                    <Input
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="Resolution note (optional) — e.g. network restored at Douala customs"
                      aria-label="Resolution note"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={submitResolve} disabled={resolve.isPending}>
                        Resolve blockage
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResolving(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setResolving(true)}>
                    Resolve blockage
                  </Button>
                ))}
            </div>
          )}
        </>
      ) : (
        !closed && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Hover (desktop) and the ⓘ tap (touch) drive ONE popover state —
                see the header: one explainer, two gestures. The span only
                watches the pointer to auto-open/close on desktop; the ACCESS
                path is the ⓘ button beside it, which is a real button and
                carries aria-expanded — hover is an enhancement, never the
                only way in. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <span
              ref={tipWrapRef}
              className="relative inline-flex"
              onMouseEnter={() => setTipHover(true)}
              onMouseLeave={() => setTipHover(false)}
            >
              <Button size="sm" variant="outline" onClick={() => setComposing((v) => !v)}>
                + Add Blockage
              </Button>
              <button
                type="button"
                aria-label="About blockages"
                aria-expanded={tipOpen}
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-muted-foreground"
                onClick={() => setTipPinned((v) => !v)}
              >
                i
              </button>
              {tipOpen && (
                <span
                  role="tooltip"
                  className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
                >
                  {EXPLAINER}
                </span>
              )}
            </span>
          </div>
        )
      )}

      {composing && !active && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <p className="text-xs text-muted-foreground">{EXPLAINER}</p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What is blocking the work? e.g. held at customs — network down since Tuesday"
            aria-label="Blockage note"
            rows={2}
          />
          {/* The house DateTimeField, not a native `datetime-local`: the
              native control renders its DATE part in the OS locale, and this
              corridor reads day-first — the date-format gate enforces it. */}
          <label htmlFor="blockage-eta" className="micro text-muted-foreground">
            Expected to clear by (optional)
          </label>
          <DateTimeField id="blockage-eta" value={eta} onChange={setEta} />
          <div className="space-y-1">
            <p className="micro text-muted-foreground">
              Tell someone (they get a forced notification and a SmartComm message):
            </p>
            <EmployeePicker
              requireAccount
              label="Add person"
              exclude={new Set(people.map((p) => p.user_id))}
              onPick={(emp) => {
                const id = emp.account_user_id;
                if (!id) return;
                setPeople((prev) =>
                  prev.some((p) => p.user_id === id)
                    ? prev
                    : [...prev, { user_id: id, name: emp.full_name || emp.email || "Someone" }],
                );
              }}
            />
            {people.map((p) => (
              <span key={p.user_id} className="mr-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                {p.name}
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPeople((prev) => prev.filter((x) => x.user_id !== p.user_id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
          {groupOptions.length > 0 && (
            <div className="space-y-1">
              <p className="micro text-muted-foreground">Post to a SmartComm channel:</p>
              {groupOptions
                .filter((g) => !channels.some((c) => c.group_id === g.group_id))
                .slice(0, 8)
                .map((g) => (
                  <button
                    key={g.group_id}
                    type="button"
                    className="mr-1 rounded-full border border-border px-2 py-0.5 text-xs"
                    onClick={() => setChannels((prev) => [...prev, g])}
                  >
                    + {g.name}
                  </button>
                ))}
              {channels.map((c) => (
                <span key={c.group_id} className="mr-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                  {c.name}
                  <button type="button" aria-label={`Remove ${c.name}`} onClick={() => setChannels((prev) => prev.filter((x) => x.group_id !== c.group_id))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={submitRaise} disabled={raise.isPending}>
              Register blockage
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="micro cursor-pointer text-muted-foreground">
            Past blockages ({history.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {history.map((b) => (
              <li key={b.task_blockage_id} className="rounded-md border border-border p-2">
                <p className="text-sm">{b.note}</p>
                <p className="micro text-muted-foreground">
                  {dateTimeFmt(b.raised_at)} → {b.resolved_at ? dateTimeFmt(b.resolved_at) : "—"}
                  {b.due_shift ? ` · due date moved by ${b.due_shift}` : ""}
                  {b.resolved_by_name ? ` · resolved by ${b.resolved_by_name}` : ""}
                </p>
                {b.resolve_note && <p className="text-xs text-muted-foreground">{b.resolve_note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
