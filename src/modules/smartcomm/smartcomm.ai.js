"use strict";
const service = require("./smartcomm.service");
const validator = require("./smartcomm.validator");
const pipeline = require("./smartcomm.call.pipeline.service");
module.exports = {
  entity: "comms_group", module_key: "MOD-64", screens: [],
  reads: [
    { key: "list_comms_channels", service: (c, p, caller) => service.listChannels(c, caller, p), permission: { module: "MOD-64", action: "view" }, describe: "Channels the user belongs to (with unread counts)." },
    { key: "comms_unread", service: (c, p, caller) => service.unread(c, caller), permission: { module: "MOD-64", action: "view" }, describe: "Per-channel unread counts for the user." },
    { key: "search_comms", service: (c, p, caller) => service.search(c, { actor: caller, term: p.q }), permission: { module: "MOD-64", action: "view" }, describe: "Search messages across the user's channels." },
    // The call record half (PR-2), READ-ONLY on purpose. The assistant may read
    // a call it is a participant of — the same rule the screen enforces — and it
    // carries its PROVENANCE with it, because "the transcript says" means
    // something different when the words came from the browser's in-call
    // recogniser rather than from a certified transcription of the audio.
    { key: "comms_call_transcript", service: (c, p, caller) => pipeline.getTranscript(c, { callId: p.call_id, actor: caller }), permission: { module: "MOD-64", action: "view" }, describe: "The attributed transcript of one of the user's own calls, with its state and provenance (participants only)." },
    { key: "comms_call_summary", service: (c, p, caller) => pipeline.getSummary(c, { callId: p.call_id, actor: caller }), permission: { module: "MOD-64", action: "view" }, describe: "The summary draft or posted summary of one of the user's own calls, with its language and provenance (participants only)." },
  ],
  writes: [
    { key: "create_comms_channel", service: (c, p, actor) => service.createChannel(c, { data: p, actor }), schema: validator.schemas.channel, permission: { module: "MOD-64", action: "create" }, confirm: true, describe: "Create a channel (department/project/file/direct/client)." },
    { key: "post_comms_message", service: (c, p, actor) => service.postMessage(c, { groupId: p.group_id, body: p.body, actor }), schema: validator.schemas.message, permission: { module: "MOD-64", action: "create" }, confirm: true, describe: "Post a message to a channel." },
  ],
};
