# Calls — data processing annex (sub-processors)

The tenant data-processing agreement (DPA) is a signed legal document and is
not kept in this repository. This annex is the part of it the **code** decides:
which outside companies receive call data, what they receive, and when. Cite it
from the DPA's sub-processor schedule, and change it in the same PR as any
change to the vendors below (calls audit PR-6, G2).

The running product says the same thing to the people on the call: the ring
screen's consent line and Settings → Calls → "How calls are processed" both
read `GET /smartcomm/calls/processing`, which lists only the vendors that are
**configured** on the server (`processingDisclosure` in
`src/modules/smartcomm/smartcomm.call.service.js`). A vendor with no API key
receives nothing and is not listed.

## Nothing leaves Praxis unless the tenant turns recording on

Call recording is **off** for a tenant until its settings administrator turns
it on (Settings → Calls → "Record and summarise calls",
`comms.call_recording.enabled`), and the `call_recording` feature must also be
on. Even then, the person being called can choose **Answer without recording**;
the server records that choice on the call (`comms_call.recording_declined_at`)
and neither side records.

## Who receives what

| Company | Country | Receives | When |
| --- | --- | --- | --- |
| Groq | United States | The call's recorded audio, in parts | First choice for transcription |
| Google (Gemini) | United States | The call's recorded audio | Only when Groq fails or is at its limit (O1: Groq once, then Gemini once) |
| Google (Gemini) | United States | The call's transcript | First choice for the summary |
| DeepSeek | China | The call's transcript | Only when Gemini is unavailable (last resort) |
| Google (STUN) | United States | The two devices' network addresses — no audio | Connection set-up, only when the company has no call relay (TURN) of its own |

The live audio of the call itself goes device to device, or through the
company's own relay when "Relay-only calls" is on. It is not sent to any of the
companies above while the call is in progress.

## How long it is kept

| Data | Kept | Setting |
| --- | --- | --- |
| Recorded audio | 1–365 days, default 30, then deleted by the record sweep | `comms.call_recording.retention_days` |
| Transcript, live notes, unsent summary drafts | With the conversation, unless the tenant sets 30–3650 days | `comms.call_recording.transcript_retention_days` |
| A summary already sent to a conversation | As a message in that conversation | — |

## Erasure

A settings administrator (MOD-70 edit) can erase one person's call records from
Settings → Calls (`POST /smartcomm/calls/erase-user`). It deletes the audio,
transcripts, live notes and unsent drafts of every call the person was on, for
both sides, in the environment it is run in, and writes a
`CALL_RECORDS_ERASED` audit event. Summaries already sent to a conversation are
messages and stay; delete them as messages if the request covers them.
