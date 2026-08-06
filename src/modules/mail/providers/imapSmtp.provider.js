/**
 * ImapSmtpProvider — Phase 1 adapter. Inbound over IMAP (imapflow), outbound over
 * SMTP (nodemailer). Covers any mail host: DTR/cPanel/private servers, and any
 * provider that exposes IMAP/SMTP with an app password.
 *
 * Construction takes a RESOLVED connection: transport settings from
 * email_connection + the decrypted password (never read a secret in here — the
 * engine resolves it from the integration_secret vault and passes it in).
 *
 *   new ImapSmtpProvider({
 *     email_address, from,
 *     imap_host, imap_port, imap_secure,
 *     smtp_host, smtp_port, smtp_secure,
 *     auth_user, password,
 *   })
 *
 * Heavy deps (imapflow, mailparser, nodemailer) are lazy-required so the web
 * process doesn't load an IMAP stack it never uses — matches email.service.
 */
"use strict";

const crypto = require("crypto");
const { baseCapabilities } = require("./provider.interface");

const SENT_MAILBOX_CANDIDATES = ["Sent", "Sent Items", "Sent Mail", "INBOX.Sent"];

class ImapSmtpProvider {
  constructor(conn) {
    this.conn = conn || {};
    this.provider = "imap_smtp";
  }

  capabilities() {
    // SMTP does not file sent copies for us → engine/adapter must APPEND them.
    return { ...baseCapabilities(), appendSent: true };
  }

  _imapClient() {
     
    const { ImapFlow } = require("imapflow");
    const c = this.conn;
    return new ImapFlow({
      host: c.imap_host,
      port: c.imap_port || 993,
      secure: c.imap_secure !== false,
      auth: { user: c.auth_user || c.email_address, pass: c.password },
      logger: false,
    });
  }

  _smtpTransport() {
     
    const nodemailer = require("nodemailer");
    const c = this.conn;
    return nodemailer.createTransport({
      host: c.smtp_host,
      port: c.smtp_port || 587,
      secure: c.smtp_secure === true || c.smtp_port === 465,
      auth: c.auth_user || c.email_address ? { user: c.auth_user || c.email_address, pass: c.password } : undefined,
    });
  }

  /** Compose a message to a raw RFC822 buffer (no send) — reused for SMTP + APPEND. */
  async _composeRaw(mail) {
     
    const nodemailer = require("nodemailer");
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
    const info = await composer.sendMail(mail);
    return info.message; // Buffer
  }

  /** Live IMAP + SMTP connectivity/auth check. Never throws. */
  async verify() {
    try {
      const imap = this._imapClient();
      await imap.connect();
      await imap.logout();
    } catch (err) {
      return { ok: false, stage: "imap", error: err.message };
    }
    try {
      await this._smtpTransport().verify();
    } catch (err) {
      return { ok: false, stage: "smtp", error: err.message };
    }
    return { ok: true };
  }

  /** Best-effort APPEND of a raw message to the mailbox's Sent folder. */
  async _appendSent(imap, raw) {
    for (const box of SENT_MAILBOX_CANDIDATES) {
      try {
        if (await imap.mailboxExists(box)) {
          await imap.append(box, raw, ["\\Seen"]);
          return box;
        }
      } catch {
        /* try next candidate */
      }
    }
    return null;
  }

  async sendEmail(msg) {
    const c = this.conn;
    const messageId = msg.messageId || `<${crypto.randomUUID()}@${(c.email_address || "praxisls").split("@").pop()}>`;
    const headers = {};
    if (msg.inReplyTo) headers["In-Reply-To"] = msg.inReplyTo;
    if (msg.references && msg.references.length) headers.References = msg.references.join(" ");

    const mail = {
      from: msg.from || c.from || c.email_address,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      html: msg.bodyHtml || msg.html,
      text: msg.bodyText || msg.text,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      messageId,
      headers,
      ...(msg.attachments && msg.attachments.length ? { attachments: msg.attachments } : {}),
    };

    const raw = await this._composeRaw(mail);
    const smtp = this._smtpTransport();
    const envelope = { from: c.email_address || msg.from, to: [].concat(msg.to || [], msg.cc || []) };
    await smtp.sendMail({ envelope, raw });

    // File a copy into Sent (SMTP won't) — best effort, non-fatal.
    let imap;
    try {
      imap = this._imapClient();
      await imap.connect();
      await this._appendSent(imap, raw);
    } catch {
      /* Sent-append is best effort */
    } finally {
      if (imap) { try { await imap.logout(); } catch { /* noop */ } }
    }

    const threadKey = (msg.references && msg.references[0]) || msg.inReplyTo || messageId;
    return { externalMessageId: messageId, threadKey };
  }

