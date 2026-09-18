/**
 * The guest list, inside the event dialog (PR 3).
 *
 * ── WHY THIS LIVES IN THE DIALOG AND NOT ON A DETAIL PAGE ──────────────────
 *
 * There is no event detail page today — the dialog IS the surface that opens
 * an event, and a guest list on a second screen is a round trip for the one
 * thing the organiser actually does ("add Amara and the driver"). The row
 * list and the add controls ride the same react-query cache the rest of the
 * workspace invalidates, so an answer shows up where it was made.
 *
 * ── AUTHORISATION IS SERVER-SIDE ───────────────────────────────────────────
 *
 * The server decides who may add or remove a guest (`canManageEvent`) and who
 * may answer (`respondParticipant` — the invitee, themselves, never the
 * organiser on their behalf). This component only NARROWS: it hides the
 * pencil-and-bin from a reader it already knows cannot manage, and it never
 * renders someone else an answer button. A role the client cannot see (an
 * all-scope manager) gets the controls on attempt and the server's refusal
 * as the message, not a false promise of edit.
 *
 * ── EXTERNAL ATTENDEES ARE A NAME ──────────────────────────────────────────
 *
 * PR 3's recorded scope decision: a guest with no login is a name on the
 * list. There is no email capture, no public-response link — that shape is
 * deferred to a later PR, so the row renders as "Mme Biya (outside the
 * company)" and nothing more. The organiser adds them by name, and removes
 * them when plans change; nobody asks them to RSVP through a link that does
 * not exist yet.
 */
import * as React from "react";
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmployeePicker } from "@/components/employee-picker";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/app/auth/auth-context";
import { errMsg } from "@/lib/use-resource";
import type { CalendarEvent, ParticipantResponse } from "../api";
import {
  useAddParticipant,
  useRemoveParticipant,
  useRespondParticipant,
} from "../hooks";

const EXTERNAL_NAME_MAX = 160;

const RESPONSE_BADGE: Record<ParticipantResponse, string> = {
  INVITED: "Invited",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  TENTATIVE: "Maybe",
};

/** Who is on the list, what they answered, and the controls each reader gets. */
export function ParticipantsSection({
  event,
}: {
  event: CalendarEvent;
  /** Kept in the signature for parity with the row renderer's callers;
   *  the section currently renders responses, not times. */
  timeZone?: string;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const me = user?.user_id ?? null;
  const addP = useAddParticipant();
  const removeP = useRemoveParticipant();
  const respondP = useRespondParticipant();
  const [externalName, setExternalName] = React.useState("");

  const eventId = event.calendar_event_id;
  const participants = event.participants ?? [];
  const myRow = participants.find((p) => p.user_id === me) ?? null;
  const iAmOrganiser =
    myRow?.is_organiser === true || event.created_by === me;
  // Internal ids already on the list, so the picker does not offer a person
  // the form is just about to refuse as a duplicate.
  const chosen = new Set(participants.filter((p) => p.user_id).map((p) => p.user_id as string));
  const busy = addP.isPending || removeP.isPending || respondP.isPending;

  async function addInternal(userId: string, name: string | null) {
    try {
      await addP.mutateAsync({ eventId, input: { user_id: userId } });
      toast.success(name ? `${name} invited` : "Guest invited");
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function addExternal() {
    const name = externalName.trim();
    if (!name) return;
    try {
      await addP.mutateAsync({ eventId, input: { external_name: name } });
      setExternalName("");
      toast.success(`${name} added`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function remove(participantId: string) {
    try {
      await removeP.mutateAsync({ eventId, participantId });
      toast.success("Removed from the list");
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function respond(participantId: string, status: ParticipantResponse) {
    try {
      await respondP.mutateAsync({ eventId, participantId, status });
      toast.success(status === "ACCEPTED" ? "You're in" : status === "DECLINED" ? "Marked declined" : "Marked maybe");
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Field
      label="Who's coming"
      htmlFor="event-external-name"
      hint={
        participants.length
          ? `${participants.length} on the list`
          : "Nobody invited yet — a meeting that loses its guests is a note to yourself."
      }
    >
      <div className="space-y-2">
        {participants.length > 0 && (
          <ul className="divide-y divide-border/60 rounded-md border border-border/60">
            {participants.map((p) => {
              const name = p.user_name ?? p.external_name ?? "Guest";
              const isMe = p.user_id === me && !p.is_organiser;
              return (
                <li
                  key={p.calendar_participant_id}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {name}
                    {p.external_name && (
                      <span className="text-muted-foreground"> (outside the company)</span>
                    )}
                    {p.is_organiser && (
                      <span className="text-muted-foreground"> · organiser</span>
                    )}
                  </span>
                  <span className="micro">{RESPONSE_BADGE[p.response_status]}</span>
                  {isMe && (
                    <span className="flex gap-1">
                      {(["ACCEPTED", "DECLINED", "TENTATIVE"] as const).map((s) =>
                        p.response_status === s ? null : (
                          <Button
                            key={s}
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void respond(p.calendar_participant_id, s)}
                          >
                            {s === "ACCEPTED" ? "Accept" : s === "DECLINED" ? "Decline" : "Maybe"}
                          </Button>
                        ),
                      )}
                    </span>
                  )}
                  {iAmOrganiser && !p.is_organiser && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={busy}
                      aria-label={`Remove ${name}`}
                      onClick={() => void remove(p.calendar_participant_id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {iAmOrganiser && (
          <>
            <EmployeePicker
              id="event-invitee"
              label="Invite"
              placeholder="Search staff by name or job title…"
              requireAccount
              exclude={chosen}
              onPick={(e) => {
                if (!e.account_user_id) return;
                void addInternal(e.account_user_id, e.full_name ?? null);
              }}
            />
            <div className="flex gap-2">
              <Input
                id="event-external-name"
                value={externalName}
                maxLength={EXTERNAL_NAME_MAX}
                placeholder="Someone outside the company — a name is enough"
                onChange={(e) => setExternalName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addExternal();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !externalName.trim()}
                onClick={() => void addExternal()}
              >
                Add
              </Button>
            </div>
          </>
        )}
      </div>
    </Field>
  );
}
