"use strict";
const service = require("./smartcomm.service");
const validator = require("./smartcomm.validator");
module.exports = {
  entity: "comms_group", module_key: "MOD-64", screens: [],
  reads: [
    { key: "list_comms_channels", service: (c, p) => service.listChannels(c, { user_id: p.user_id }, p), describe: "Channels the user belongs to (with unread counts)." },
    { key: "comms_unread", service: (c, p) => service.unread(c, { user_id: p.user_id }), describe: "Per-channel unread counts for the user." },
    { key: "search_comms", service: (c, p) => service.search(c, { actor: { user_id: p.user_id }, term: p.q }), describe: "Search messages across the user's channels." },
  ],
  writes: [
    { key: "create_comms_channel", service: (c, p) => service.createChannel(c, { data: p, actor: { user_id: p.user_id } }), schema: validator.schemas.channel, permission: { module: "MOD-64", action: "create" }, confirm: true, describe: "Create a channel (department/project/dossier/direct/client)." },
    { key: "post_comms_message", service: (c, p) => service.postMessage(c, { groupId: p.group_id, body: p.body, actor: { user_id: p.user_id } }), schema: validator.schemas.message, permission: { module: "MOD-64", action: "create" }, confirm: true, describe: "Post a message to a channel." },
  ],
};
