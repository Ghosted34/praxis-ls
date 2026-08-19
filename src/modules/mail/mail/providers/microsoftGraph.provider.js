/**
 * MicrosoftGraphProvider — Phase 2 adapter (native, axios; no SDK dep). Implements
 * the same EmailProvider contract as ImapSmtpProvider so the engine is unchanged.
 *
 * Token handling is EXTERNALIZED: the constructor takes `getAccessToken()`, an
 * async fn the service supplies that returns a currently-valid bearer token
 * (refreshing + persisting the vault bundle as needed). The adapter never sees the
 * refresh token or client secret — it just asks for a fresh access token per call.
 *
 *   new MicrosoftGraphProvider({ getAccessToken })
 *
 * Capabilities: push + delta + server-side threads; Graph files Sent itself, so
 * NO appendSent (unlike SMTP).
 */
"use strict";

const axios = require("axios");
const { baseCapabilities } = require("./provider.interface");

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,body,bodyPreview";
const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

class MicrosoftGraphProvider {
  constructor({ getAccessToken } = {}) {
    if (typeof getAccessToken !== "function") throw new Error("MicrosoftGraphProvider needs getAccessToken()");
    this._getToken = getAccessToken;
    this.provider = "microsoft_graph";
  }

  capabilities() {
    return { ...baseCapabilities(), push: true, delta: true, serverThreads: true, appendSent: false };
  }

