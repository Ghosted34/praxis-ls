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
const { config } = require("../../../../config/env");

const SENT_MAILBOX_CANDIDATES = ["Sent", "Sent Items", "Sent Mail", "INBOX.Sent"];

/**
 * The SMTP envelope MAIL FROM must be a BARE address (no display name). Many
 * relays run sender-verification / callback checks against MAIL FROM and reject
 * ("550 Sender verify failed") anything that isn't a plain, resolvable address —
 * a `"Name" <addr>` form or an empty value trips that check. The header `From`
 * still carries the friendly display name; this only governs the envelope.
 */
function bareAddress(value) {
  if (!value) return null;
  const m = String(value).match(/<([^>]+)>/);
  return (m ? m[1] : String(value)).trim() || null;
}

class ImapSmtpProvider {
  constructor(conn) {
    this.conn = conn || {};
    this.provider = "imap_smtp";
  }

  capabilities() {
    // SMTP does not file sent copies for us → engine/adapter must APPEND them.
    return {
      ...baseCapabilities(),
      appendSent: true, folders: true, folderMove: true, serverFlags: true,
      serverDelete: true,
    };
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
      // Same HELO rule as the system mailer — see config/env MAIL_HELO_NAME. A
      // user's mail leaves through this transport, so a loopback greeting here
      // costs the TENANT's reputation, not ours.
      ...(config.MAIL_HELO_NAME ? { name: config.MAIL_HELO_NAME } : {}),
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
      // Classify the SMTP verdict (550 sender verify, 535 auth, …) so callers
      // can hand the UI a machine code for its fix guide.
      const { mapSmtpError } = require("../smtp-error.map");
      const mapped = mapSmtpError(err);
      return { ok: false, stage: "smtp", error: mapped.message, code: mapped.code };
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
        /* @silent:storage this candidate folder name is not the server's — the
           loop's whole job is to try the next one. A server that fails EVERY
           candidate returns null, and the caller treats that as "no Sent copy",
           which is the honest outcome. */
      }
    }
    return null;
  }

  async sendEmail(msg) {
    const c = this.conn;
    const messageId = msg.messageId || `<${crypto.randomUUID()}@${(c.email_address || "praxisls").split("@").pop()}>`;
    // PR-0: caller-supplied headers ride along — this is how the origin stamp
    // (X-Praxis-*) reaches the wire. Threading headers are set after, so a caller
    // cannot accidentally break threading by passing its own In-Reply-To.
    const headers = { ...(msg.headers || {}) };
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
    // MAIL FROM: the account we authenticated as is the address the relay can
    // actually vouch for during sender verification. Prefer it, fall back to the
    // mailbox/header address, and always strip to a bare address (see bareAddress).
    const envelopeFrom = bareAddress(c.auth_user || c.email_address || mail.from);
    const envelope = { from: envelopeFrom, to: [].concat(msg.to || [], msg.cc || []) };
    await smtp.sendMail({ envelope, raw });

    // File a copy into Sent (SMTP won't) — best effort, non-fatal.
    let imap;
    try {
      imap = this._imapClient();
      await imap.connect();
      await this._appendSent(imap, raw);
    } catch {
      /* @silent:storage the message HAS BEEN SENT by the time this runs. Failing
         the call here would tell the user their mail did not go out when it
         did — a far worse error than a missing Sent copy, which the next IMAP
         sync reconciles anyway. */
    } finally {
      if (imap) { try { await imap.logout(); } catch { /* @silent:teardown the connection is being discarded either way */ } }
    }

    const threadKey = (msg.references && msg.references[0]) || msg.inReplyTo || messageId;
    return { externalMessageId: messageId, threadKey };
  }

  /** Move a message to another folder, so the user's phone agrees with us. */
  async moveMessage(externalMessageId, destinationPath, fromPath) {
    const imap = this._imapClient();
    await imap.connect();
    const lock = await imap.getMailboxLock(fromPath || "INBOX");
    try {
      await imap.messageMove({ header: { "message-id": externalMessageId } }, destinationPath);
      return { moved: true };
    } finally {
      lock.release();
      try { await imap.logout(); } catch { /* @silent:teardown the move already committed */ }
    }
  }

  /**
   * Expunge a message for good (H-1).
   *
   * `messageDelete` sets \Deleted and expunges in one step. The folder is the
   * one the message is filed in — deleting by Message-ID against the wrong
   * mailbox silently matches nothing, so the caller passes the folder it read
   * the message from rather than assuming INBOX.
   *
   * A message the server no longer has is not an error: the user asked for it
   * to be gone and it is gone. `messageDelete` answers false in that case and
   * this reports it rather than throwing, because the local rows are already
   * removed and a throw here would only produce a scary log for a success.
   */
  async deleteMessage(externalMessageId, fromPath) {
    const imap = this._imapClient();
    await imap.connect();
    const lock = await imap.getMailboxLock(fromPath || "INBOX");
    try {
      const ok = await imap.messageDelete({ header: { "message-id": externalMessageId } });
      return { deleted: ok === true };
    } finally {
      lock.release();
      try { await imap.logout(); } catch { /* @silent:teardown the expunge already committed */ }
    }
  }

  async createReply(externalMessageId, msg) {
    const references = [].concat(msg.references || [], externalMessageId).filter(Boolean);
    return this.sendEmail({ ...msg, inReplyTo: externalMessageId, references });
  }

  /**
   * Fetch messages newer than the cursor. cursor = { uidvalidity, last_uid }.
   * If uidvalidity changed, the mailbox re-numbered → full re-scan (last_uid=0).
   */
  /**
   * Every folder the server advertises, with its RFC 6154 special-use flags.
   *
   * The flags are what make the mapping reliable: a folder called "Éléments
   * envoyés" is Sent, and no list of names is ever finished. Servers that do not
   * advertise them fall back to name matching in folders.js.
   */
  async listFolders() {
    const imap = this._imapClient();
    await imap.connect();
    try {
      const list = await imap.list();
      return (list || []).map((f) => ({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter,
        flags: f.flags ? [...f.flags].map((x) => String(x).toLowerCase()) : [],
        specialUse: f.specialUse || null,
      })).map((f) => (f.specialUse && !f.flags.includes(String(f.specialUse).toLowerCase())
        ? { ...f, flags: [...f.flags, String(f.specialUse).toLowerCase()] } : f));
    } finally {
      try { await imap.logout(); } catch { /* @silent:teardown the listing already succeeded */ }
    }
  }

  async fetchSince(cursor, folderPath) {
     
    const { simpleParser } = require("mailparser");
    const imap = this._imapClient();
    const messages = [];
    let nextCursor = cursor;
    // Per folder, because UIDVALIDITY is per mailbox. Defaults to INBOX so a
    // caller that predates multi-folder sync behaves exactly as it used to.
    const box = folderPath || "INBOX";
    const outbound = /^(sent|outbox)/i.test(box) || /\.sent$/i.test(box);

    await imap.connect();
    const lock = await imap.getMailboxLock(box);
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
        messages.push({ ...this._normalize(parsed, item), direction: outbound ? "OUT" : "IN" });
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
      // PR-0: mailparser hands back a Map of every header. Passing it through is
      // what lets the sync tell a message we sent from one the user sent on their
      // phone — the X-Praxis-Origin stamp is only readable here.
      headers: parsed.headers || null,
      messageIdHeader: parsed.messageId || null,
      provider: "imap_smtp",
    };
  }
}

module.exports = { ImapSmtpProvider };
