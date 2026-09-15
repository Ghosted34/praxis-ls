/**
 * My Workspace — the words and tones a task or event is drawn with.
 *
 * ── WHY THE LABELS ARE HERE AND NOT IN THE DATABASE ────────────────────────
 *
 * The enum is in the database and it is a state machine: `IN_REVIEW` means the
 * same thing everywhere and code branches on it. The LABEL is a sentence a
 * person reads, and it belongs with the other sentences — beside `tr()`, where
 * it can be translated and where a copy change does not need a migration.
 *
 * Tones are the UI kit's (`ok | warn | bad | blue | orange | mute`), never a
 * hex or a raw palette class: this is a white-label product and the colour a
 * tenant sees is theirs, resolved from `--primary` and friends at runtime.
 */
import type { Tone } from "@/components/ui/pill";
import type { BoardColumn, ParticipantResponse, TaskPriority, TaskStatus } from "./api";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TO_DO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  TO_DO: "mute",
  IN_PROGRESS: "blue",
  IN_REVIEW: "warn",
  DONE: "ok",
  CANCELLED: "bad",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  LOW: "mute",
  NORMAL: "mute",
  HIGH: "warn",
  URGENT: "bad",
};

export const COLUMN_LABEL: Record<BoardColumn, string> = {
  TO_DO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};

export const RESPONSE_LABEL: Record<ParticipantResponse, string> = {
  INVITED: "Invited",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  TENTATIVE: "Maybe",
};

export const RESPONSE_TONE: Record<ParticipantResponse, Tone> = {
  INVITED: "mute",
  ACCEPTED: "ok",
  DECLINED: "bad",
  TENTATIVE: "warn",
};

/**
 * What the audience switch says.
 *
 * "Everyone" rather than "All": the switch is a person's choice about whose
 * work they are looking at, and "All" reads like a filter that has been
 * cleared rather than one that has been widened.
 */
export const AUDIENCE_LABEL = {
  mine: "My work",
  team: "My team",
  all: "Everyone",
} as const;

/**
 * The event types the picker offers.
 *
 * An OPEN list on purpose, mirroring the column: `event_type` selects a colour
 * and a filter chip, nothing branches on it, so a tenant whose business does
 * something new adds a word here rather than waiting for a migration. Types
 * outside this list still render — `eventTypeTone` falls back rather than
 * throwing, because a row written by another client is not an error.
 */
export const EVENT_TYPE_OPTIONS = [
  "meeting",
  "call",
  "appointment",
  "delivery",
  "pickup",
  "visit",
  "review",
  "training",
  "deadline",
  "reminder",
  "other",
] as const;

const EVENT_TYPE_TONE: Record<string, Tone> = {
  meeting: "blue",
  call: "blue",
  appointment: "blue",
  delivery: "orange",
  pickup: "orange",
  visit: "orange",
  review: "warn",
  training: "ok",
  deadline: "bad",
  reminder: "mute",
  other: "mute",
};

export function eventTypeTone(type: string | null | undefined): Tone {
  return EVENT_TYPE_TONE[String(type || "").toLowerCase()] ?? "mute";
}

/** "Client fitting" → "Client fitting"; "service_booking" → "Service booking". */
export function humanizeType(type: string | null | undefined): string {
  const s = String(type || "").trim();
  if (!s) return "Other";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[_-]+/g, " ");
}

/**
 * Reminder presets, in minutes before the anchor.
 *
 * `null` is "at the time" (zero minutes is a real choice, and distinct from
 * "no reminder" which is the absence of the field entirely). The day-long
 * presets are expressed in minutes too — the server derives `remind_at` from
 * the anchor, so a preset that moves the due date moves the reminder with it.
 */
export const REMINDER_PRESETS = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At the time" },
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "180", label: "3 hours before" },
  { value: "1440", label: "1 day before" },
  { value: "10080", label: "1 week before" },
] as const;