  async _req(method, url, { data, params } = {}) {
    const token = await this._getToken();
    const full = url.startsWith("http") ? url : GRAPH + url;
    return axios({ method, url: full, params, data, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  }

  async verify() {
    try {
      const r = await this._req("GET", "/me?$select=mail,userPrincipalName");
      return { ok: true, email: r.data.mail || r.data.userPrincipalName };
    } catch (err) {
      return { ok: false, error: graphError(err) };
    }
  }

  _draftBody(msg) {
    const recipients = (list) => (list || []).filter(Boolean).map((a) => ({ emailAddress: { address: a } }));
    const to = Array.isArray(msg.to) ? msg.to : [msg.to];
    return {
      subject: msg.subject,
      body: { contentType: msg.bodyHtml ? "HTML" : "Text", content: msg.bodyHtml || msg.bodyText || "" },
      toRecipients: recipients(to),
      ccRecipients: recipients(msg.cc),
    };
  }

  /** Create a draft (so we capture id + conversationId), then send it. */
  async sendEmail(msg) {
    const created = await this._req("POST", "/me/messages", { data: this._draftBody(msg) });
    const { id, conversationId } = created.data;
    await this._req("POST", `/me/messages/${id}/send`);
    return { externalMessageId: id, threadKey: conversationId };
  }

  /** Reply in-thread: Graph createReply → draft, patch our body, send. */
  async createReply(externalMessageId, msg) {
    const draft = await this._req("POST", `/me/messages/${externalMessageId}/createReply`);
    const id = draft.data.id;
    await this._req("PATCH", `/me/messages/${id}`, {
      data: { body: { contentType: msg.bodyHtml ? "HTML" : "Text", content: msg.bodyHtml || msg.bodyText || "" } },
    });
    await this._req("POST", `/me/messages/${id}/send`);
    return { externalMessageId: id, threadKey: draft.data.conversationId };
  }

  /**
   * Delta sync. cursor = { delta_link }. First run hits the delta endpoint; then
   * we follow @odata.nextLink pages, and persist the final @odata.deltaLink as the
   * next cursor. Delta is quota-friendly and gap-free (Graph tracks state) — the
   * timestamp trap that bites IMAP does not apply here.
   */
  async fetchSince(cursor) {
    let url = (cursor && cursor.delta_link)
      || `/me/mailFolders/inbox/messages/delta?$select=${SELECT}`;
    const messages = [];
    let deltaLink = null;
    // Bound the pages defensively; a healthy delta returns few per tick.
    for (let i = 0; i < 50; i += 1) {
       
      const r = await this._req("GET", url);
      for (const m of r.data.value || []) {
        if (m["@removed"]) continue; // ignore deletions for now
        const n = this._normalize(m);
         
        if (m.hasAttachments) n.attachments = await this._fetchAttachments(m.id);
        messages.push(n);
      }
      if (r.data["@odata.nextLink"]) { url = r.data["@odata.nextLink"]; continue; }
      deltaLink = r.data["@odata.deltaLink"] || (cursor && cursor.delta_link) || null;
      break;
    }
    return { messages, nextCursor: { delta_link: deltaLink } };
  }

  async getMessage(externalMessageId) {
    const r = await this._req("GET", `/me/messages/${externalMessageId}?$select=${SELECT}`);
    const n = this._normalize(r.data);
    if (r.data.hasAttachments) n.attachments = await this._fetchAttachments(r.data.id);
    return n;
  }

  /** Fetch file attachments (contentBytes) for a message. Item/reference
   *  attachments are skipped (no inline bytes). Oversized ones are dropped. */
  async _fetchAttachments(graphId) {
    try {
      const r = await this._req("GET", `/me/messages/${graphId}/attachments`);
      return (r.data.value || [])
        .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes)
        .map((a) => ({ filename: a.name, content_type: a.contentType || "application/octet-stream", size_bytes: a.size, content: Buffer.from(a.contentBytes, "base64") }))
        .filter((a) => a.content.length <= ATTACH_MAX_BYTES);
    } catch {
      return [];
    }
  }

  async markAsRead(externalMessageId) {
    await this._req("PATCH", `/me/messages/${externalMessageId}`, { data: { isRead: true } });
  }

  /** Create a change subscription (webhook). notificationUrl must be publicly reachable. */
  async subscribe({ notificationUrl, clientState } = {}) {
    const expiration = new Date(Date.now() + 2.7 * 24 * 3600 * 1000).toISOString(); // < Graph's ~3d max
    const r = await this._req("POST", "/subscriptions", {
      data: {
        changeType: "created",
        notificationUrl,
        resource: "me/mailFolders('Inbox')/messages",
        expirationDateTime: expiration,
        clientState,
      },
    });
    return { subscriptionId: r.data.id, expiresAt: r.data.expirationDateTime };
  }

  async renewSubscription(subscriptionId) {
    const expiration = new Date(Date.now() + 2.7 * 24 * 3600 * 1000).toISOString();
    const r = await this._req("PATCH", `/subscriptions/${subscriptionId}`, { data: { expirationDateTime: expiration } });
    return { expiresAt: r.data.expirationDateTime };
  }

  /** Graph message resource → NormalizedEmail. externalMessageId is the Graph id
   *  (needed for reply/read); threadKey is the server conversationId. */
  _normalize(m) {
    const addr = (r) => (r && r.emailAddress ? r.emailAddress.address : null);
    const isHtml = m.body && m.body.contentType && String(m.body.contentType).toUpperCase() === "HTML";
    return {
      externalMessageId: m.id,
      threadKey: m.conversationId || m.internetMessageId || m.id,
      direction: "IN",
      from: m.from ? addr(m.from) : null,
      to: (m.toRecipients || []).map(addr).filter(Boolean),
      cc: (m.ccRecipients || []).map(addr).filter(Boolean),
      subject: m.subject || null,
      bodyHtml: isHtml && m.body ? m.body.content : null,
      bodyText: !isHtml && m.body ? m.body.content : (m.bodyPreview || null),
      attachments: [], // TODO(Phase 2.1): GET /messages/{id}/attachments when hasAttachments
      inReplyTo: null,
      references: [],
      receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
      isRead: m.isRead === true,
      provider: "microsoft_graph",
    };
  }
}

function graphError(err) {
  const d = err && err.response && err.response.data;
  if (d && d.error && d.error.message) return d.error.message;
  return err && err.message ? err.message : "graph request failed";
}

module.exports = { MicrosoftGraphProvider, graphError };
