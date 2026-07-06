/**
 * Meta WhatsApp Cloud API client (V2.2 §6.17).
 * Webhook-based: inbound messages arrive at /api/webhooks/meta/whatsapp;
 * outbound goes through here.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");

async function sendText({ to, body }) {
  const url = `https://graph.facebook.com/v18.0/${config.META_WA_PHONE_ID}/messages`;
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body } },
    { headers: { Authorization: `Bearer ${config.META_WA_TOKEN}` } },
  );
}

async function sendTemplate({ to, template_name, language_code, components }) {
  const url = `https://graph.facebook.com/v18.0/${config.META_WA_PHONE_ID}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template_name,
        language: { code: language_code || "en" },
        components,
      },
    },
    { headers: { Authorization: `Bearer ${config.META_WA_TOKEN}` } },
  );
}

module.exports = { sendText, sendTemplate };
