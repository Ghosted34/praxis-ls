/**
 * GmailProvider — Phase 2 adapter (native, axios; no googleapis dep). Same
 * EmailProvider contract as the others. Token is externalized via getAccessToken()
 * (mail.service refreshes + persists the vault bundle).
 *
 *   new GmailProvider({ getAccessToken, emailAddress })
 *
 * Inbound uses Gmail's history delta (cursor = { history_id }); on the first run
 * (or when the stored historyId is too old / 404) it seeds from a recent INBOX
 * list and records the profile historyId. Gmail files sent mail itself → no
 * appendSent. Threads are server-side (threadId).
 */
"use strict";

const axios = require("axios");
const { baseCapabilities } = require("./provider.interface");

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const SEED_MAX = 25;
const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

const b64urlDecode = (data) => Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64urlEncode = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const emailsIn = (s) => (String(s || "").match(/[^\s<>@,]+@[^\s<>@,]+/g) || []);

class GmailProvider {
  constructor({ getAccessToken, emailAddress } = {}) {
    if (typeof getAccessToken !== "function") throw new Error("GmailProvider needs getAccessToken()");
    this._getToken = getAccessToken;
    this.emailAddress = emailAddress;
    this.provider = "google_gmail";
  }

  capabilities() {
    return { ...baseCapabilities(), push: false, delta: true, serverThreads: true, appendSent: false };
  }

