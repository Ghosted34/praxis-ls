/**
 * Meetings (MOD-21) — typed access to the Client Discovery Framework.
 *
 * Kept here rather than inline in the component (FRONTEND_GUIDE §3.4) because
 * three surfaces read the same shapes: the meeting drawer, the dictation hook,
 * and — once F4 lands — the proposal generator, which asks for a LEAD's latest
 * discovery set without knowing which meeting it came from.
 */
import { tenant } from "@/lib/api-client";

export const SECTION_ORDER = [
  "OPERATIONS",
  "PAIN_POINTS",
  "STRATEGY",
] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

/**
 * TRANSCRIPTION_FAILED is the state that earns this union. A section that had
 * audio and produced no text must not read the same as one nobody filled in.
 */
export type CaptureState =
  | "EMPTY"
  | "TYPED"
  | "DICTATING"
  | "TRANSCRIBED"
  | "TRANSCRIPTION_FAILED";

export type DiscoveryPrompt = {
  meeting_discovery_prompt_id: string;
  prompt_en: string;
  prompt_fr: string;
  sort_order: number;
};

export type DiscoverySection = {
  section_key: SectionKey;
  seq?: number;
  label_en?: string;
  label_fr?: string;
  body: string | null;
  capture_state: CaptureState;
  dictation_error: string | null;
  transcript_vault_id: string | null;
  audio_seconds: number | null;
  prompts?: DiscoveryPrompt[];
};

export type MeetingDiscovery = {
  meeting_id: string;
  subject: string;
  scheduled_at: string | null;
  location: string | null;
  lead_id: string | null;
  client_id: string | null;
  sections: DiscoverySection[];
};

/** The framework as configuration: the three sections and the tenant's own
 *  probing questions, without a meeting to hang them on. Read by the one-step
 *  capture wizard, which prints the questions BEFORE a record exists. */
export type FrameworkSection = {
  key: SectionKey;
  seq: number;
  label_en: string;
  label_fr: string;
  prompts: DiscoveryPrompt[];
};

export const fetchFramework = () =>
  tenant<FrameworkSection[]>("/meetings/discovery/prompts");

export const createMeeting = (body: Record<string, unknown>) =>
  tenant<{ meeting_id: string; subject: string }>("/meetings", {
    method: "POST",
    body,
  });

export const fetchDiscovery = (meetingId: string) =>
  tenant<MeetingDiscovery>(`/meetings/${meetingId}/discovery`);

export const saveDiscoverySection = (
  meetingId: string,
  section: SectionKey,
  body: string,
) =>
  tenant<DiscoverySection>(`/meetings/${meetingId}/discovery/${section}`, {
    method: "PUT",
    body: { body },
  });

/** 202 — the transcript is not here yet. Poll `fetchDiscovery` for the landing. */
export const dictateDiscoverySection = (
  meetingId: string,
  section: SectionKey,
  audioDataUrl: string,
) =>
  tenant<{ job_id: string; section: DiscoverySection }>(
    `/meetings/${meetingId}/discovery/${section}/dictate`,
    { method: "POST", body: { audio: audioDataUrl } },
  );

export const updateMeeting = (
  meetingId: string,
  patch: Record<string, unknown>,
) => tenant(`/meetings/${meetingId}`, { method: "PATCH", body: patch });

/** The read F4 will make: the client's own words, latest first. */
export const fetchLeadDiscovery = (leadId: string) =>
  tenant<MeetingDiscovery | null>(`/meetings/discovery/lead/${leadId}`);
