"use strict";
const service = require("./notification.service");
module.exports = {
  entity: "notification", module_key: "MOD-70", screens: [],
  reads: [
    { key: "my_notifications", service: (c, p) => service.mine(c, { user_id: p.user_id }, p), describe: "The caller's own notifications (filter unread/channel)." },
    { key: "my_unread_count", service: (c, p) => service.unreadCount(c, { user_id: p.user_id }), describe: "Count of the caller's unread notifications." },
  ],
  writes: [],
};
