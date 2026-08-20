/**
 * EmailProvider — the single interface every mail adapter implements. The mail
 * engine (mail.service) depends ONLY on this shape; no business code branches on
 * provider. Design it from what the engine needs, then let each adapter advertise
 * what it can actually do via capabilities() — do NOT shrink it to IMAP's floor.
 *
 * A NormalizedEmail (what fetch/get return, what send/reply accept) is:
 *   { externalMessageId, threadKey, direction ('IN'|'OUT'),
 *     from, to[], cc[], subject, bodyHtml, bodyText, attachments[],
 *     inReplyTo, references[], receivedAt, isRead, provider }
 *
 * Phase 1 ships ImapSmtpProvider. MicrosoftGraphProvider / GmailProvider (Phase 2)
 * slot in behind the same contract.
 */
"use strict";

/**
 * Default capability set — adapters override the flags they support.
 *
 * EVERY key is declared here, as `false`, rather than left for an adapter to
 * add. An absent key reads as `undefined`, which is falsy, so a capability that
 * is MISSING and one that is DENIED are indistinguishable at the call site —
 * right up until somebody writes `if (caps.folderMove !== false)` and the two
 * stop being the same thing. §3.5 fixes the shape of this object for exactly
 * that reason; `tests/unit/mail-capabilities.test.js` holds every adapter to it.
 */
function baseCapabilities() {
  return {
    push: false,          // provider can webhook us on new mail (Graph/Gmail)
    delta: false,         // provider exposes a delta/history cursor
    serverThreads: false, // provider gives a first-class thread/conversation id
    appendSent: false,    // engine must APPEND sent copies to the Sent folder (SMTP)
    folders: false,       // can enumerate + select folders               (IMAP: yes)
    folderMove: false,    // can MOVE a message between folders           (IMAP: yes)
    serverFlags: false,   // \Seen \Flagged \Answered are server-side     (IMAP: yes)
    serverDrafts: false,  // can APPEND to Drafts        (not used in this programme)
    serverSearch: false,  // provider-side search              (we use Postgres FTS)
  };
}

/** The keys every adapter must answer for. Exported so the gate cannot drift. */
const CAPABILITY_KEYS = Object.freeze(Object.keys(baseCapabilities()));

/**
 * Not instantiated directly — documents the contract and gives adapters a base to
 * spread over. Methods that a provider cannot support should be no-ops guided by
 * capabilities() (e.g. IMAP subscribe() returns null; the engine checks push).
 */
const EmailProvider = {
  capabilities() { return baseCapabilities(); },

  // Connection test — never throws; returns {ok, error?}.
  async verify() { throw new Error("verify() not implemented"); },

  // Outbound
  async sendEmail(/* msg */) { throw new Error("sendEmail() not implemented"); },
  async createReply(/* externalMessageId, msg */) { throw new Error("createReply() not implemented"); },

  // Inbound
  async fetchSince(/* cursor */) { throw new Error("fetchSince() not implemented"); },
  async getMessage(/* externalMessageId */) { throw new Error("getMessage() not implemented"); },
  async markAsRead(/* externalMessageId */) { throw new Error("markAsRead() not implemented"); },

  // Push lifecycle (Phase 2 providers only)
  async subscribe() { return null; },
  async renewSubscription(/* subscriptionId */) { return null; },
};

module.exports = { EmailProvider, baseCapabilities, CAPABILITY_KEYS };
