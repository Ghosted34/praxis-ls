"use strict";
module.exports = { MODULE: "MOD-22", CREATED: "campaign.created", SUBSCRIBED: "newsletter.subscribed", UNSUBSCRIBED: "newsletter.unsubscribed",
  transition: (status) => "campaign." + String(status).toLowerCase() };