  async _req(method, path, { data, params } = {}) {
    const token = await this._getToken();
    const url = path.startsWith("http") ? path : BASE + path;
    return axios({ method, url, params, data, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  }

  async verify() {
    try {
      const r = await this._req("GET", "/profile");
      return { ok: true, email: r.data.emailAddress, historyId: r.data.historyId };
    } catch (err) {
      return { ok: false, error: gmailError(err) };
    }
  }

  async _composeRaw(mail) {
     
    const nodemailer = require("nodemailer");
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
    const info = await composer.sendMail(mail);
    return b64urlEncode(info.message);
  }

  async sendEmail(msg) {
    const raw = await this._composeRaw({
      from: msg.from || this.emailAddress, to: msg.to, cc: msg.cc, subject: msg.subject,
      html: msg.bodyHtml || undefined, text: msg.bodyText || undefined,
      inReplyTo: msg.inReplyTo, references: msg.references,
    });
    const body = { raw };
    if (msg.threadId) body.threadId = msg.threadId;
    const r = await this._req("POST", "/messages/send", { data: body });
    return { externalMessageId: r.data.id, threadKey: r.data.threadId };
  }

  /** Reply in-thread: fetch the original's RFC Message-ID + threadId, then send a
   *  raw message with In-Reply-To/References set and the same threadId. */
  async createReply(externalMessageId, msg) {
    const meta = await this._req("GET", `/messages/${externalMessageId}`, {
      params: { format: "metadata", metadataHeaders: ["Message-ID", "Subject", "From", "References"] },
    });
    const headers = (meta.data.payload && meta.data.payload.headers) || [];
    const h = (n) => { const f = headers.find((x) => x.name.toLowerCase() === n.toLowerCase()); return f ? f.value : null; };
    const origMsgId = h("Message-ID");
    const refs = [h("References"), origMsgId].filter(Boolean).join(" ").trim();
    return this.sendEmail({
      ...msg,
      to: msg.to || emailsIn(h("From"))[0],
      subject: msg.subject,
      inReplyTo: origMsgId || undefined,
      references: refs ? refs.split(/\s+/) : undefined,
      threadId: meta.data.threadId,
    });
  }

  async fetchSince(cursor) {
    if (!cursor || !cursor.history_id) return this._seed();
    try {
      const ids = new Set();
      let pageToken = null;
      let latestHistoryId = cursor.history_id;
      for (let i = 0; i < 50; i += 1) {
         
        const r = await this._req("GET", "/history", {
          params: { startHistoryId: cursor.history_id, historyTypes: "messageAdded", labelId: "INBOX", pageToken: pageToken || undefined },
        });
        for (const hrec of r.data.history || []) {
          for (const added of hrec.messagesAdded || []) if (added.message && added.message.id) ids.add(added.message.id);
        }
        if (r.data.historyId) latestHistoryId = r.data.historyId;
        if (r.data.nextPageToken) { pageToken = r.data.nextPageToken; continue; }
        break;
      }
      const messages = await this._getMany([...ids]);
      return { messages, nextCursor: { history_id: latestHistoryId } };
    } catch (err) {
      // 404 → the stored historyId aged out of Gmail's window; re-seed.
      if (err && err.response && err.response.status === 404) return this._seed();
      throw err;
    }
  }

  /** First run / recovery: list recent INBOX messages and anchor on profile historyId. */
  async _seed() {
    const prof = await this._req("GET", "/profile");
    const list = await this._req("GET", "/messages", { params: { labelIds: "INBOX", maxResults: SEED_MAX } });
    const ids = (list.data.messages || []).map((m) => m.id);
    const messages = await this._getMany(ids);
    return { messages, nextCursor: { history_id: prof.data.historyId } };
  }

  async _getMany(ids) {
    const out = [];
    for (const id of ids) {
       
      const m = await this.getMessage(id);
      if (m) out.push(m);
    }
    return out;
  }

  async getMessage(externalMessageId) {
    const r = await this._req("GET", `/messages/${externalMessageId}`, { params: { format: "full" } });
    const n = this._normalize(r.data);
    if (n.attachments.length) n.attachments = await this._hydrateAttachments(externalMessageId, n.attachments);
    return n;
  }

  /** Download attachment bytes for the refs collected in _normalize. */
  async _hydrateAttachments(messageId, refs) {
    const out = [];
    for (const a of refs) {
      if (!a.attachmentId) continue;
      try {
         
        const r = await this._req("GET", `/messages/${messageId}/attachments/${a.attachmentId}`);
        const content = b64urlDecode(r.data.data);
        if (content.length <= ATTACH_MAX_BYTES) out.push({ filename: a.filename, content_type: a.content_type, size_bytes: content.length, content });
      } catch { /* skip this attachment */ }
    }
    return out;
  }

  async markAsRead(externalMessageId) {
    await this._req("POST", `/messages/${externalMessageId}/modify`, { data: { removeLabelIds: ["UNREAD"] } });
  }

  /** Gmail push: register a Cloud Pub/Sub watch on INBOX. Must be renewed weekly. */
  async watch({ topicName }) {
    const r = await this._req("POST", "/watch", { data: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "include" } });
    return { subscriptionId: topicName, expiresAt: r.data.expiration ? new Date(Number(r.data.expiration)) : null, historyId: r.data.historyId };
  }

  /** Renew = re-issue the watch on the same topic. */
  async renewSubscription(subscriptionId) {
    const w = await this.watch({ topicName: subscriptionId });
    return { expiresAt: w.expiresAt };
  }

  /** Gmail message resource (format=full) → NormalizedEmail. */
  _normalize(m) {
    const payload = m.payload || {};
    const headers = payload.headers || [];
    const h = (n) => { const f = headers.find((x) => x.name.toLowerCase() === n.toLowerCase()); return f ? f.value : null; };
    let bodyText = null;
    let bodyHtml = null;
    const attachments = [];
    const walk = (part) => {
      if (!part) return;
      const mime = part.mimeType || "";
      if (part.filename && part.body && part.body.attachmentId) {
        attachments.push({ filename: part.filename, content_type: mime || "application/octet-stream", size_bytes: part.body.size, attachmentId: part.body.attachmentId });
      } else if (mime === "text/plain" && part.body && part.body.data) bodyText = b64urlDecode(part.body.data).toString("utf8");
      else if (mime === "text/html" && part.body && part.body.data) bodyHtml = b64urlDecode(part.body.data).toString("utf8");
      (part.parts || []).forEach(walk);
    };
    walk(payload);
    if (!bodyText && !bodyHtml && payload.body && payload.body.data) {
      const decoded = b64urlDecode(payload.body.data).toString("utf8");
      if ((payload.mimeType || "").includes("html")) bodyHtml = decoded; else bodyText = decoded;
    }
    return {
      externalMessageId: m.id,
      threadKey: m.threadId,
      direction: "IN",
      from: emailsIn(h("From"))[0] || null,
      to: emailsIn(h("To")),
      cc: emailsIn(h("Cc")),
      subject: h("Subject"),
      bodyHtml,
      bodyText: bodyText || m.snippet || null,
      attachments, // refs (attachmentId) — hydrated to bytes in getMessage
      inReplyTo: h("In-Reply-To"),
      references: (h("References") || "").split(/\s+/).filter(Boolean),
      receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
      isRead: !((m.labelIds || []).includes("UNREAD")),
      provider: "google_gmail",
    };
  }
}

function gmailError(err) {
  const d = err && err.response && err.response.data;
  if (d && d.error && d.error.message) return d.error.message;
  return err && err.message ? err.message : "gmail request failed";
}

module.exports = { GmailProvider, gmailError };