  async createReply(externalMessageId, msg) {
    const references = [].concat(msg.references || [], externalMessageId).filter(Boolean);
    return this.sendEmail({ ...msg, inReplyTo: externalMessageId, references });
  }

  /**
   * Fetch messages newer than the cursor. cursor = { uidvalidity, last_uid }.
   * If uidvalidity changed, the mailbox re-numbered → full re-scan (last_uid=0).
   */
  async fetchSince(cursor) {
     
    const { simpleParser } = require("mailparser");
    const imap = this._imapClient();
    const messages = [];
    let nextCursor = cursor;

    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const uidValidity = Number(imap.mailbox.uidValidity);
      const prior = cursor || {};
      const sameBox = Number(prior.uidvalidity) === uidValidity;
      const lastUid = sameBox ? Number(prior.last_uid || 0) : 0; // uidvalidity change ⇒ re-scan

      let maxUid = lastUid;
      const range = `${lastUid + 1}:*`;
      // range is a UID range because options.uid = true.
      for await (const item of imap.fetch(range, { uid: true, source: true, flags: true }, { uid: true })) {
        if (item.uid <= lastUid) continue; // `n:*` can echo the last uid when none are newer
        const parsed = await simpleParser(item.source);
        messages.push(this._normalize(parsed, item));
        if (item.uid > maxUid) maxUid = item.uid;
      }
      nextCursor = { uidvalidity: uidValidity, last_uid: maxUid };
    } finally {
      lock.release();
      await imap.logout();
    }
    return { messages, nextCursor };
  }

  async getMessage(externalMessageId) {
     
    const { simpleParser } = require("mailparser");
    const imap = this._imapClient();
    let out = null;
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const uid = await imap.search({ header: { "message-id": externalMessageId } }, { uid: true });
      if (uid && uid.length) {
        const item = await imap.fetchOne(String(uid[uid.length - 1]), { uid: true, source: true, flags: true }, { uid: true });
        if (item) out = this._normalize(await simpleParser(item.source), item);
      }
    } finally {
      lock.release();
      await imap.logout();
    }
    return out;
  }

  async markAsRead(externalMessageId) {
    const imap = this._imapClient();
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const uid = await imap.search({ header: { "message-id": externalMessageId } }, { uid: true });
      if (uid && uid.length) await imap.messageFlagsAdd(String(uid[uid.length - 1]), ["\\Seen"], { uid: true });
    } finally {
      lock.release();
      await imap.logout();
    }
  }

  /** RFC822 (mailparser) + IMAP item → NormalizedEmail. */
  _normalize(parsed, item) {
    const addrs = (a) => (a ? (Array.isArray(a) ? a : [a]).flatMap((x) => (x.value || []).map((v) => v.address)) : []);
    const references = parsed.references ? [].concat(parsed.references) : [];
    const externalMessageId = parsed.messageId || (item && `uid:${item.uid}`);
    const threadKey = references[0] || parsed.inReplyTo || externalMessageId;
    return {
      externalMessageId,
      threadKey,
      direction: "IN",
      from: parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0].address : null,
      to: addrs(parsed.to),
      cc: addrs(parsed.cc),
      subject: parsed.subject || null,
      bodyHtml: parsed.html || null,
      bodyText: parsed.text || null,
      attachments: (parsed.attachments || []).map((a) => ({ filename: a.filename, content_type: a.contentType, size_bytes: a.size, content: a.content })),
      inReplyTo: parsed.inReplyTo || null,
      references,
      receivedAt: parsed.date || (item && item.internalDate) || new Date(),
      isRead: item && item.flags ? item.flags.has("\\Seen") : false,
      provider: "imap_smtp",
    };
  }
}

module.exports = { ImapSmtpProvider };
