"use strict";
const service = require("./smartcomm.service");
const validator = require("./smartcomm.validator");
const pipeline = require("./smartcomm.call.pipeline.service");
const calls = require("./smartcomm.call.service");
const { AppError } = require("../../utils/errors");

/**
 * The HTTP routes for calls sit behind the `calls` feature and the records
 * behind `call_recording`; the assistant's reads must too (audit C10), or
 * switching recording off would not stop the AI quoting a transcript.
 */
async function requireFeature(client, key) {
  const { rows } = await client.query("SELECT state FROM feature_state WHERE feature_key = $1", [key]);
  if (!rows[0] || rows[0].state !== "on") {
    throw new AppError("FEATURE_DISABLED", "This feature is switched off for your company", 403);
  }
}
module.exports = {
  entity: "comms_group", module_key: "MOD-64", screens: [],
  reads: [
    { key: "list_comms_channels", service: (c, p, caller) => service.listChannels(c, caller, p), permission: { module: "MOD-64", action: "view" }, describe: "Channels the user belongs to (with unread counts)." },
    { key: "comms_unread", service: (c, p, caller) => service.unread(c, caller), permission: { module: "MOD-64", action: "view" }, describe: "Per-channel unread counts for the user." },
    { key: "search_comms", service: (c, p, caller) => service.search(c, { actor: caller, term: p.q }), permission: { module: "MOD-64", action: "view" }, describe: "Search messages across the user's channels." },
    // The call record half (PR-2), READ-ONLY on purpose. The assistant may read
    // a call it is a participant of — the same rule the screen enforces — and it
    // carries its PROVENANCE and its missing minutes with it, because "the
    // transcript says" means less when part of the call was not transcribed.
    { key: "list_comms_calls", service: async (c, p, caller) => { await requireFeature(c, "calls"); return calls.listCalls(c, caller); }, permission: { module: "MOD-64", action: "view" }, describe: "The user's own 1:1 calls, newest first, with the other person, duration, outcome, transcription state and summary status (call ids for the two reads below)." },
    { key: "comms_call_transcript", service: async (c, p, caller) => { await requireFeature(c, "call_recording"); return pipeline.getTranscript(c, { callId: p.call_id, actor: caller }); }, permission: { module: "MOD-64", action: "view" }, describe: "The attributed transcript of one of the user's own calls, with its state, provenance, each recorded part's status and the minutes that could not be transcribed (participants only)." },
    { key: "comms_call_summary", service: async (c, p, caller) => { await requireFeature(c, "call_recording"); return pipeline.getSummary(c, { callId: p.call_id, actor: caller }); }, permission: { module: "MOD-64", action: "view" }, describe: "The summary draft or posted summary of one of the user's own calls, with its language, provenance and the minutes missing from its transcript (participants only)." },
  ],
  writes: [
    { key: "create_comms_channel", service: (c, p, actor) => service.createChannel(c, { data: p, actor }), schema: validator.schemas.channel, permission: { module: "MOD-64", action: "create" }, confirm: true, describe: "Create a channel (department/project/file/direct/client)." },
    { key: "post_comms_message", service: (c, p, actor) => service.postMessage(c, { groupId: p.group_id, body: p.body, actor }), schema: validator.schemas.message, permission: { module: "MOD-64", action: "create" }, confirm: true, describe: "Post a message to a channel." },
  ],
};
